import { useEffect, useMemo, useState } from "react";
import Tesseract from "tesseract.js";
import "./App.css";

const DIVISIONS = ["PA", "PPD", "PDD", "PCM", "PJM", "CE"];

const ROOMS_BY_DIVISION = {
  PA: ["Site", "Zoning", "Code", "Programming"],
  PPD: ["Site", "Climate", "Structure", "Systems"],
  PDD: ["Envelope", "Detailing", "Materials", "Documentation"],
  PCM: ["Practice", "Risk", "Contracts", "Finance"],
  PJM: ["Team", "Schedule", "CA", "Delivery"],
  CE: ["Site Visit", "Submittals", "RFI", "Punch List"]
};

const SAMPLE_BY_DIVISION = {
  PA: `Site analysis should start with climate, zoning, topography, and access.
Programming should connect client needs to spatial requirements.
Early code review helps define occupancy, egress, and height/area limits.`,
  PPD: `Building system: active system relies on mechanical equipment and uses more energy.
Passive system relies on sun, air, and wind flow.
In cold climate, reduce heat loss and gain solar heat.
In hot climate, control heat gain and optimize natural ventilation.
Trombe wall helps stabilize temperature but takes more space.`,
  PDD: `Envelope detailing must control water, air, vapor, and thermal transfer.
Material selection affects durability, constructability, and maintenance.
Documentation should clearly coordinate assemblies, dimensions, and specifications.`,
  PCM: `Practice management connects staffing, risk, finance, and firm operations.
A sustainable office workflow depends on planning, communication, and resource control.`,
  PJM: `Project management coordinates scope, schedule, consultant communication, and delivery expectations.
Construction administration requires tracking submittals, RFIs, and field conditions.`,
  CE: `Construction evaluation depends on site observation, documentation, and follow-up.
Punch list review compares completed work against contract expectations.`
};

const EMPTY_CAPTURE_ANALYSIS = {
  summary: "",
  bulletPoints: [],
  logicLinks: [],
  logicForest: []
};

const ACTION_RE =
  /(relies on|rely on|uses|use|requires|require|needs|need|controls|control|reduces|reduce|minimizes|minimize|maximizes|maximize|optimizes|optimize|gains|gain|provides|provide|improves|improve|stabilizes|stabilize|limits|limit|affects|affect|influences|influence|includes|include|consists of|is|are|means|refers to|defined as|helps|help|takes|take|depends on|depend on|connects|connect|coordinates|coordinate|compares|compare)/i;

const LEADING_VERB_RE =
  /^(relies on|rely on|uses|use|requires|require|needs|need|controls|control|reduces|reduce|minimizes|minimize|maximizes|maximize|optimizes|optimize|gains|gain|provides|provide|improves|improve|stabilizes|stabilize|limits|limit|affects|affect|influences|influence|includes|include|consists of|helps|help|takes|take|depends on|depend on|connects|connect|coordinates|coordinate|compares|compare|avoid|avoids|block|blocks|collect|collects|get|gets|store|stores)/i;

function normalizeWhitespace(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function stripBulletPrefix(text = "") {
  return String(text).replace(/^\s*(?:[-*•▪▫◦●○►▸▹]+|\d+[.)])\s+/, "").trim();
}

function cleanLine(text = "") {
  return normalizeWhitespace(stripBulletPrefix(text).replace(/[\t]+/g, " "));
}

function sentenceCase(text = "") {
  const clean = normalizeWhitespace(text)
    .replace(/^[\[\]()]+|[\[\]()]+$/g, "")
    .replace(/[.;]+$/g, "")
    .trim();

  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function titleCaseLabel(text = "") {
  const clean = normalizeWhitespace(text)
    .replace(/^[\[\]()]+|[\[\]()]+$/g, "")
    .replace(/[.:;,!?]+$/g, "")
    .trim();

  if (!clean) return "";

  return clean
    .split(/\s+/)
    .map(word => {
      if (/^[A-Z0-9-]{2,}$/.test(word)) return word;
      if (["of", "and", "or", "to", "in", "on", "for", "by", "vs"].includes(word.toLowerCase())) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function relationLabel(raw = "") {
  const value = normalizeWhitespace(raw).toLowerCase();

  if (["use", "uses"].includes(value)) return "uses";
  if (["require", "requires", "need", "needs", "depends on", "depend on"].includes(value)) {
    return value.includes("depend") ? "depends on" : "requires";
  }
  if (["control", "controls"].includes(value)) return "controls";
  if (["reduce", "reduces", "minimize", "minimizes"].includes(value)) return "reduces";
  if (["maximize", "maximizes"].includes(value)) return "maximizes";
  if (["optimize", "optimizes"].includes(value)) return "optimizes";
  if (["gain", "gains"].includes(value)) return "gains";
  if (["provide", "provides"].includes(value)) return "provides";
  if (["improve", "improves"].includes(value)) return "improves";
  if (["stabilize", "stabilizes"].includes(value)) return "stabilizes";
  if (["limit", "limits"].includes(value)) return "limits";
  if (["affect", "affects"].includes(value)) return "affects";
  if (["influence", "influences"].includes(value)) return "influences";
  if (["include", "includes", "consists of"].includes(value)) return "includes";
  if (["connect", "connects"].includes(value)) return "connects";
  if (["coordinate", "coordinates"].includes(value)) return "coordinates";
  if (["compare", "compares"].includes(value)) return "compares";
  if (["is", "are", "means", "refers to", "defined as"].includes(value)) return "is";
  if (["help", "helps"].includes(value)) return "benefit";
  if (["take", "takes"].includes(value)) return "tradeoff";
  if (["rely on", "relies on"].includes(value)) return "relies on";
  return value;
}

function relationToPhrase(relation = "") {
  const value = normalizeWhitespace(relation).toLowerCase();
  if (value === "benefit") return "helps";
  if (value === "tradeoff") return "has a tradeoff of";
  if (value === "has type") return "includes";
  if (value === "strategy") return "focuses on";
  return value;
}

function shouldLinkGroupToSubject(group = "", subject = "") {
  const g = group.toLowerCase();
  const s = subject.toLowerCase();
  if (!g || !s || g === s) return null;
  if (g.includes("system") && s.includes("system")) return "has type";
  if (g.includes("response") && s.includes("climate")) return "includes";
  if (g.includes("strategy") || g.includes("protection") || g.includes("mass")) return "includes";
  return null;
}

function pushUnit(units, subject, relation, object, priority = 1) {
  const cleanSubject = titleCaseLabel(subject);
  const cleanRelation = normalizeWhitespace(relation);
  const cleanObject = sentenceCase(object);

  if (!cleanSubject || !cleanRelation || !cleanObject) return;

  const key = `${cleanSubject}|||${cleanRelation.toLowerCase()}|||${cleanObject.toLowerCase()}`;
  if (units.some(item => `${item.subject}|||${item.relation.toLowerCase()}|||${item.object.toLowerCase()}` === key)) {
    return;
  }

  units.push({ subject: cleanSubject, relation: cleanRelation, object: cleanObject, priority });
}

function textToSemanticLines(text = "") {
  const rawLines = String(text)
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  if (rawLines.length > 1) return rawLines;

  return String(text)
    .replace(/\r/g, "")
    .replace(/([.!?。！？;；])\s+/g, "$1\n")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);
}

function extractSubject(text = "") {
  const match = normalizeWhitespace(text).match(new RegExp(`^(.*?)\\s+${ACTION_RE.source}`, "i"));
  return match ? titleCaseLabel(match[1]) : "";
}

function splitCompoundClauses(text = "") {
  const clean = normalizeWhitespace(text);
  if (!clean) return [];

  const withSplitMarkers = clean.replace(
    /\s+(?:and|but)\s+(?=(?:relies?\s+on|uses?|requires?|needs?|controls?|reduces?|minimizes?|maximizes?|optimizes?|gains?|provides?|improves?|stabilizes?|limits?|affects?|influences?|includes?|consists\s+of|helps?|takes?|depends?\s+on|connects?|coordinates?|compares?)\b)/gi,
    " | "
  );

  const parts = withSplitMarkers
    .split("|")
    .map(item => item.trim())
    .filter(Boolean);

  if (parts.length <= 1) return parts;

  const baseSubject = extractSubject(parts[0]);

  return parts.map((part, index) => {
    if (!index) return part;
    if (baseSubject && LEADING_VERB_RE.test(part)) return `${baseSubject} ${part}`;
    return part;
  });
}

function parseActionLine(line, context, units) {
  const clean = normalizeWhitespace(line).replace(/[.;]+$/g, "");
  if (!clean) return;

  const group = context.group || "";
  const headerSubject = context.headerSubject || "";

  const climateMatch = clean.match(/^in\s+([^,]+?)\s*,?\s*(.+)$/i);
  if (climateMatch) {
    const climate = titleCaseLabel(climateMatch[1]);
    const tail = normalizeWhitespace(climateMatch[2]);
    pushUnit(units, "Climate Response", "includes", climate, 3);

    splitCompoundClauses(tail).forEach(part => {
      const normalized = LEADING_VERB_RE.test(part) ? `${climate} ${part}` : part;
      parseActionLine(normalized, { group: "Climate Response", headerSubject: climate }, units);
    });
    return;
  }

  const helpMatch = clean.match(/^(.*?)\s+helps\s+(.+?)(?:\s+but\s+(.+))?$/i);
  if (helpMatch) {
    const subject = titleCaseLabel(helpMatch[1]);
    const link = shouldLinkGroupToSubject(group, subject);
    if (link) pushUnit(units, group, link, subject, 2);
    pushUnit(units, subject, "benefit", helpMatch[2], 3);
    if (helpMatch[3]) pushUnit(units, subject, "tradeoff", helpMatch[3], 3);
    return;
  }

  const mainMatch = clean.match(
    /^(.*?)\s+(relies on|rely on|uses|use|requires|require|needs|need|controls|control|reduces|reduce|minimizes|minimize|maximizes|maximize|optimizes|optimize|gains|gain|provides|provide|improves|improve|stabilizes|stabilize|limits|limit|affects|affect|influences|influence|includes|include|consists of|is|are|means|refers to|defined as|takes|take|depends on|depend on|connects|connect|coordinates|coordinate|compares|compare)\s+(.+)$/i
  );

  if (mainMatch) {
    const subject = titleCaseLabel(mainMatch[1]);
    const relation = relationLabel(mainMatch[2]);
    const object = mainMatch[3];
    const link = shouldLinkGroupToSubject(group, subject);
    if (link) pushUnit(units, group, link, subject, 2);
    pushUnit(units, subject, relation, object, 3);
    return;
  }

  if (headerSubject && LEADING_VERB_RE.test(clean)) {
    parseActionLine(`${headerSubject} ${clean}`, { group, headerSubject }, units);
    return;
  }

  if (headerSubject && !ACTION_RE.test(clean) && clean.split(/\s+/).length <= 8) {
    const link = shouldLinkGroupToSubject(group, clean);
    if (link) pushUnit(units, group, link, clean, 1);
    context.headerSubject = titleCaseLabel(clean);
    return;
  }

  if (group && !ACTION_RE.test(clean) && clean.split(/\s+/).length <= 8) {
    pushUnit(units, group, "includes", clean, 1);
  }
}

function parseCaptureUnits(text = "") {
  const lines = textToSemanticLines(text);
  const units = [];
  const context = { group: "", headerSubject: "" };

  lines.forEach(line => {
    const clean = cleanLine(line);
    if (!clean) return;

    const colonMatch = clean.match(/^([^:：]{1,56})[:：]\s*(.+)$/);
    if (colonMatch && colonMatch[1].trim().split(/\s+/).length <= 6) {
      context.group = titleCaseLabel(colonMatch[1]);
      context.headerSubject = titleCaseLabel(colonMatch[1]);

      splitCompoundClauses(colonMatch[2]).forEach(part => {
        parseActionLine(part, context, units);
      });
      return;
    }

    const possibleHeader = clean.replace(/[:：]$/, "");
    if (!/[.!?。！？]$/.test(clean) && possibleHeader.split(/\s+/).length <= 5 && !ACTION_RE.test(clean)) {
      context.headerSubject = titleCaseLabel(possibleHeader);
      if (/system|strategy|response|protection|mass|collector|wall|climate/i.test(possibleHeader)) {
        context.group = titleCaseLabel(possibleHeader);
      }
      return;
    }

    splitCompoundClauses(clean).forEach(part => {
      parseActionLine(part, context, units);
    });
  });

  return units.sort((a, b) => b.priority - a.priority || a.subject.localeCompare(b.subject));
}

function buildLogicLinksFromUnits(units = []) {
  return units.map(item => `[${item.subject}] ➔ ${item.relation} ➔ [${item.object}]`);
}

function buildLogicForestFromUnits(units = []) {
  if (!units.length) return [];

  const subjects = new Set(units.map(item => item.subject));
  const adjacency = new Map();
  const inbound = new Map();

  units.forEach(item => {
    if (!adjacency.has(item.subject)) adjacency.set(item.subject, []);
    adjacency.get(item.subject).push({ relation: item.relation, label: item.object });
    inbound.set(item.object, (inbound.get(item.object) || 0) + 1);
    if (!inbound.has(item.subject)) inbound.set(item.subject, inbound.get(item.subject) || 0);
  });

  const sortedRoots = [...adjacency.keys()]
    .filter(key => (inbound.get(key) || 0) === 0)
    .sort((a, b) => {
      const aWeight = (adjacency.get(a) || []).length;
      const bWeight = (adjacency.get(b) || []).length;
      return bWeight - aWeight || a.localeCompare(b);
    });

  const roots = sortedRoots.length ? sortedRoots : [...adjacency.keys()].slice(0, 3);

  function buildNode(label, relation = null, seen = new Set()) {
    const key = `${relation || "root"}::${label}`;
    if (seen.has(key)) return { label, relation, children: [] };

    const nextSeen = new Set(seen);
    nextSeen.add(key);

    const children = subjects.has(label)
      ? (adjacency.get(label) || []).map(edge => buildNode(edge.label, edge.relation, nextSeen))
      : [];

    return { label, relation, children };
  }

  return roots.map(root => buildNode(root, null));
}

function groupUnitsBySubject(units = []) {
  const map = new Map();
  units.forEach(unit => {
    if (!map.has(unit.subject)) map.set(unit.subject, []);
    map.get(unit.subject).push(unit);
  });
  return map;
}

function formatSubjectBullet(subject, items) {
  if (!items?.length) return "";

  const includes = items.filter(item => ["includes", "has type"].includes(item.relation));
  const details = items.filter(item => !["includes", "has type"].includes(item.relation));

  if (includes.length >= 2 && !details.length) {
    const list = includes.map(item => item.object).join(" and ");
    return `${subject} includes ${list}.`;
  }

  if (!details.length && includes.length === 1) {
    return `${subject} includes ${includes[0].object}.`;
  }

  if (!details.length) return "";

  const segments = details.slice(0, 3).map(item => {
    const phrase = relationToPhrase(item.relation);
    return `${phrase} ${item.object}`;
  });

  return `${subject} ${segments.join("; ")}.`;
}

function buildCaptureBulletPoints(units = []) {
  if (!units.length) return [];

  const bySubject = groupUnitsBySubject(units);
  const orderedSubjects = [...bySubject.keys()].sort((a, b) => {
    const aItems = bySubject.get(a) || [];
    const bItems = bySubject.get(b) || [];
    const aScore = aItems.reduce((sum, item) => sum + item.priority, 0);
    const bScore = bItems.reduce((sum, item) => sum + item.priority, 0);
    return bScore - aScore || a.localeCompare(b);
  });

  const bullets = [];

  orderedSubjects.forEach(subject => {
    const bullet = formatSubjectBullet(subject, bySubject.get(subject));
    if (bullet && !bullets.includes(bullet)) bullets.push(bullet);
  });

  return bullets.slice(0, 8);
}

function buildComparisonSentence(units) {
  const bySubject = groupUnitsBySubject(units);
  const active = bySubject.get("Active System") || [];
  const passive = bySubject.get("Passive System") || [];

  if (!active.length || !passive.length) return "";

  const activeMain = active.find(item => item.relation === "relies on") || active[0];
  const passiveMain = passive.find(item => item.relation === "relies on") || passive[0];
  const activeExtra = active.find(item => item.relation === "uses" || item.relation === "requires");

  let sentence = `The notes compare active and passive systems: active systems ${relationToPhrase(activeMain.relation)} ${activeMain.object}, while passive systems ${relationToPhrase(passiveMain.relation)} ${passiveMain.object}`;
  if (activeExtra) sentence += ` and ${relationToPhrase(activeExtra.relation)} ${activeExtra.object}`;
  return `${sentence}.`;
}

function buildClimateSentence(units) {
  const bySubject = groupUnitsBySubject(units);
  const cold = bySubject.get("Cold Climate") || [];
  const hot = bySubject.get("Hot Climate") || [];
  if (!cold.length && !hot.length) return "";

  const coldText = cold.length
    ? `cold climates ${cold.map(item => `${relationToPhrase(item.relation)} ${item.object}`).slice(0, 2).join(" and ")}`
    : "";
  const hotText = hot.length
    ? `hot climates ${hot.map(item => `${relationToPhrase(item.relation)} ${item.object}`).slice(0, 2).join(" and ")}`
    : "";

  if (coldText && hotText) return `Climate response changes by condition: ${coldText}, while ${hotText}.`;
  return `Climate response changes by condition: ${coldText || hotText}.`;
}

function buildTradeoffSentence(units) {
  const bySubject = groupUnitsBySubject(units);

  for (const [subject, items] of bySubject.entries()) {
    const benefit = items.find(item => item.relation === "benefit");
    const tradeoff = items.find(item => item.relation === "tradeoff");
    if (benefit && tradeoff) {
      return `${subject} helps ${benefit.object}, but its tradeoff is ${tradeoff.object}.`;
    }
  }

  return "";
}

function buildGenericSummary(bullets = []) {
  if (!bullets.length) return "";
  return bullets
    .slice(0, 3)
    .map(item => item.replace(/\s+/g, " ").trim())
    .join(" ");
}

function buildCaptureSummary(units = []) {
  if (!units.length) return "";

  const sentences = [];
  const comparison = buildComparisonSentence(units);
  const climate = buildClimateSentence(units);
  const tradeoff = buildTradeoffSentence(units);
  const bullets = buildCaptureBulletPoints(units);

  if (comparison) sentences.push(comparison);
  if (climate) sentences.push(climate);
  if (tradeoff) sentences.push(tradeoff);

  if (!sentences.length) {
    const generic = buildGenericSummary(bullets);
    if (generic) sentences.push(generic);
  } else if (sentences.length < 3) {
    bullets.forEach(item => {
      if (sentences.length >= 3) return;
      if (!sentences.some(sentence => sentence.includes(item.slice(0, 18)))) {
        sentences.push(item);
      }
    });
  }

  return sentences.slice(0, 4).join(" ");
}

function buildCaptureAnalysisLocal(text = "") {
  if (!normalizeWhitespace(text)) return EMPTY_CAPTURE_ANALYSIS;

  const units = parseCaptureUnits(text);
  if (!units.length) return EMPTY_CAPTURE_ANALYSIS;

  return {
    summary: buildCaptureSummary(units),
    bulletPoints: buildCaptureBulletPoints(units),
    logicLinks: buildLogicLinksFromUnits(units),
    logicForest: buildLogicForestFromUnits(units)
  };
}

function splitLines(text = "") {
  return String(text)
    .replace(/\r/g, "")
    .split("\n")
    .map(item => normalizeWhitespace(item))
    .filter(Boolean);
}

function normalizeWrongQuestionLines(text = "") {
  return splitLines(text).map(line => line.replace(/\s+/g, " ").trim());
}

function filterPlaceholder(items = [], prefix = "未检测到") {
  return items.filter(item => item && !item.startsWith(prefix));
}

function inferWrongQuestionTopic(text = "") {
  const lower = text.toLowerCase();

  if (/sustain|recycled|low-voc|prefab|smart technology|energy|daylight|solar/.test(lower)) {
    return "Sustainability Strategy";
  }
  if (/egress|exit|occupancy|fire|code|sprinkler|alarm/.test(lower)) {
    return "Code / Life Safety";
  }
  if (/structure|beam|column|load|lateral|shear|foundation/.test(lower)) {
    return "Structure";
  }
  if (/hvac|ventilation|mechanical|cooling|heating|thermal/.test(lower)) {
    return "Building Systems";
  }
  if (/envelope|waterproof|vapor|insulation|flashing|detail/.test(lower)) {
    return "Envelope / Detailing";
  }

  return "Core Concept";
}

function buildWrongQuestionQuestionText(text = "") {
  const lines = normalizeWrongQuestionLines(text);
  const questionLines = [];

  for (const line of lines) {
    if (
      /^(?:☑|✔|☐|❌|\[x\]|\[\s\]|✓|✗)?\s*(?:Correct|Incorrect)[.\s:-]+/i.test(line) ||
      /^correct answer\s*[:\-]/i.test(line)
    ) {
      break;
    }

    questionLines.push(line);
    if (questionLines.length >= 5) break;
  }

  return questionLines.length ? questionLines.join(" ") : "No question text yet.";
}

function buildWrongQuestionAnswerExtraction(text = "") {
  const lines = normalizeWrongQuestionLines(text).filter(line =>
    /^(?:☑|✔|\[x\]|✓)?\s*Correct[.\s:-]+/i.test(line)
  );

  return lines.length
    ? lines.map(line => line.replace(/^(?:☑|✔|\[x\]|✓)?\s*Correct[.\s:-]+/i, "").trim())
    : ["未检测到 Correct 关键词，请手动修改。"];
}

function buildWrongQuestionTrapPoint(text = "") {
  const lines = normalizeWrongQuestionLines(text).filter(line =>
    /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[.\s:-]+/i.test(line)
  );

  return lines.length
    ? lines.map(line => line.replace(/^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[.\s:-]+/i, "").trim())
    : ["未检测到 Incorrect 关键词。"];
}

function buildWrongQuestionCorrectAnswer(text = "") {
  const explicit = text.match(/correct answer\s*[:\-]\s*(.+)/i);
  if (explicit) return explicit[1].trim();

  const correct = filterPlaceholder(buildWrongQuestionAnswerExtraction(text));
  return correct.length ? correct : "等待输入...";
}

function buildWrongQuestionBulletPoints(text = "") {
  const correct = filterPlaceholder(buildWrongQuestionAnswerExtraction(text));
  const trap = filterPlaceholder(buildWrongQuestionTrapPoint(text));
  const bullets = [];

  correct.forEach(item => bullets.push(`Correct move: ${item}`));
  trap.slice(0, 3).forEach(item => bullets.push(`Trap: ${item}`));

  return bullets.length ? bullets : ["等待输入..."];
}

function buildWrongQuestionMemoryHook(text = "") {
  const lower = text.toLowerCase();

  if (/sustain|recycled|low-voc|prefab|smart technology/.test(lower)) {
    return "先抓题目真正目标，再选最直接支持目标的策略。";
  }
  if (/egress|exit|occupancy|fire|code/.test(lower)) {
    return "先判断题目触发了哪条 code 条件，再选答案。";
  }
  if (/structure|load|beam|column|foundation/.test(lower)) {
    return "先看受力逻辑，再看构件选择。";
  }

  return "先抓题目核心目标，再选直接对应目标的答案。";
}

function buildWrongQuestionSummary(text = "") {
  if (!normalizeWhitespace(text)) return "等待输入...";

  const topic = inferWrongQuestionTopic(text);
  const question = buildWrongQuestionQuestionText(text);
  const correct = filterPlaceholder(buildWrongQuestionAnswerExtraction(text));
  const trap = filterPlaceholder(buildWrongQuestionTrapPoint(text));

  if (correct.length) {
    const correctPreview = correct.slice(0, 2).join("；");
    const trapPreview = trap.length ? ` 容易误选的是：${trap[0]}` : "";
    return `这道错题主要考 ${topic}。核心不是选“看起来也不错”的选项，而是判断什么最直接满足题目目标。正确抓手是：${correctPreview}。${trapPreview}`;
  }

  if (question !== "No question text yet.") {
    return `这道错题主要考 ${topic}。${question}`;
  }

  return "等待输入...";
}

function LogicTreeNode({ tree, depth = 0 }) {
  return (
    <div className={`logic-tree-level depth-${depth}`}>
      <div className="logic-tree-row">
        {tree.relation ? <span className="logic-relation-pill">{tree.relation}</span> : null}
        <div className={`logic-node-card ${depth === 0 ? "root" : ""}`}>{tree.label}</div>
      </div>
      {tree.children?.length ? (
        <div className="logic-children">
          {tree.children.map((child, index) => (
            <LogicTreeNode key={`${child.label}-${index}`} tree={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function readSavedNotesByTopic() {
  try {
    const raw = localStorage.getItem("savedNotesByTopic");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readWrongQuestionFlashcards() {
  try {
    const raw = localStorage.getItem("wrongQuestionFlashcards");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function formatSavedAt(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  return Number.isNaN(d.getTime())
    ? dateString
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString()}`;
}

function CapturePanelSection({ title, empty = false, children }) {
  return (
    <div className="subcard">
      <div className="subcard-title">{title}</div>
      <div className={`analysis-box ${empty ? "is-empty" : ""}`}>{children}</div>
    </div>
  );
}

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [selectedRoom, setSelectedRoom] = useState("Site");

  const [captureDraft, setCaptureDraft] = useState("");
  const [savedNotesByTopic, setSavedNotesByTopic] = useState(() => readSavedNotesByTopic());
  const [captureStatus, setCaptureStatus] = useState("Ready.");
  const [captureAiResult, setCaptureAiResult] = useState(null);
  const [isCaptureAnalyzing, setIsCaptureAnalyzing] = useState(false);

  const [wrongQuestionImageFile, setWrongQuestionImageFile] = useState(null);
  const [wrongQuestionImagePreview, setWrongQuestionImagePreview] = useState("");
  const [wrongQuestionOcrText, setWrongQuestionOcrText] = useState("");
  const [wrongQuestionDraftText, setWrongQuestionDraftText] = useState("");
  const [wrongQuestionStatus, setWrongQuestionStatus] = useState("Ready.");
  const [isRunningOcr, setIsRunningOcr] = useState(false);

  const [wrongQuestionFlashcards, setWrongQuestionFlashcards] = useState(() => readWrongQuestionFlashcards());
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [expandedImage, setExpandedImage] = useState("");
  const [aiAnalysisResult, setAiAnalysisResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const currentTopicKey = useMemo(() => `${selectedDivision}::${selectedRoom}`, [selectedDivision, selectedRoom]);
  const rooms = ROOMS_BY_DIVISION[selectedDivision] || [];

  const savedNotesForTopic = useMemo(
    () => savedNotesByTopic[currentTopicKey] || [],
    [savedNotesByTopic, currentTopicKey]
  );

  useEffect(() => {
    localStorage.setItem("savedNotesByTopic", JSON.stringify(savedNotesByTopic));
  }, [savedNotesByTopic]);

  useEffect(() => {
    localStorage.setItem("wrongQuestionFlashcards", JSON.stringify(wrongQuestionFlashcards));
  }, [wrongQuestionFlashcards]);

  useEffect(() => {
    if (flashcardIndex > wrongQuestionFlashcards.length - 1) {
      setFlashcardIndex(Math.max(0, wrongQuestionFlashcards.length - 1));
    }
  }, [wrongQuestionFlashcards, flashcardIndex]);

  useEffect(() => {
    setCaptureAiResult(null);
  }, [captureDraft, currentTopicKey]);

  useEffect(() => {
    setAiAnalysisResult(null);
  }, [wrongQuestionDraftText]);

  const effectiveCaptureText = useMemo(() => normalizeWhitespace(captureDraft), [captureDraft]);
  const isCaptureEmpty = !effectiveCaptureText;

  const localCaptureAnalysis = useMemo(() => buildCaptureAnalysisLocal(captureDraft), [captureDraft]);

  const captureAnalysis = useMemo(() => {
    if (isCaptureEmpty) return EMPTY_CAPTURE_ANALYSIS;
    if (!captureAiResult) return localCaptureAnalysis;

    return {
      summary: captureAiResult.summary || localCaptureAnalysis.summary,
      bulletPoints:
        Array.isArray(captureAiResult.bulletPoints) && captureAiResult.bulletPoints.length
          ? captureAiResult.bulletPoints
          : localCaptureAnalysis.bulletPoints,
      logicLinks:
        Array.isArray(captureAiResult.logicLinks) && captureAiResult.logicLinks.length
          ? captureAiResult.logicLinks
          : localCaptureAnalysis.logicLinks,
      logicForest:
        Array.isArray(captureAiResult.logicForest) && captureAiResult.logicForest.length
          ? captureAiResult.logicForest
          : localCaptureAnalysis.logicForest
    };
  }, [captureAiResult, isCaptureEmpty, localCaptureAnalysis]);

  const wrongQuestionAnalysis = useMemo(
    () => ({
      questionText: aiAnalysisResult?.questionText || buildWrongQuestionQuestionText(wrongQuestionDraftText),
      summary: aiAnalysisResult?.summary || buildWrongQuestionSummary(wrongQuestionDraftText),
      correctAnswer: aiAnalysisResult?.correctAnswer || buildWrongQuestionCorrectAnswer(wrongQuestionDraftText),
      answerExtraction:
        aiAnalysisResult?.answerExtraction || buildWrongQuestionAnswerExtraction(wrongQuestionDraftText),
      bulletPoints: aiAnalysisResult?.bulletPoints || buildWrongQuestionBulletPoints(wrongQuestionDraftText),
      trapPoint: aiAnalysisResult?.trapPoint || buildWrongQuestionTrapPoint(wrongQuestionDraftText),
      memoryHook: aiAnalysisResult?.memoryHook || buildWrongQuestionMemoryHook(wrongQuestionDraftText)
    }),
    [wrongQuestionDraftText, aiAnalysisResult]
  );

  const currentFlashcard = wrongQuestionFlashcards[flashcardIndex] || null;

  const handleAnalyzeCapture = () => {
    if (!effectiveCaptureText) {
      setCaptureAiResult(null);
      setCaptureStatus("Editor is empty.");
      return;
    }

    setCaptureAiResult(null);
    setCaptureStatus("Local analysis refreshed.");
  };

  const handleCaptureTextareaKeyDown = event => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      setTimeout(() => {
        if (normalizeWhitespace(event.currentTarget.value)) {
          setCaptureStatus("Local analysis refreshed.");
        }
      }, 0);
    }
  };

  const handleSaveNote = () => {
    if (!captureDraft.trim()) {
      setCaptureStatus("Editor is empty.");
      return;
    }

    const newNote = {
      id: Date.now(),
      text: captureDraft.trim(),
      savedAt: new Date().toISOString()
    };

    setSavedNotesByTopic(prev => ({
      ...prev,
      [currentTopicKey]: [...(prev[currentTopicKey] || []), newNote]
    }));

    setCaptureDraft("");
    setCaptureAiResult(null);
    setCaptureStatus("Saved locally.");
  };

  const handleLoadSavedNotes = () => {
    if (!savedNotesForTopic.length) {
      setCaptureDraft("");
      setCaptureAiResult(null);
      setCaptureStatus(`No notes found for ${currentTopicKey}.`);
      return;
    }

    const mergedText = savedNotesForTopic.map(item => item.text).join("\n\n");
    setCaptureDraft(mergedText);
    setCaptureAiResult(null);
    setCaptureStatus(`${currentTopicKey} loaded ${savedNotesForTopic.length} note(s).`);
  };

  const handleLoadTopicSample = () => {
    setCaptureDraft(SAMPLE_BY_DIVISION[selectedDivision] || "");
    setCaptureAiResult(null);
    setCaptureStatus(`Loaded ${selectedDivision} sample.`);
  };

  const handleClearEditor = () => {
    setCaptureDraft("");
    setCaptureAiResult(null);
    setCaptureStatus("Editor cleared.");
  };

  const handleAnalyzeWrongQuestion = () => {
    if (!wrongQuestionDraftText.trim()) {
      setWrongQuestionStatus("Please provide text first.");
      return;
    }

    setAiAnalysisResult(null);
    setWrongQuestionStatus("Local analysis refreshed.");
  };

  const handleWrongQuestionTextareaKeyDown = event => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      setTimeout(() => {
        if (normalizeWhitespace(event.currentTarget.value)) {
          setWrongQuestionStatus("Local analysis refreshed.");
        }
      }, 0);
    }
  };

  const runOcrFromFile = async file => {
    if (!file) return;

    try {
      setIsRunningOcr(true);
      setWrongQuestionStatus("Reading image...");

      const result = await Tesseract.recognize(file, "eng");
      const detectedText = result?.data?.text?.trim() || "";

      if (!detectedText) {
        setWrongQuestionStatus("No text detected.");
        return;
      }

      setWrongQuestionOcrText(detectedText);
      setWrongQuestionDraftText(detectedText);
      setAiAnalysisResult(null);
      setWrongQuestionStatus("OCR completed.");
    } catch {
      setWrongQuestionStatus("OCR failed.");
    } finally {
      setIsRunningOcr(false);
    }
  };

  const handleWrongQuestionImageChange = async event => {
    const file = event.target.files?.[0] || null;

    if (!file) {
      setWrongQuestionImageFile(null);
      setWrongQuestionImagePreview("");
      setWrongQuestionStatus("No image selected.");
      return;
    }

    setWrongQuestionImageFile(file);
    setWrongQuestionStatus(`Selected: ${file.name}`);

    const reader = new FileReader();
    reader.onloadend = () => {
      setWrongQuestionImagePreview(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(file);

    await runOcrFromFile(file);
  };

  const handleRunOcr = async () => {
    if (!wrongQuestionImageFile) {
      setWrongQuestionStatus("Please select an image first.");
      return;
    }

    await runOcrFromFile(wrongQuestionImageFile);
  };

  const handleSaveWrongQuestion = () => {
    if (!wrongQuestionDraftText.trim()) {
      setWrongQuestionStatus("Text is empty.");
      return;
    }

    const newCard = {
      id: Date.now(),
      topicKey: currentTopicKey,
      imagePreview: wrongQuestionImagePreview,
      ocrText: wrongQuestionOcrText,
      editedText: wrongQuestionDraftText.trim(),
      questionText: wrongQuestionAnalysis.questionText,
      summary: wrongQuestionAnalysis.summary,
      correctAnswer: wrongQuestionAnalysis.correctAnswer,
      answerExtraction: wrongQuestionAnalysis.answerExtraction,
      bulletPoints: wrongQuestionAnalysis.bulletPoints,
      trapPoint: wrongQuestionAnalysis.trapPoint,
      memoryHook: wrongQuestionAnalysis.memoryHook,
      savedAt: new Date().toISOString()
    };

    setWrongQuestionFlashcards(prev => [newCard, ...prev]);
    setFlashcardIndex(0);
    setWrongQuestionStatus("Flashcard saved.");
  };

  const handleLoadSavedFlashcards = () => {
    const loaded = readWrongQuestionFlashcards();
    setWrongQuestionFlashcards(loaded);
    setFlashcardIndex(0);
    setWrongQuestionStatus(`Loaded ${loaded.length} flashcards.`);
  };

  const handleClearWrongQuestion = () => {
    setWrongQuestionImageFile(null);
    setWrongQuestionImagePreview("");
    setWrongQuestionOcrText("");
    setWrongQuestionDraftText("");
    setAiAnalysisResult(null);
    setWrongQuestionStatus("Cleared.");
  };

  const handlePrevFlashcard = () => {
    setFlashcardIndex(prev => Math.max(0, prev - 1));
  };

  const handleNextFlashcard = () => {
    setFlashcardIndex(prev => Math.min(wrongQuestionFlashcards.length - 1, prev + 1));
  };

  const handleDeleteFlashcard = idToDelete => {
    if (!window.confirm("Delete this flashcard?")) return;

    setWrongQuestionFlashcards(prev => prev.filter(card => card.id !== idToDelete));
    setFlashcardIndex(prev => (prev > 0 ? prev - 1 : 0));
    setWrongQuestionStatus("Deleted.");
  };

  const handleCaptureRunAI = async () => {
    if (!effectiveCaptureText) {
      setCaptureStatus("Please type notes first.");
      return;
    }

    setIsCaptureAnalyzing(true);
    setCaptureStatus("AI thinking...");

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: captureDraft, type: "capture" })
      });

      const data = await response.json();

      if (!response.ok) {
        setCaptureStatus(`AI Error: ${data.error || "Unknown error"}`);
      } else if (data.analysis) {
        setCaptureAiResult(data.analysis);
        setCaptureStatus("AI analysis complete.");
      } else {
        setCaptureStatus("AI Error: Invalid response.");
      }
    } catch {
      setCaptureStatus("AI Error: network or timeout. Check Vercel function and GEMINI_API_KEY.");
    } finally {
      setIsCaptureAnalyzing(false);
    }
  };

  const handleWrongQuestionRunAI = async () => {
    if (!wrongQuestionDraftText.trim()) {
      setWrongQuestionStatus("Please provide text first.");
      return;
    }

    setIsAnalyzing(true);
    setWrongQuestionStatus("AI analyzing...");

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: wrongQuestionDraftText, type: "wrong_question" })
      });

      const data = await response.json();

      if (!response.ok) {
        setWrongQuestionStatus(`AI Error: ${data.error || "Unknown error"}`);
      } else if (data.analysis) {
        setAiAnalysisResult(data.analysis);
        setWrongQuestionStatus("AI analysis complete.");
      } else {
        setWrongQuestionStatus("AI Error: Invalid response.");
      }
    } catch {
      setWrongQuestionStatus("AI Error: network or timeout. Check Vercel function and GEMINI_API_KEY.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const captureEngineMode = captureAiResult ? "ai" : "local";
  const wrongQuestionEngineMode = aiAnalysisResult ? "ai" : "local";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-title">ARE Study Vault</div>
          <div className="brand-subtitle">Capture notes, structure logic, and build wrong-question flashcards.</div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Memory Palace</div>
          <div className="division-list">
            {DIVISIONS.map(div => (
              <button
                key={div}
                className={`nav-pill ${selectedDivision === div ? "active" : ""}`}
                onClick={() => {
                  setSelectedDivision(div);
                  setSelectedRoom(ROOMS_BY_DIVISION[div][0]);
                }}
              >
                {div}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">{selectedDivision} Rooms</div>
          <div className="room-list">
            {rooms.map(room => (
              <button
                key={room}
                className={`room-pill ${selectedRoom === room ? "active" : ""}`}
                onClick={() => setSelectedRoom(room)}
              >
                {room}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="main-workspace">
        <section className="workspace-card capture-workspace">
          <div className="workspace-header">
            <h2>Capture Notes Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span>
              <span>{selectedRoom}</span>
              <span>Saved Notes: {savedNotesForTopic.length}</span>
            </div>
          </div>

          <div className="panel capture-editor-panel">
            <div className="panel-title">Capture Editor</div>
            <textarea
              className="panel-textarea"
              value={captureDraft}
              onChange={event => setCaptureDraft(event.target.value)}
              onKeyDown={handleCaptureTextareaKeyDown}
              placeholder="粘贴长笔记，本地智脑会自动生成结构化解析..."
            />
            <div className="button-row top-gap">
              <button onClick={handleAnalyzeCapture}>Analyze</button>
            </div>
          </div>

          <div className="panel capture-controls">
            <div className="button-row">
              <button onClick={handleSaveNote}>Save Note</button>
              <button onClick={handleLoadSavedNotes}>Load Saved Notes</button>
              <button onClick={handleLoadTopicSample}>Load {selectedDivision} Sample</button>
              <button onClick={handleClearEditor}>Clear Editor</button>
            </div>
            <div className="status-text success">{captureStatus}</div>
          </div>

          <div className="workspace-grid">
            <div className="panel capture-analysis-panel">
              <div className="panel-head-row">
                <h3>
                  Analysis <span className={`engine-badge ${captureEngineMode}`}>{captureEngineMode === "ai" ? "✨ AI Active" : "⚙️ Local Smart Engine"}</span>
                </h3>
                <button className="ask-ai-btn" onClick={handleCaptureRunAI} disabled={isCaptureAnalyzing}>
                  {isCaptureAnalyzing ? "Thinking..." : "✨ Ask AI"}
                </button>
              </div>

              <div className="analysis-stack">
                <CapturePanelSection title="Summary" empty={!captureAnalysis.summary}>
                  {captureAnalysis.summary || ""}
                </CapturePanelSection>

                <CapturePanelSection title="Bullet Points" empty={!captureAnalysis.bulletPoints.length}>
                  {captureAnalysis.bulletPoints.length ? (
                    <ul className="clean-list">
                      {captureAnalysis.bulletPoints.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    ""
                  )}
                </CapturePanelSection>

                <CapturePanelSection title="Logic Links" empty={!captureAnalysis.logicLinks.length}>
                  {captureAnalysis.logicLinks.length ? (
                    <ul className="clean-list logic-links-list">
                      {captureAnalysis.logicLinks.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    ""
                  )}
                </CapturePanelSection>
              </div>
            </div>

            <div className="panel live-logic-graph-panel">
              <div className="panel-head-row">
                <h3>
                  Live Logic Image <span className={`engine-badge ${captureEngineMode}`}>{captureEngineMode === "ai" ? "✨ AI Active" : "⚙️ Local Smart Engine"}</span>
                </h3>
              </div>

              <div className="logic-image-shell">
                {!captureAnalysis.logicForest.length ? (
                  <div className="analysis-box is-empty">{isCaptureEmpty ? "" : "输入内容生成导图..."}</div>
                ) : (
                  <div className="logic-forest">
                    {captureAnalysis.logicForest.map((tree, index) => (
                      <div key={`${tree.label}-${index}`} className="logic-tree-card">
                        <LogicTreeNode tree={tree} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="workspace-card wrong-question-workspace">
          <div className="workspace-header">
            <h2>Wrong Question Workspace</h2>
          </div>

          <div className="workspace-grid">
            <div className="panel wrong-question-input-panel">
              <div className="panel-title">Wrong Question Input</div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Image Upload</div>

                {wrongQuestionImagePreview ? (
                  <img src={wrongQuestionImagePreview} alt="Preview" className="image-preview" />
                ) : (
                  <div className="image-placeholder">Image Preview</div>
                )}

                <div className="button-row wrongq-button-row top-gap">
                  <label className="upload-nav-pill">
                    Upload Image
                    <input type="file" accept="image/*" onChange={handleWrongQuestionImageChange} hidden />
                  </label>

                  {wrongQuestionImagePreview ? (
                    <button
                      className="danger-lite-btn"
                      onClick={() => {
                        setWrongQuestionImageFile(null);
                        setWrongQuestionImagePreview("");
                      }}
                    >
                      Delete Image
                    </button>
                  ) : null}

                  <button className="nav-action-pill" onClick={handleRunOcr} disabled={isRunningOcr}>
                    {isRunningOcr ? "Running..." : "Run OCR"}
                  </button>
                </div>
              </div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Wrong Question Text</div>
                <textarea
                  className="panel-textarea wrong-question-textarea"
                  value={wrongQuestionDraftText}
                  onChange={event => setWrongQuestionDraftText(event.target.value)}
                  onKeyDown={handleWrongQuestionTextareaKeyDown}
                  placeholder="粘贴错题..."
                />
                <div className="button-row top-gap">
                  <button onClick={handleAnalyzeWrongQuestion}>Analyze</button>
                </div>
              </div>
            </div>

            <div className="panel wrong-question-analysis-panel">
              <div className="panel-head-row">
                <h3>
                  Analysis <span className={`engine-badge ${wrongQuestionEngineMode}`}>{wrongQuestionEngineMode === "ai" ? "✨ AI Active" : "⚙️ Local Smart Engine"}</span>
                </h3>
                <button className="ask-ai-btn" onClick={handleWrongQuestionRunAI} disabled={isAnalyzing}>
                  {isAnalyzing ? "Thinking..." : "✨ Ask AI"}
                </button>
              </div>

              <div className="analysis-mini-grid">
                <div className="subcard analysis-span-2">
                  <div className="subcard-title">Summary</div>
                  <div className="analysis-box">{wrongQuestionAnalysis.summary}</div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Correct Answer</div>
                  <div className="analysis-box">
                    {Array.isArray(wrongQuestionAnalysis.correctAnswer)
                      ? wrongQuestionAnalysis.correctAnswer.join(" / ")
                      : wrongQuestionAnalysis.correctAnswer}
                  </div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Memory Hook</div>
                  <div className="analysis-box">{wrongQuestionAnalysis.memoryHook}</div>
                </div>

                <div className="subcard analysis-span-2">
                  <div className="subcard-title">Bullet Points</div>
                  <div className="analysis-box">
                    <ul className="clean-list">
                      {wrongQuestionAnalysis.bulletPoints.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="subcard analysis-span-2">
                  <div className="subcard-title">Answer Extraction</div>
                  <div className="analysis-box">
                    <ul className="clean-list">
                      {wrongQuestionAnalysis.answerExtraction.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="subcard analysis-span-2">
                  <div className="subcard-title">Trap Point</div>
                  <div className="analysis-box">
                    <ul className="clean-list">
                      {wrongQuestionAnalysis.trapPoint.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel wrong-question-controls">
            <div className="button-row">
              <button onClick={handleSaveWrongQuestion}>Save Wrong Question</button>
              <button onClick={handleLoadSavedFlashcards}>Load Saved Flashcards</button>
              <button onClick={handleClearWrongQuestion}>Clear Wrong Question</button>
            </div>
            <div className="status-text success">{wrongQuestionStatus}</div>
          </div>

          <div className="panel flashcard-panel">
            <div className="panel-title">Wrong Question Flashcards</div>

            {!wrongQuestionFlashcards.length ? (
              <div className="flashcard-placeholder">No saved flashcards yet.</div>
            ) : (
              <div className="flashcard-carousel">
                <div className="flashcard-carousel-header">
                  <button onClick={handlePrevFlashcard} disabled={flashcardIndex === 0}>
                    ← Previous
                  </button>
                  <div className="flashcard-counter">
                    {flashcardIndex + 1} / {wrongQuestionFlashcards.length}
                  </div>
                  <button onClick={handleNextFlashcard} disabled={flashcardIndex === wrongQuestionFlashcards.length - 1}>
                    Next →
                  </button>
                </div>

                {currentFlashcard ? (
                  <div className="flashcard-slide">
                    <div className="flashcard-slide-top">
                      <div className="flashcard-meta">
                        {currentFlashcard.topicKey} · {formatSavedAt(currentFlashcard.savedAt)}
                      </div>
                      <button className="danger-lite-btn" onClick={() => handleDeleteFlashcard(currentFlashcard.id)}>
                        Delete
                      </button>
                    </div>

                    <div className="flashcard-slide-body">
                      <div className="flashcard-col">
                        {currentFlashcard.imagePreview ? (
                          <img
                            src={currentFlashcard.imagePreview}
                            alt="Wrong question"
                            className="flashcard-image"
                            onClick={() => setExpandedImage(currentFlashcard.imagePreview)}
                          />
                        ) : (
                          <div className="flashcard-no-image">No image</div>
                        )}

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Wrong Question Summary</div>
                          <p className="plain-paragraph">{currentFlashcard.summary}</p>
                        </div>
                      </div>

                      <div className="flashcard-col">
                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Correct Answer</div>
                          <p className="plain-paragraph">
                            {Array.isArray(currentFlashcard.correctAnswer)
                              ? currentFlashcard.correctAnswer.join(" / ")
                              : currentFlashcard.correctAnswer}
                          </p>
                        </div>

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Bullet Points</div>
                          <ul className="clean-list">
                            {(currentFlashcard.bulletPoints || []).map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Memory Hook</div>
                          <p className="plain-paragraph">{currentFlashcard.memoryHook}</p>
                        </div>

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Trap Point</div>
                          <ul className="clean-list">
                            {(currentFlashcard.trapPoint || []).map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Answer Extraction</div>
                          <ul className="clean-list">
                            {(currentFlashcard.answerExtraction || []).map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </main>

      {expandedImage ? (
        <div className="image-modal-backdrop" onClick={() => setExpandedImage("")}>
          <div className="image-modal-content" onClick={event => event.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setExpandedImage("")}>×</button>
            <img src={expandedImage} alt="Expanded" className="image-modal-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
