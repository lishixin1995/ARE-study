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

const PREDICATE_RE =
  /(relies on|uses|use|needs|need|requires|require|controls|control|reduces|reduce|minimizes|minimize|maximizes|maximize|optimizes|optimize|gains|gain|provides|provide|improves|improve|stabilizes|stabilize|limits|limit|affects|affect|influences|influence|includes|include|consists of|can be|is|are|means|refers to|defined as|helps|help|takes|take)/i;

const LEADING_VERB_RE =
  /^(relies on|uses|use|needs|need|requires|require|controls|control|reduces|reduce|minimizes|minimize|maximizes|maximize|optimizes|optimize|gains|gain|provides|provide|improves|improve|stabilizes|stabilize|limits|limit|affects|affect|influences|influence|includes|include|consists of|helps|help|takes|take|avoid|avoids|block|blocks|collect|collects|get|gets|minimize|maximize|optimize|gain|reduce|provide|store|stores)/i;

function normalizeWhitespace(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function stripBulletPrefix(line = "") {
  return line.replace(/^\s*(?:[-*•▪▫◦●○►▸▹]+|\d+[.)])\s+/, "").trim();
}

function cleanLine(line = "") {
  return normalizeWhitespace(stripBulletPrefix(line).replace(/[\t]+/g, " "));
}

function sentenceCase(text = "") {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function titleCaseLabel(text = "") {
  const trimmed = normalizeWhitespace(text)
    .replace(/^\[|\]$/g, "")
    .replace(/[.:;,!?]+$/g, "")
    .trim();

  if (!trimmed) return "";

  return trimmed
    .split(/\s+/)
    .map(word => {
      if (/^[A-Z0-9-]{2,}$/.test(word)) return word;
      if (word.length <= 2 && word === word.toLowerCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function relationLabel(raw = "") {
  const value = normalizeWhitespace(raw).toLowerCase();

  if (["is", "are", "means", "refers to", "defined as"].includes(value)) return "is";
  if (["use", "uses"].includes(value)) return "uses";
  if (["need", "needs", "require", "requires"].includes(value)) return "requires";
  if (["control", "controls"].includes(value)) return "controls";
  if (["reduce", "reduces"].includes(value)) return "reduces";
  if (["optimize", "optimizes"].includes(value)) return "optimizes";
  if (["gain", "gains"].includes(value)) return "gains";
  if (["help", "helps"].includes(value)) return "benefit";
  if (["take", "takes"].includes(value)) return "tradeoff";
  if (["include", "includes", "consists of"].includes(value)) return "includes";
  return value;
}

function inferGroupRelation(group = "", subject = "") {
  const groupLower = group.toLowerCase();
  const subjectLower = subject.toLowerCase();

  if (!groupLower || !subjectLower || groupLower === subjectLower) return null;
  if (groupLower.includes("system") && subjectLower.includes("system")) return "has type";
  if (groupLower.includes("climate") && subjectLower.includes("climate")) return "includes";
  if (groupLower.includes("strategy") || groupLower.includes("response")) return "includes";
  return "includes";
}

function createUnit(subject, relation, object, priority = 1) {
  const cleanSubject = titleCaseLabel(subject);
  const cleanRelation = normalizeWhitespace(relation);
  const cleanObject = sentenceCase(object)
    .replace(/^\[|\]$/g, "")
    .replace(/[.;]+$/g, "")
    .trim();

  if (!cleanSubject || !cleanRelation || !cleanObject) return null;

  return {
    subject: cleanSubject,
    relation: cleanRelation,
    object: cleanObject,
    priority
  };
}

function pushUnit(units, subject, relation, object, priority = 1) {
  const unit = createUnit(subject, relation, object, priority);
  if (!unit) return;

  const key = `${unit.subject}|||${unit.relation.toLowerCase()}|||${unit.object.toLowerCase()}`;
  if (!units.some(item => `${item.subject}|||${item.relation.toLowerCase()}|||${item.object.toLowerCase()}` === key)) {
    units.push(unit);
  }
}

function extractSubject(text = "") {
  const match = normalizeWhitespace(text).match(new RegExp(`^(.*?)\\s+${PREDICATE_RE.source}`, "i"));
  return match ? titleCaseLabel(match[1]) : "";
}

function splitCompoundClause(clause = "") {
  const clean = normalizeWhitespace(clause.replace(/[。！？]/g, ".").replace(/[;；]+/g, "."));
  if (!clean) return [];

  const splitter = clean
    .replace(/\s+(?:and|but)\s+(?=(uses?|needs?|requires?|controls?|reduces?|minimizes?|maximizes?|optimizes?|gains?|provides?|improves?|stabilizes?|limits?|affects?|influences?|includes?|consists of|helps?|takes?)\b)/gi, " | ");

  const parts = splitter
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

function looksLikeStandaloneHeader(line = "") {
  const clean = cleanLine(line).replace(/[:：]$/, "");
  if (!clean) return false;
  if (/[.!?。！？]$/.test(clean)) return false;
  return clean.split(/\s+/).length <= 6;
}

function shortHeadColon(line = "") {
  const match = cleanLine(line).match(/^([^:：]{1,48})[:：]\s*(.+)$/);
  if (!match) return null;

  const head = titleCaseLabel(match[1]);
  const rest = normalizeWhitespace(match[2]);
  if (!head || !rest) return null;
  if (head.split(/\s+/).length > 6) return null;

  return { head, rest };
}

function textToSemanticLines(text = "") {
  const byLine = text
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  if (byLine.length > 1) return byLine;

  return text
    .replace(/\r/g, "")
    .replace(/([.!?。！？;；])\s+/g, "$1\n")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);
}

function parseClause(clause, context, units) {
  const clean = normalizeWhitespace(clause).replace(/[.;]+$/g, "");
  if (!clean) return;

  const group = context?.group || "";
  const headerSubject = context?.headerSubject || "";

  if (/^in\s+/i.test(clean)) {
    const climateMatch = clean.match(/^in\s+([^,]+?)\s*,?\s*(.+)$/i);
    if (climateMatch) {
      const climate = titleCaseLabel(climateMatch[1]);
      const strategy = sentenceCase(climateMatch[2]);
      pushUnit(units, "Climate Response", "includes", climate, 3);
      pushUnit(units, climate, "strategy", strategy, 3);
      return;
    }
  }

  const helpMatch = clean.match(/^(.*?)\s+helps\s+(.+?)(?:\s+but\s+(.+))?$/i);
  if (helpMatch) {
    const subject = titleCaseLabel(helpMatch[1]);
    const benefit = sentenceCase(helpMatch[2]);
    const tradeoff = sentenceCase(helpMatch[3] || "");
    const parentRelation = inferGroupRelation(group, subject);

    if (parentRelation) pushUnit(units, group, parentRelation, subject, 2);
    pushUnit(units, subject, "benefit", benefit, 3);
    if (tradeoff) pushUnit(units, subject, "tradeoff", tradeoff, 3);
    return;
  }

  const mainMatch = clean.match(
    /^(.*?)\s+(relies on|uses|use|needs|need|requires|require|controls|control|reduces|reduce|minimizes|minimize|maximizes|maximize|optimizes|optimize|gains|gain|provides|provide|improves|improve|stabilizes|stabilize|limits|limit|affects|affect|influences|influence|includes|include|consists of|can be|is|are|means|refers to|defined as|takes|take)\s+(.+)$/i
  );

  if (mainMatch) {
    const subject = titleCaseLabel(mainMatch[1]);
    const relation = relationLabel(mainMatch[2]);
    const object = sentenceCase(mainMatch[3]);
    const parentRelation = inferGroupRelation(group, subject);

    if (parentRelation) pushUnit(units, group, parentRelation, subject, 2);
    pushUnit(units, subject, relation, object, 3);
    return;
  }

  if (headerSubject && LEADING_VERB_RE.test(clean)) {
    parseClause(`${headerSubject} ${clean}`, { group, headerSubject }, units);
    return;
  }

  if (headerSubject && !PREDICATE_RE.test(clean) && clean.split(/\s+/).length <= 10) {
    const parentRelation = inferGroupRelation(group, headerSubject);
    if (group && headerSubject !== group && parentRelation) {
      pushUnit(units, group, parentRelation, headerSubject, 2);
    }
    pushUnit(units, headerSubject, "is", clean, 2);
  }
}

function extractCaptureUnits(text = "") {
  const lines = textToSemanticLines(text);
  const units = [];
  let currentHeader = "";

  lines.forEach(line => {
    const colon = shortHeadColon(line);

    if (colon) {
      currentHeader = colon.head;
      if (LEADING_VERB_RE.test(colon.rest)) {
        splitCompoundClause(`${colon.head} ${colon.rest}`).forEach(part => {
          parseClause(part, { group: colon.head, headerSubject: colon.head }, units);
        });
        return;
      }

      splitCompoundClause(colon.rest).forEach(part => {
        parseClause(part, { group: colon.head, headerSubject: colon.head }, units);
      });
      return;
    }

    if (looksLikeStandaloneHeader(line)) {
      currentHeader = titleCaseLabel(line.replace(/[:：]$/, ""));
      return;
    }

    splitCompoundClause(line).forEach(part => {
      parseClause(part, { group: currentHeader, headerSubject: currentHeader }, units);
    });
  });

  return units;
}

function groupCaptureUnits(units = []) {
  const groups = {};

  units.forEach((unit, index) => {
    if (!groups[unit.subject]) {
      groups[unit.subject] = { items: [], firstIndex: index, score: 0 };
    }

    groups[unit.subject].items.push(unit);
    groups[unit.subject].score += unit.priority || 1;
  });

  return groups;
}

function joinObjects(items = []) {
  const clean = Array.from(
    new Set(
      items
        .map(item => sentenceCase(item))
        .filter(Boolean)
    )
  );

  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function subjectSentence(subject, items = []) {
  const byRelation = items.reduce((acc, item) => {
    const key = item.relation.toLowerCase();
    acc[key] = acc[key] || [];
    acc[key].push(item.object);
    return acc;
  }, {});

  const parts = [];

  if (byRelation["is"]) parts.push(`is ${joinObjects(byRelation["is"])}`);
  if (byRelation["relies on"]) parts.push(`relies on ${joinObjects(byRelation["relies on"])}`);
  if (byRelation["uses"]) parts.push(`uses ${joinObjects(byRelation["uses"])}`);
  if (byRelation["requires"]) parts.push(`requires ${joinObjects(byRelation["requires"])}`);
  if (byRelation["controls"]) parts.push(`controls ${joinObjects(byRelation["controls"])}`);
  if (byRelation["reduces"]) parts.push(`reduces ${joinObjects(byRelation["reduces"])}`);
  if (byRelation["optimizes"]) parts.push(`optimizes ${joinObjects(byRelation["optimizes"])}`);
  if (byRelation["gains"]) parts.push(`gains ${joinObjects(byRelation["gains"])}`);
  if (byRelation["provides"]) parts.push(`provides ${joinObjects(byRelation["provides"])}`);
  if (byRelation["benefit"]) parts.push(`helps ${joinObjects(byRelation["benefit"])}`);
  if (byRelation["tradeoff"]) parts.push(`but ${joinObjects(byRelation["tradeoff"])}`);
  if (byRelation["strategy"]) parts.push(`focuses on ${joinObjects(byRelation["strategy"])}`);
  if (byRelation["includes"]) parts.push(`includes ${joinObjects(byRelation["includes"])}`);
  if (byRelation["has type"]) parts.push(`includes ${joinObjects(byRelation["has type"])}`);

  if (!parts.length) return "";

  const sentence = `${subject} ${parts.join(" and ")}`
    .replace(/\s+and\s+but\s+/g, " but ")
    .replace(/\s+/g, " ")
    .trim();

  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

function buildCaptureSummaryLocal(text = "") {
  const units = extractCaptureUnits(text);
  if (!units.length) return "";

  const groups = groupCaptureUnits(units);
  const sentences = [];
  const usedSubjects = new Set();

  const active = groups["Active System"]?.items || [];
  const passive = groups["Passive System"]?.items || [];
  if (active.length || passive.length) {
    const activePart = active.length ? subjectSentence("Active systems", active) : "";
    const passivePart = passive.length ? subjectSentence("Passive systems", passive) : "";

    if (activePart && passivePart) {
      const left = activePart.replace(/\.$/, "");
      const right = passivePart.charAt(0).toLowerCase() + passivePart.slice(1).replace(/\.$/, "");
      sentences.push(`Building systems can be active or passive: ${left.slice(0, 1).toLowerCase() + left.slice(1)}, while ${right}.`);
    } else {
      if (activePart) sentences.push(activePart);
      if (passivePart) sentences.push(passivePart);
    }

    usedSubjects.add("Active System");
    usedSubjects.add("Passive System");
  }

  const cold = groups["Cold Climate"]?.items || [];
  const hot = groups["Hot Climate"]?.items || [];
  if (cold.length || hot.length) {
    const coldStrategy = cold.find(item => item.relation.toLowerCase() === "strategy")?.object || "";
    const hotStrategy = hot.find(item => item.relation.toLowerCase() === "strategy")?.object || "";

    if (coldStrategy || hotStrategy) {
      const parts = [];
      if (coldStrategy) parts.push(`in cold climates the goal is to ${coldStrategy.charAt(0).toLowerCase() + coldStrategy.slice(1)}`);
      if (hotStrategy) parts.push(`in hot climates the goal is to ${hotStrategy.charAt(0).toLowerCase() + hotStrategy.slice(1)}`);
      sentences.push(`Climate response changes by context: ${parts.join(", while ")}.`);
    }

    usedSubjects.add("Cold Climate");
    usedSubjects.add("Hot Climate");
    usedSubjects.add("Climate Response");
  }

  if (groups["Trombe Wall"]?.items?.length) {
    sentences.push(subjectSentence("A Trombe wall", groups["Trombe Wall"].items));
    usedSubjects.add("Trombe Wall");
  }

  const fallbackSubjects = Object.entries(groups)
    .filter(([subject]) => !usedSubjects.has(subject))
    .sort((a, b) => {
      if (b[1].score !== a[1].score) return b[1].score - a[1].score;
      return a[1].firstIndex - b[1].firstIndex;
    })
    .slice(0, Math.max(0, 4 - sentences.length));

  fallbackSubjects.forEach(([subject, group]) => {
    const line = subjectSentence(subject, group.items);
    if (line) sentences.push(line);
  });

  return sentences.slice(0, 4).join(" ").trim();
}

function buildCaptureBulletPointsLocal(text = "") {
  const units = extractCaptureUnits(text);
  if (!units.length) return [];

  const groups = groupCaptureUnits(units);
  const bullets = [];
  const used = new Set();

  const pushBullet = value => {
    const clean = value.replace(/\.$/, "").trim();
    if (clean && !bullets.includes(clean)) bullets.push(clean);
  };

  if (groups["Active System"]?.items?.length) {
    pushBullet(subjectSentence("Active system", groups["Active System"].items));
    used.add("Active System");
  }

  if (groups["Passive System"]?.items?.length) {
    pushBullet(subjectSentence("Passive system", groups["Passive System"].items));
    used.add("Passive System");
  }

  if (groups["Cold Climate"]?.items?.length) {
    pushBullet(subjectSentence("Cold climate", groups["Cold Climate"].items));
    used.add("Cold Climate");
  }

  if (groups["Hot Climate"]?.items?.length) {
    pushBullet(subjectSentence("Hot climate", groups["Hot Climate"].items));
    used.add("Hot Climate");
  }

  if (groups["Trombe Wall"]?.items?.length) {
    pushBullet(subjectSentence("Trombe wall", groups["Trombe Wall"].items));
    used.add("Trombe Wall");
  }

  Object.entries(groups)
    .filter(([subject, group]) => {
      if (used.has(subject)) return false;
      const relations = group.items.map(item => item.relation.toLowerCase());
      const onlyStructural = relations.every(rel => rel === "includes" || rel === "has type");
      return !onlyStructural;
    })
    .sort((a, b) => {
      if (b[1].score !== a[1].score) return b[1].score - a[1].score;
      return a[1].firstIndex - b[1].firstIndex;
    })
    .forEach(([subject, group]) => {
      pushBullet(subjectSentence(subject, group.items));
    });

  return bullets.slice(0, 8);
}

function buildCaptureLogicLinksLocal(text = "") {
  const units = extractCaptureUnits(text);
  return units.map(unit => `[${unit.subject}] ➔ ${unit.relation} ➔ [${unit.object}]`);
}

function buildCaptureLogicForestFromLinks(links = []) {
  const adjacency = new Map();
  const inbound = new Map();
  const nodes = new Set();

  links.forEach(link => {
    const parts = link.split("➔").map(item => item.trim());
    if (parts.length !== 3) return;

    const from = parts[0].replace(/^\[|\]$/g, "");
    const relation = parts[1];
    const to = parts[2].replace(/^\[|\]$/g, "");

    if (!from || !relation || !to) return;

    nodes.add(from);
    nodes.add(to);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ relation, to });
    inbound.set(to, (inbound.get(to) || 0) + 1);
    if (!inbound.has(from)) inbound.set(from, inbound.get(from) || 0);
  });

  const roots = Array.from(nodes)
    .filter(node => (inbound.get(node) || 0) === 0)
    .sort((a, b) => a.localeCompare(b));

  const buildNode = (label, path = new Set()) => {
    if (path.has(label)) return { label, relation: null, children: [] };

    const nextPath = new Set(path);
    nextPath.add(label);
    const children = (adjacency.get(label) || []).map(edge => {
      const childTree = buildNode(edge.to, nextPath);
      return {
        label: childTree.label,
        relation: edge.relation,
        children: childTree.children
      };
    });

    return { label, relation: null, children };
  };

  return (roots.length ? roots : Array.from(nodes).slice(0, 1)).map(root => buildNode(root));
}

function buildCaptureAnalysisLocal(text = "") {
  if (!normalizeWhitespace(text)) return EMPTY_CAPTURE_ANALYSIS;

  const summary = buildCaptureSummaryLocal(text);
  const bulletPoints = buildCaptureBulletPointsLocal(text);
  const logicLinks = buildCaptureLogicLinksLocal(text);
  const logicForest = buildCaptureLogicForestFromLinks(logicLinks);

  return {
    summary,
    bulletPoints,
    logicLinks,
    logicForest
  };
}

function splitLines(text) {
  return (text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeWrongQuestionLines(text) {
  return splitLines(text)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function filterMetaPlaceholder(items, prefix = "未检测到") {
  return (items || []).filter(item => item && !item.startsWith(prefix));
}

function inferWrongQuestionTopic(text) {
  const lower = (text || "").toLowerCase();

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

function buildWrongQuestionQuestionText(text) {
  const lines = normalizeWrongQuestionLines(text);
  const questionLines = [];

  for (const line of lines) {
    if (
      /^(?:☑|✔|☐|❌|\[x\]|\[\s\]|✓|✗)?\s*(?:Correct|Incorrect)[\.\s:-]+/i.test(line) ||
      /^correct answer\s*[:\-]/i.test(line)
    ) {
      break;
    }

    questionLines.push(line);
    if (questionLines.length >= 5) break;
  }

  return questionLines.length ? questionLines.join(" ") : "No question text yet.";
}

function buildWrongQuestionAnswerExtraction(text) {
  const correctLines = normalizeWrongQuestionLines(text).filter(line =>
    /^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i.test(line)
  );

  return correctLines.length
    ? correctLines.map(line => line.replace(/^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i, "").trim())
    : ["未检测到 Correct 关键词，请手动修改。"];
}

function buildWrongQuestionTrapPoint(text) {
  const incorrectLines = normalizeWrongQuestionLines(text).filter(line =>
    /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i.test(line)
  );

  return incorrectLines.length
    ? incorrectLines.map(line => line.replace(/^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i, "").trim())
    : ["未检测到 Incorrect 关键词。"];
}

function buildWrongQuestionCorrectAnswer(text) {
  const explicitMatch = (text || "").match(/correct answer\s*[:\-]\s*(.+)/i);
  if (explicitMatch) return explicitMatch[1].trim();

  const correct = filterMetaPlaceholder(buildWrongQuestionAnswerExtraction(text));
  return correct.length ? correct : "等待输入...";
}

function buildWrongQuestionBulletPoints(text) {
  const correct = filterMetaPlaceholder(buildWrongQuestionAnswerExtraction(text));
  const trap = filterMetaPlaceholder(buildWrongQuestionTrapPoint(text));
  const bullets = [];

  correct.forEach(item => bullets.push(`Correct move: ${item}`));
  trap.slice(0, 3).forEach(item => bullets.push(`Trap: ${item}`));

  return bullets.length ? bullets : ["等待输入..."];
}

function buildWrongQuestionMemoryHook(text) {
  const lower = (text || "").toLowerCase();

  if (/sustain|recycled|low-voc|prefab|smart technology/.test(lower)) {
    return "先抓题目真正的目标，再选最直接支持目标的策略；不是所有看起来环保的选项都一定对。";
  }

  if (/egress|exit|occupancy|fire|code/.test(lower)) {
    return "先判断题目问的是哪条 code 条件，再排除那些看似合理但不满足触发条件的选项。";
  }

  if (/structure|load|beam|column|foundation/.test(lower)) {
    return "先看受力逻辑，再看构件选择；不要只凭表面经验选答案。";
  }

  return "先抓题目问的核心目标，再选直接对应目标的答案。";
}

function buildWrongQuestionSummary(text) {
  if (!text) return "等待输入...";

  const topic = inferWrongQuestionTopic(text);
  const question = buildWrongQuestionQuestionText(text);
  const correct = filterMetaPlaceholder(buildWrongQuestionAnswerExtraction(text));
  const trap = filterMetaPlaceholder(buildWrongQuestionTrapPoint(text));

  if (correct.length > 0) {
    const correctPreview = correct.slice(0, 2).join("；");
    const trapPreview = trap.length ? ` 容易误选的是：${trap[0]}` : "";
    return `这道错题主要考 ${topic}。核心不是看到“好像也不错”的选项就选，而是判断哪些策略最直接满足题目目标。正确抓手是：${correctPreview}。${trapPreview}`;
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

function CapturePanelSection({ title, children, empty = false }) {
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

  const currentTopicKey = useMemo(
    () => `${selectedDivision}::${selectedRoom}`,
    [selectedDivision, selectedRoom]
  );

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

  const localCaptureAnalysis = useMemo(
    () => buildCaptureAnalysisLocal(captureDraft),
    [captureDraft]
  );

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
      questionText:
        aiAnalysisResult?.questionText || buildWrongQuestionQuestionText(wrongQuestionDraftText),
      summary: aiAnalysisResult?.summary || buildWrongQuestionSummary(wrongQuestionDraftText),
      correctAnswer:
        aiAnalysisResult?.correctAnswer || buildWrongQuestionCorrectAnswer(wrongQuestionDraftText),
      answerExtraction:
        aiAnalysisResult?.answerExtraction ||
        buildWrongQuestionAnswerExtraction(wrongQuestionDraftText),
      bulletPoints:
        aiAnalysisResult?.bulletPoints || buildWrongQuestionBulletPoints(wrongQuestionDraftText),
      trapPoint: aiAnalysisResult?.trapPoint || buildWrongQuestionTrapPoint(wrongQuestionDraftText),
      memoryHook:
        aiAnalysisResult?.memoryHook || buildWrongQuestionMemoryHook(wrongQuestionDraftText)
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
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: captureDraft, type: "capture" })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setCaptureStatus(`AI Error: ${data?.error || `HTTP ${res.status}`}`);
        return;
      }

      if (data?.analysis) {
        setCaptureAiResult(data.analysis);
        setCaptureStatus("AI analysis complete.");
      } else {
        setCaptureStatus("AI Error: Invalid response.");
      }
    } catch {
      setCaptureStatus("AI Error: request failed. Check Vercel deployment and GEMINI_API_KEY.");
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
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: wrongQuestionDraftText, type: "wrong_question" })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setWrongQuestionStatus(`AI Error: ${data?.error || `HTTP ${res.status}`}`);
        return;
      }

      if (data?.analysis) {
        setAiAnalysisResult(data.analysis);
        setWrongQuestionStatus("AI analysis complete.");
      } else {
        setWrongQuestionStatus("AI Error: Invalid response.");
      }
    } catch {
      setWrongQuestionStatus("AI Error: request failed. Check Vercel deployment and GEMINI_API_KEY.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-title">ARE Study Vault</div>
          <div className="brand-subtitle">Capture notes, analyze logic, and save wrong questions.</div>
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
                  Analysis{" "}
                  <span className={`engine-badge ${captureAiResult ? "ai" : "local"}`}>
                    {captureAiResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
                </h3>
                <button className="ask-ai-btn" onClick={handleCaptureRunAI} disabled={isCaptureAnalyzing}>
                  {isCaptureAnalyzing ? "Thinking..." : "✨ Ask AI"}
                </button>
              </div>

              <div className="analysis-stack">
                <CapturePanelSection title="Summary" empty={isCaptureEmpty || !captureAnalysis.summary}>
                  {!isCaptureEmpty ? captureAnalysis.summary : ""}
                </CapturePanelSection>

                <CapturePanelSection
                  title="Bullet Points"
                  empty={isCaptureEmpty || !captureAnalysis.bulletPoints.length}
                >
                  {!isCaptureEmpty && captureAnalysis.bulletPoints.length ? (
                    <ul className="clean-list">
                      {captureAnalysis.bulletPoints.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </CapturePanelSection>

                <CapturePanelSection
                  title="Logic Links"
                  empty={isCaptureEmpty || !captureAnalysis.logicLinks.length}
                >
                  {!isCaptureEmpty && captureAnalysis.logicLinks.length ? (
                    <ul className="clean-list logic-links-list">
                      {captureAnalysis.logicLinks.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </CapturePanelSection>
              </div>
            </div>

            <div className="panel live-logic-graph-panel">
              <div className="panel-head-row">
                <h3>
                  Live Logic Image{" "}
                  <span className={`engine-badge ${captureAiResult ? "ai" : "local"}`}>
                    {captureAiResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
                </h3>
              </div>

              <div className="logic-image-shell">
                {!isCaptureEmpty && captureAnalysis.logicForest.length ? (
                  <div className="logic-forest">
                    {captureAnalysis.logicForest.map((tree, index) => (
                      <div key={`${tree.label}-${index}`} className="logic-tree-card">
                        <LogicTreeNode tree={tree} />
                      </div>
                    ))}
                  </div>
                ) : null}
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

                <div className="button-row top-gap wrongq-button-row">
                  <label className="nav-pill upload-nav-pill">
                    Upload Image
                    <input type="file" accept="image/*" onChange={handleWrongQuestionImageChange} hidden />
                  </label>

                  {wrongQuestionImagePreview ? (
                    <button className="danger-lite-btn" onClick={() => {
                      setWrongQuestionImageFile(null);
                      setWrongQuestionImagePreview("");
                    }}>
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
                  Analysis{" "}
                  <span className={`engine-badge ${aiAnalysisResult ? "ai" : "local"}`}>
                    {aiAnalysisResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
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
                  <button
                    onClick={handleNextFlashcard}
                    disabled={flashcardIndex === wrongQuestionFlashcards.length - 1}
                  >
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
