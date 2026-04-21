import { useEffect, useMemo, useRef, useState } from "react";
import Tesseract from "tesseract.js";
import "./App.css";

const DIVISIONS = ["PA", "PPD", "PDD", "PCM", "PJM", "CE"];

const DEFAULT_ROOM_NAMES = {
  PA: ["Site", "Zoning", "Code", "Programming"],
  PPD: ["Site Planning", "Climate", "Structure", "Systems"],
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
  logicLinks: []
};

const CAPTURE_NOTE_META_MARKER = "\n\n[[STUDY_CAPTURE_META_V1]]";

function cloneCaptureAnalysis(analysis = EMPTY_CAPTURE_ANALYSIS) {
  return {
    summary: typeof analysis?.summary === "string" ? analysis.summary : "",
    bulletPoints: Array.isArray(analysis?.bulletPoints) ? [...analysis.bulletPoints] : [],
    logicLinks: Array.isArray(analysis?.logicLinks) ? [...analysis.logicLinks] : []
  };
}

function buildEmptyCaptureWorkspace(status = "Ready.") {
  return {
    draft: "",
    localAnalysis: cloneCaptureAnalysis(EMPTY_CAPTURE_ANALYSIS),
    aiResult: null,
    analysisSourceText: "",
    analysisCleared: true,
    status
  };
}

function buildCaptureWorkspaceFromState({
  draft = "",
  localAnalysis = EMPTY_CAPTURE_ANALYSIS,
  aiResult = null,
  analysisSourceText = "",
  analysisCleared = true,
  status = "Ready."
} = {}) {
  return {
    draft: String(draft || ""),
    localAnalysis: cloneCaptureAnalysis(localAnalysis),
    aiResult: aiResult ? JSON.parse(JSON.stringify(aiResult)) : null,
    analysisSourceText: String(analysisSourceText || ""),
    analysisCleared: Boolean(analysisCleared),
    status: String(status || "Ready.")
  };
}

function buildStoredCaptureNoteMeta(workspace = {}) {
  return {
    version: 1,
    localAnalysis: cloneCaptureAnalysis(workspace.localAnalysis),
    aiResult: workspace.aiResult ? JSON.parse(JSON.stringify(workspace.aiResult)) : null,
    analysisSourceText: String(workspace.analysisSourceText || ""),
    analysisCleared: Boolean(workspace.analysisCleared)
  };
}

function parseCaptureNoteStorage(rawText = "") {
  let remaining = String(rawText || "");
  const parsedMetaCandidates = [];

  while (remaining.includes(CAPTURE_NOTE_META_MARKER)) {
    const markerIndex = remaining.lastIndexOf(CAPTURE_NOTE_META_MARKER);
    const beforeMarker = remaining.slice(0, markerIndex);
    const afterMarker = remaining.slice(markerIndex + CAPTURE_NOTE_META_MARKER.length).trim();

    try {
      const parsedMeta = afterMarker ? JSON.parse(afterMarker) : null;
      if (parsedMeta && typeof parsedMeta === "object") {
        parsedMetaCandidates.push(parsedMeta);
      }
    } catch {
      // Ignore invalid trailing metadata and keep stripping older markers if present.
    }

    remaining = beforeMarker;
  }

  const visibleText = remaining.trim();
  const meaningfulMeta = parsedMetaCandidates.find(candidate => {
    if (!candidate || typeof candidate !== "object") return false;
    if (candidate.aiResult) return true;
    if (candidate.analysisCleared === false && normalizeWhitespace(candidate.analysisSourceText || visibleText)) {
      return true;
    }

    const localAnalysis = candidate.localAnalysis || {};
    return Boolean(
      normalizeWhitespace(localAnalysis.summary) ||
        (Array.isArray(localAnalysis.bulletPoints) && localAnalysis.bulletPoints.length) ||
        (Array.isArray(localAnalysis.logicLinks) && localAnalysis.logicLinks.length)
    );
  });

  return {
    visibleText,
    meta: meaningfulMeta || parsedMetaCandidates[0] || null
  };
}

function getCaptureNoteVisibleText(noteOrText = "") {
  const preferredText =
    typeof noteOrText === "string"
      ? noteOrText
      : typeof noteOrText?.plainText === "string"
        ? noteOrText.plainText
        : noteOrText?.text || "";

  return parseCaptureNoteStorage(preferredText).visibleText;
}

function getCaptureNoteStoredMeta(note = null, fallbackText = "") {
  if (note?.captureMeta && typeof note.captureMeta === "object") {
    return note.captureMeta;
  }

  return parseCaptureNoteStorage(note?.text || "").meta;
}

function normalizeStoredCaptureNoteMeta(meta, fallbackText = "") {
  const visibleText = String(fallbackText || "").trim();
  const hasVisibleText = Boolean(normalizeWhitespace(visibleText));
  const fallbackLocalAnalysis = hasVisibleText
    ? buildLocalCaptureAnalysis(visibleText)
    : cloneCaptureAnalysis(EMPTY_CAPTURE_ANALYSIS);

  if (!meta || typeof meta !== "object") {
    return {
      localAnalysis: fallbackLocalAnalysis,
      aiResult: null,
      analysisSourceText: hasVisibleText ? visibleText : "",
      analysisCleared: !hasVisibleText
    };
  }

  const normalizedSourceText = String(meta.analysisSourceText || "").trim();
  const normalizedLocalAnalysis = cloneCaptureAnalysis(meta.localAnalysis || fallbackLocalAnalysis);
  const hasLocalAnalysis =
    Boolean(normalizeWhitespace(normalizedLocalAnalysis.summary)) ||
    normalizedLocalAnalysis.bulletPoints.length > 0 ||
    normalizedLocalAnalysis.logicLinks.length > 0;

  const normalizedCleared =
    typeof meta.analysisCleared === "boolean"
      ? meta.analysisCleared
      : !(meta.aiResult || hasLocalAnalysis || normalizeWhitespace(normalizedSourceText || visibleText));

  return {
    localAnalysis: normalizedLocalAnalysis,
    aiResult: meta.aiResult ? JSON.parse(JSON.stringify(meta.aiResult)) : null,
    analysisSourceText: normalizedCleared ? "" : normalizedSourceText || visibleText,
    analysisCleared: normalizedCleared
  };
}

function buildStoredCaptureNoteText(visibleText = "", workspace = {}) {
  const cleanText = getCaptureNoteVisibleText(String(visibleText || ""));
  const meta = buildStoredCaptureNoteMeta(workspace);

  return `${cleanText}${CAPTURE_NOTE_META_MARKER}${JSON.stringify(meta)}`;
}

function resolveCaptureAnalysisState({
  localAnalysis = EMPTY_CAPTURE_ANALYSIS,
  aiResult = null,
  analysisSourceText = "",
  analysisCleared = true
} = {}) {
  if (analysisCleared || !normalizeWhitespace(analysisSourceText)) {
    return EMPTY_CAPTURE_ANALYSIS;
  }

  if (aiResult) {
    const normalized = normalizeAiCaptureAnalysis(aiResult);
    return {
      summary: normalized.summary || localAnalysis.summary,
      bulletPoints: normalized.bulletPoints.length ? normalized.bulletPoints : localAnalysis.bulletPoints,
      logicLinks: normalized.logicLinks.length ? normalized.logicLinks : localAnalysis.logicLinks
    };
  }

  return cloneCaptureAnalysis(localAnalysis);
}

function resolveCaptureMindMapState({ aiResult = null, analysisSourceText = "", analysisCleared = true } = {}) {
  if (analysisCleared || !normalizeWhitespace(analysisSourceText)) return null;

  if (aiResult) {
    const normalized = normalizeAiCaptureAnalysis(aiResult);
    if (normalized.logicForest) return normalized.logicForest;
  }

  return buildMindMapFromText(analysisSourceText);
}

function getCaptureNoteSnapshot(note) {
  const visibleText = getCaptureNoteVisibleText(note);
  const normalizedMeta = normalizeStoredCaptureNoteMeta(getCaptureNoteStoredMeta(note, visibleText), visibleText);
  const workspace = {
    draft: visibleText,
    localAnalysis: cloneCaptureAnalysis(normalizedMeta.localAnalysis),
    aiResult: normalizedMeta.aiResult ? JSON.parse(JSON.stringify(normalizedMeta.aiResult)) : null,
    analysisSourceText: normalizedMeta.analysisSourceText,
    analysisCleared: normalizedMeta.analysisCleared,
    status: ""
  };

  return {
    visibleText,
    sourceText: workspace.analysisCleared ? "" : workspace.analysisSourceText,
    analysis: resolveCaptureAnalysisState(workspace),
    mindMap: resolveCaptureMindMapState(workspace),
    workspace
  };
}

function combineCaptureAnalysisSnapshots(snapshots = []) {
  const validSnapshots = snapshots.filter(snapshot => {
    const analysis = snapshot?.analysis || EMPTY_CAPTURE_ANALYSIS;
    return Boolean(
      analysis.summary ||
        (Array.isArray(analysis.bulletPoints) && analysis.bulletPoints.length) ||
        (Array.isArray(analysis.logicLinks) && analysis.logicLinks.length)
    );
  });

  if (!validSnapshots.length) return EMPTY_CAPTURE_ANALYSIS;

  const summary = validSnapshots
    .map(snapshot => String(snapshot.analysis.summary || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  const bulletPoints = Array.from(
    new Set(
      validSnapshots.flatMap(snapshot =>
        (snapshot.analysis.bulletPoints || []).map(item => String(item || "").trim()).filter(Boolean)
      )
    )
  );

  const logicLinks = Array.from(
    new Set(
      validSnapshots.flatMap(snapshot =>
        (snapshot.analysis.logicLinks || []).map(item => String(item || "").trim()).filter(Boolean)
      )
    )
  );

  return {
    summary,
    bulletPoints,
    logicLinks
  };
}

function combineCaptureMindMapSnapshots(label = "Study Notes", snapshots = []) {
  const nodes = snapshots.map(snapshot => snapshot?.mindMap).filter(Boolean);
  if (!nodes.length) return null;
  if (nodes.length === 1) return nodes[0];

  return {
    label: normalizeWhitespace(label) || "Study Notes",
    type: "topic",
    children: nodes
  };
}

function buildCaptureWorkspaceFromNote(note, statusMessage = "Loaded latest saved note.") {
  const snapshot = getCaptureNoteSnapshot(note);

  return {
    draft: snapshot.visibleText,
    localAnalysis: cloneCaptureAnalysis(snapshot.workspace.localAnalysis),
    aiResult: snapshot.workspace.aiResult ? JSON.parse(JSON.stringify(snapshot.workspace.aiResult)) : null,
    analysisSourceText: snapshot.workspace.analysisSourceText,
    analysisCleared: snapshot.workspace.analysisCleared,
    status: statusMessage
  };
}

function createCaptureWorkspaceKey(division = "", roomId = "", subroomId = "") {
  if (!division || !roomId || !subroomId) return "";
  return `${division}::${roomId}::${subroomId}`;
}

function areCaptureWorkspacesEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return (
    String(a.draft || "") === String(b.draft || "") &&
    String(a.analysisSourceText || "") === String(b.analysisSourceText || "") &&
    Boolean(a.analysisCleared) === Boolean(b.analysisCleared) &&
    String(a.status || "") === String(b.status || "") &&
    JSON.stringify(cloneCaptureAnalysis(a.localAnalysis)) === JSON.stringify(cloneCaptureAnalysis(b.localAnalysis)) &&
    JSON.stringify(a.aiResult || null) === JSON.stringify(b.aiResult || null)
  );
}

function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWhitespace(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function titleCase(text = "") {
  const clean = normalizeWhitespace(text).replace(/[.:;,!]+$/g, "").trim();
  if (!clean) return "";

  return clean
    .split(" ")
    .map((word, index) => {
      if (!word) return "";
      const lower = word.toLowerCase();
      if (index > 0 && ["and", "or", "of", "to", "in", "on", "for", "by", "with"].includes(lower)) {
        return lower;
      }
      if (/^[A-Z0-9-]{2,}$/.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function sentenceCase(text = "") {
  const clean = normalizeWhitespace(text).replace(/[.;]+$/g, "").trim();
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function splitEditorLines(text = "") {
  const byLine = String(text)
    .replace(/\r/g, "")
    .split("\n")
    .map(item => item.trim())
    .filter(Boolean);

  if (byLine.length > 1) return byLine;

  return String(text)
    .replace(/\r/g, "")
    .replace(/([.!?。！？;；])\s+/g, "$1\n")
    .split("\n")
    .map(item => item.trim())
    .filter(Boolean);
}

function readSavedCaptureNotes() {
  try {
    const raw = localStorage.getItem("savedCaptureNotes");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
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
    : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(
        2,
        "0"
      )} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function getRoomsForDivision(roomTree, division) {
  return Array.isArray(roomTree?.[division]) ? roomTree[division] : [];
}

function findRoomById(roomTree, division, roomId) {
  return getRoomsForDivision(roomTree, division).find(room => room.id === roomId) || null;
}

function findSubroomById(roomTree, division, roomId, subroomId) {
  const room = findRoomById(roomTree, division, roomId);
  if (!room) return null;
  return (room.children || []).find(child => child.id === subroomId) || null;
}

function getCurrentPathLabel(roomTree, division, roomId, subroomId) {
  const room = findRoomById(roomTree, division, roomId);
  const subroom = findSubroomById(roomTree, division, roomId, subroomId);

  if (subroom) return `${division} / ${room?.name || ""} / ${subroom.name}`;
  if (room) return `${division} / ${room.name}`;
  return division;
}

function parseListItems(text = "") {
  const clean = text.replace(/[.;]+$/g, "").trim();
  if (!clean) return [];

  if (clean.includes(",")) {
    return clean
      .split(",")
      .map(item => item.replace(/\band\b/gi, "").trim())
      .filter(Boolean)
      .map(sentenceCase);
  }

  if (/\sand\s/.test(clean) && clean.split(/\sand\s/).length <= 4) {
    return clean
      .split(/\sand\s/gi)
      .map(item => item.trim())
      .filter(Boolean)
      .map(sentenceCase);
  }

  return [sentenceCase(clean)];
}

function uniqueByLabel(items = []) {
  const seen = new Set();
  return items.filter(item => {
    const key = normalizeWhitespace(item?.label || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMindMapFromText(text = "") {
  const lines = splitEditorLines(text);
  if (!lines.length) return null;

  let rootLabel = "Study Notes";
  const firstColon = lines[0].match(/^([^:：]{1,40})[:：]\s*(.+)$/);

  if (firstColon) {
    rootLabel = titleCase(firstColon[1]);
  } else {
    rootLabel = titleCase(lines[0].split(" ").slice(0, 4).join(" ")) || "Study Notes";
  }

  const root = {
    label: rootLabel,
    children: []
  };

  function addTopNode(node) {
    if (!node?.label) return;
    root.children.push(node);
  }

  function buildLeaf(label) {
    return { label: sentenceCase(label), children: [] };
  }

  function buildBranch(subject, childLabels = []) {
    return {
      label: titleCase(subject),
      children: childLabels.map(item => buildLeaf(item))
    };
  }

  function parseActionRemainder(relation, remainder) {
    const clean = remainder.replace(/[.;]+$/g, "").trim();

    if (!clean) return [];

    const lowerRelation = relation.toLowerCase();

    if (/^mechanical equipment and uses more energy$/i.test(clean)) {
      return ["Mechanical equipment", "Uses more energy"];
    }

    if (/^sun,\s*air,\s*and wind flow$/i.test(clean)) {
      return ["Sun", "Air", "Wind flow"];
    }

    if (lowerRelation === "reduce" && /^heat loss and gain solar heat$/i.test(clean)) {
      return ["Reduce heat loss", "Gain solar heat"];
    }

    if (lowerRelation === "control" && /^heat gain and optimize natural ventilation$/i.test(clean)) {
      return ["Control heat gain", "Optimize natural ventilation"];
    }

    if ((lowerRelation === "helps" || lowerRelation === "stabilizes") && /^temperature but takes more space$/i.test(clean)) {
      return ["Stabilizes temperature", "Takes more space"];
    }

    if (/^(.+?)\s+and uses\s+(.+)$/i.test(clean)) {
      const match = clean.match(/^(.+?)\s+and uses\s+(.+)$/i);
      return [sentenceCase(match[1]), sentenceCase(`Uses ${match[2]}`)];
    }

    if (/^(.+?)\s+and gain\s+(.+)$/i.test(clean)) {
      const match = clean.match(/^(.+?)\s+and gain\s+(.+)$/i);
      return [sentenceCase(`Reduce ${match[1]}`), sentenceCase(`Gain ${match[2]}`)];
    }

    if (/^(.+?)\s+and optimize\s+(.+)$/i.test(clean)) {
      const match = clean.match(/^(.+?)\s+and optimize\s+(.+)$/i);
      return [sentenceCase(`Control ${match[1]}`), sentenceCase(`Optimize ${match[2]}`)];
    }

    if (/^(.+?)\s+but takes\s+(.+)$/i.test(clean)) {
      const match = clean.match(/^(.+?)\s+but takes\s+(.+)$/i);
      return [sentenceCase(`Stabilizes ${match[1]}`), sentenceCase(`Takes ${match[2]}`)];
    }

    if (lowerRelation === "relies on") {
      const items = parseListItems(clean);
      if (items.length > 1) return items;
      return [sentenceCase(`Relies on ${clean}`)];
    }

    if (["reduce", "gain", "control", "optimize", "uses", "stabilizes", "helps", "takes"].includes(lowerRelation)) {
      return [sentenceCase(`${titleCase(lowerRelation)} ${clean}`)];
    }

    return [sentenceCase(clean)];
  }

  lines.forEach((line, index) => {
    const clean = line.replace(/[•\-–—]\s*/g, "").trim();
    if (!clean) return;

    const colonMatch = clean.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
    if (colonMatch) {
      const left = titleCase(colonMatch[1]);
      const right = colonMatch[2].trim();

      if (index === 0 && left === rootLabel) {
        const actionMatch = right.match(/^(.*?)\s+(relies on|uses|use|controls|control|reduces|reduce|gain|gains|optimizes|optimize|stabilizes|stabilize|helps|help|takes|take)\s+(.+)$/i);
        if (actionMatch) {
          addTopNode(buildBranch(actionMatch[1], parseActionRemainder(actionMatch[2], actionMatch[3])));
        } else {
          addTopNode(buildBranch(left, parseListItems(right)));
        }
      } else {
        addTopNode(buildBranch(left, parseListItems(right)));
      }
      return;
    }

    const inClimateMatch = clean.match(/^In\s+([^,]+),\s*(.+)$/i);
    if (inClimateMatch) {
      addTopNode(buildBranch(inClimateMatch[1], parseActionRemainder("control", inClimateMatch[2]).length ? parseActionRemainder("control", inClimateMatch[2]) : parseListItems(inClimateMatch[2])));
      return;
    }

    const generalMatch = clean.match(
      /^(.*?)\s+(relies on|uses|use|controls|control|reduces|reduce|gain|gains|optimizes|optimize|stabilizes|stabilize|helps|help|takes|take)\s+(.+)$/i
    );

    if (generalMatch) {
      addTopNode(buildBranch(generalMatch[1], parseActionRemainder(generalMatch[2], generalMatch[3])));
      return;
    }

    addTopNode(buildBranch(clean, []));
  });

  root.children = uniqueByLabel(root.children);
  return root;
}

function buildLocalCaptureAnalysis(text = "") {
  const lines = splitEditorLines(text);
  if (!lines.length) return EMPTY_CAPTURE_ANALYSIS;

  const bulletPoints = lines.map(line => sentenceCase(line.replace(/[.;]+$/g, ""))).slice(0, 8);

  const summary =
    lines.length <= 2
      ? bulletPoints.join(" ")
      : `${bulletPoints.slice(0, 2).join(" ")} ${bulletPoints.length > 2 ? bulletPoints[2] : ""}`.trim();

  const logicLinks = [];

  lines.forEach(line => {
    const clean = line.replace(/[.;]+$/g, "").trim();

    if (/^([^:：]+)[:：]\s*(.+)$/i.test(clean)) {
      const match = clean.match(/^([^:：]+)[:：]\s*(.+)$/i);
      const parent = titleCase(match[1]);
      const right = match[2];

      if (/^(.*?)\s+(relies on|uses|controls|reduces|reduce|gain|gains|optimizes|optimize|stabilizes|helps|takes)\s+(.+)$/i.test(right)) {
        const actionMatch = right.match(
          /^(.*?)\s+(relies on|uses|controls|reduces|reduce|gain|gains|optimizes|optimize|stabilizes|helps|takes)\s+(.+)$/i
        );
        logicLinks.push(`${parent} --> ${titleCase(actionMatch[1])} --> ${sentenceCase(actionMatch[3])}`);
      } else {
        logicLinks.push(`${parent} --> ${sentenceCase(right)}`);
      }
      return;
    }

    if (/^In\s+([^,]+),\s*(.+)$/i.test(clean)) {
      const match = clean.match(/^In\s+([^,]+),\s*(.+)$/i);
      logicLinks.push(`${titleCase(match[1])} --> ${sentenceCase(match[2])}`);
      return;
    }

    if (/^(.*?)\s+(relies on|uses|controls|reduces|reduce|gain|gains|optimizes|optimize|stabilizes|helps|takes)\s+(.+)$/i.test(clean)) {
      const match = clean.match(
        /^(.*?)\s+(relies on|uses|controls|reduces|reduce|gain|gains|optimizes|optimize|stabilizes|helps|takes)\s+(.+)$/i
      );
      logicLinks.push(`${titleCase(match[1])} --> ${sentenceCase(match[3])}`);
      return;
    }

    logicLinks.push(sentenceCase(clean));
  });

  return {
    summary,
    bulletPoints,
    logicLinks
  };
}

function normalizeLogicTreeNode(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;

  const label = normalizeWhitespace(node.label || node.title || node.name || "");
  if (!label) return null;

  const rawChildren = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.nodes)
      ? node.nodes
      : [];

  const children = rawChildren
    .map(child => normalizeLogicTreeNode(child, depth + 1))
    .filter(Boolean);

  return {
    label,
    type: normalizeWhitespace(node.type || "point") || "point",
    children
  };
}

function normalizeAiCaptureAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") {
    return {
      ...EMPTY_CAPTURE_ANALYSIS,
      logicForest: null
    };
  }

  function normalizeForestInput(value) {
    if (!value) return null;

    if (Array.isArray(value)) {
      const nodes = value
        .map(item => normalizeLogicTreeNode(item))
        .filter(Boolean);

      if (!nodes.length) return null;
      if (nodes.length === 1) return nodes[0];

      return {
        label: normalizeWhitespace(analysis.summary || "Study Notes") || "Study Notes",
        type: "topic",
        children: nodes
      };
    }

    return normalizeLogicTreeNode(value);
  }

  const logicForest = normalizeForestInput(analysis.logicForest || analysis.root || null);

  return {
    summary: typeof analysis.summary === "string" ? analysis.summary.trim() : "",
    bulletPoints: Array.isArray(analysis.bulletPoints)
      ? analysis.bulletPoints.map(item => String(item).trim()).filter(Boolean)
      : [],
    logicLinks: Array.isArray(analysis.logicLinks)
      ? analysis.logicLinks.map(item => String(item).trim()).filter(Boolean)
      : [],
    logicForest
  };
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

function splitLines(text = "") {
  return String(text)
    .replace(/\r/g, "")
    .split("\n")
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeWrongQuestionLines(text = "") {
  return splitLines(text).map(line => line.replace(/\s+/g, " ").trim());
}

function filterPlaceholder(items = [], prefix = "未检测到") {
  return items.filter(item => item && !item.startsWith(prefix));
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

function CapturePanelSection({ title, empty = false, children }) {
  return (
    <div className="subcard">
      <div className="subcard-title">{title}</div>
      <div className={`analysis-box ${empty ? "is-empty" : ""}`}>{children}</div>
    </div>
  );
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function measureMindMapLabelWidth(label = "", font = "600 14px Inter, system-ui, sans-serif") {
  if (typeof document === "undefined") {
    return Math.max(96, String(label || "").length * 8);
  }

  const canvas = measureMindMapLabelWidth.canvas || (measureMindMapLabelWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  if (!context) return Math.max(96, String(label || "").length * 8);

  context.font = font;
  return Math.ceil(context.measureText(String(label || "")).width);
}

function layoutMindMapTree(node, depth = 0, config = {}) {
  const nodeHeight = config.nodeHeight || 48;
  const horizontalGap = config.horizontalGap || 24;
  const verticalGap = config.verticalGap || 26;
  const paddingX = config.paddingX || 18;
  const minNodeWidth = config.minNodeWidth || 140;
  const maxNodeWidth = config.maxNodeWidth || 360;

  const label = String(node?.label || "");
  const measuredWidth = measureMindMapLabelWidth(label);
  const nodeWidth = Math.min(maxNodeWidth, Math.max(minNodeWidth, measuredWidth + paddingX * 2));
  const childLayouts = Array.isArray(node?.children)
    ? node.children.map(child => layoutMindMapTree(child, depth + 1, config))
    : [];

  const childrenRowWidth = childLayouts.length
    ? childLayouts.reduce((sum, child, index) => sum + child.subtreeWidth + (index ? horizontalGap : 0), 0)
    : 0;

  const subtreeWidth = Math.max(nodeWidth, childrenRowWidth || 0);
  const offsetX = (subtreeWidth - nodeWidth) / 2;

  let runningX = 0;
  let maxSubtreeHeight = nodeHeight;
  const positionedChildren = childLayouts.map((child, index) => {
    const childX = runningX;
    runningX += child.subtreeWidth + (index < childLayouts.length - 1 ? horizontalGap : 0);
    maxSubtreeHeight = Math.max(maxSubtreeHeight, nodeHeight + verticalGap + child.subtreeHeight);
    return {
      ...child,
      x: childX,
      y: nodeHeight + verticalGap
    };
  });

  return {
    label,
    depth,
    x: 0,
    y: 0,
    width: nodeWidth,
    height: nodeHeight,
    nodeX: offsetX,
    nodeY: 0,
    subtreeWidth,
    subtreeHeight: maxSubtreeHeight,
    children: positionedChildren
  };
}

function renderMindMapSvgNodes(layout, originX = 0, originY = 0) {
  if (!layout) return "";

  const nodeX = originX + layout.nodeX;
  const nodeY = originY + layout.nodeY;
  const centerX = nodeX + layout.width / 2;
  const bottomY = nodeY + layout.height;
  const radius = layout.depth === 0 ? 18 : 16;
  const fill = layout.depth === 0 ? "#111827" : "#ffffff";
  const stroke = layout.depth === 0 ? "#111827" : "#cbd5e1";
  const textFill = layout.depth === 0 ? "#ffffff" : "#0f172a";

  const connectors = layout.children
    .map(child => {
      const childCenterX = originX + child.x + child.nodeX + child.width / 2;
      const childTopY = originY + child.y + child.nodeY;
      const midY = bottomY + 12;
      return `
        <path d="M ${centerX} ${bottomY} L ${centerX} ${midY} L ${childCenterX} ${midY} L ${childCenterX} ${childTopY}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${childCenterX}" cy="${childTopY}" r="4" fill="#94a3b8" />
      `;
    })
    .join("");

  const childrenMarkup = layout.children
    .map(child => renderMindMapSvgNodes(child, originX + child.x, originY + child.y))
    .join("");

  return `
    ${connectors}
    <rect x="${nodeX}" y="${nodeY}" width="${layout.width}" height="${layout.height}" rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${layout.depth === 0 ? 0 : 1.5}" />
    <text x="${centerX}" y="${nodeY + layout.height / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="${layout.depth === 0 ? 700 : 600}" fill="${textFill}">${escapeXml(layout.label)}</text>
    ${childrenMarkup}
  `;
}

function buildMindMapSvgMarkup(mindMap, { background = "#f8fafc", padding = 28 } = {}) {
  if (!mindMap) return { svgMarkup: "", width: 0, height: 0 };

  const layout = layoutMindMapTree(mindMap, 0, {
    nodeHeight: 48,
    horizontalGap: 26,
    verticalGap: 30,
    paddingX: 18,
    minNodeWidth: 148,
    maxNodeWidth: 360
  });

  const width = Math.max(1, Math.ceil(layout.subtreeWidth + padding * 2));
  const height = Math.max(1, Math.ceil(layout.subtreeHeight + padding * 2));
  const content = renderMindMapSvgNodes(layout, padding, padding);

  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="${background}" />
      ${content}
    </svg>
  `.trim();

  return { svgMarkup, width, height };
}

function svgMarkupToBlobUrl(svgMarkup = "") {
  if (!svgMarkup) return "";
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  return URL.createObjectURL(svgBlob);
}

async function rasterizeSvgMarkupToBlob(svgMarkup = "", { width = 0, height = 0, background = "#f8fafc", scale = 2, mimeType = "image/png", quality = 0.92 } = {}) {
  if (!svgMarkup || !width || !height || typeof document === "undefined") return null;

  const svgUrl = svgMarkupToBlobUrl(svgMarkup);
  if (!svgUrl) return null;

  try {
    const image = await new Promise((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = error => reject(error);
      nextImage.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext("2d");
    if (!context) return null;

    context.scale(scale, scale);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise(resolve => {
      canvas.toBlob(nextBlob => resolve(nextBlob), mimeType, quality);
    });

    return blob || null;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function rasterizeMindMapToObjectUrl(mindMap, { background = "#f8fafc", padding = 28, scale = 2, mimeType = "image/png", quality = 0.92 } = {}) {
  const { svgMarkup, width, height } = buildMindMapSvgMarkup(mindMap, { background, padding });
  if (!svgMarkup || !width || !height) return "";

  const blob = await rasterizeSvgMarkupToBlob(svgMarkup, {
    width,
    height,
    background,
    scale,
    mimeType,
    quality
  });

  return blob ? URL.createObjectURL(blob) : "";
}


function inlineComputedStylesIntoClone(sourceNode, targetNode) {
  if (!sourceNode || !targetNode || typeof window === "undefined") return;

  const sourceElements = [sourceNode, ...sourceNode.querySelectorAll("*")];
  const targetElements = [targetNode, ...targetNode.querySelectorAll("*")];

  sourceElements.forEach((sourceElement, index) => {
    const targetElement = targetElements[index];
    if (!(sourceElement instanceof Element) || !(targetElement instanceof Element)) return;

    const computed = window.getComputedStyle(sourceElement);
    const cssText = Array.from(computed)
      .map(property => `${property}: ${computed.getPropertyValue(property)};`)
      .join(" ");

    targetElement.setAttribute("style", cssText);

    if (sourceElement instanceof HTMLImageElement && targetElement instanceof HTMLImageElement) {
      targetElement.src = sourceElement.currentSrc || sourceElement.src || "";
    }
  });
}

async function rasterizeElementToObjectUrl(element, { background = "#f8fafc", padding = 24, scale = 2, mimeType = "image/png", quality = 0.92, maxDimension = 4096 } = {}) {
  if (!element || typeof window === "undefined" || typeof document === "undefined") return "";

  const sourceWidth = Math.max(
    1,
    Math.ceil(element.scrollWidth || 0),
    Math.ceil(element.offsetWidth || 0),
    Math.ceil(element.getBoundingClientRect?.().width || 0)
  );

  const sourceHeight = Math.max(
    1,
    Math.ceil(element.scrollHeight || 0),
    Math.ceil(element.offsetHeight || 0),
    Math.ceil(element.getBoundingClientRect?.().height || 0)
  );

  const totalWidth = sourceWidth + padding * 2;
  const totalHeight = sourceHeight + padding * 2;
  if (!totalWidth || !totalHeight) return "";

  const clonedElement = element.cloneNode(true);
  inlineComputedStylesIntoClone(element, clonedElement);

  const wrapper = document.createElement("div");
  wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrapper.setAttribute(
    "style",
    [
      `width:${totalWidth}px`,
      `height:${totalHeight}px`,
      `box-sizing:border-box`,
      `padding:${padding}px`,
      `background:${background}`,
      `display:flex`,
      `align-items:flex-start`,
      `justify-content:flex-start`,
      `overflow:hidden`
    ].join(";")
  );
  wrapper.appendChild(clonedElement);

  const serializedXhtml = new XMLSerializer().serializeToString(wrapper);
  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
      <foreignObject width="100%" height="100%">${serializedXhtml}</foreignObject>
    </svg>
  `.trim();

  const svgUrl = svgMarkupToBlobUrl(svgMarkup);
  if (!svgUrl) return "";

  try {
    const image = await new Promise((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = error => reject(error);
      nextImage.src = svgUrl;
    });

    const maxBaseDimension = Math.max(totalWidth, totalHeight);
    const outputScale = Math.max(1, Math.min(scale, maxDimension / Math.max(1, maxBaseDimension)));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(totalWidth * outputScale));
    canvas.height = Math.max(1, Math.round(totalHeight * outputScale));

    const context = canvas.getContext("2d");
    if (!context) return "";

    context.scale(outputScale, outputScale);
    context.fillStyle = background;
    context.fillRect(0, 0, totalWidth, totalHeight);
    context.drawImage(image, 0, 0, totalWidth, totalHeight);

    const blob = await new Promise(resolve => {
      canvas.toBlob(nextBlob => resolve(nextBlob), mimeType, quality);
    });

    if (!blob) return "";
    return URL.createObjectURL(blob);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}


function MindMapNode({ node, isRoot = false }) {
  if (!node) return null;

  return (
    <div className={`mindmap-node ${isRoot ? "is-root" : ""}`}>
      <div className={`mindmap-label ${isRoot ? "root" : ""}`}>{node.label}</div>

      {node.children?.length ? (
        <div className="mindmap-children">
          {node.children.map((child, index) => (
            <div key={`${child.label}-${index}`} className="mindmap-child-row">
              <div className="mindmap-connector">
                <span className="mindmap-connector-dot" />
              </div>
              <MindMapNode node={child} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SavedNotesModal({
  isOpen,
  onClose,
  notes,
  onLoadNote,
  onDeleteNote,
  currentPathLabel
}) {
  const [deletingNoteId, setDeletingNoteId] = useState("");

  if (!isOpen) return null;

  async function handleDelete(noteId) {
    if (!noteId) return;
    if (!window.confirm("Delete this saved note?")) return;

    try {
      setDeletingNoteId(noteId);
      const deleted = await onDeleteNote(noteId);
      if (!deleted) return;
    } finally {
      setDeletingNoteId("");
    }
  }

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-card notes-modal" onClick={event => event.stopPropagation()}>
        <div className="overlay-header">
          <div>
            <h3>Load Saved Notes</h3>
            <div className="overlay-subtitle">{currentPathLabel}</div>
          </div>
          <button className="icon-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {!notes.length ? (
          <div className="empty-notes-state">No saved notes in this room yet.</div>
        ) : (
          <div className="notes-list">
            {notes.map(note => (
              <div key={note.id} className="note-list-item interactive-card">
                <button
                  className="note-list-load-btn"
                  onClick={() => {
                    onLoadNote(note);
                    onClose();
                  }}
                >
                  <div className="note-list-top">
                    <span className="note-list-time">{formatSavedAt(note.savedAt)}</span>
                    <span className="note-list-path">
                      {note.division}
                      {note.roomName ? ` / ${note.roomName}` : ""}
                      {note.subroomName ? ` / ${note.subroomName}` : ""}
                    </span>
                  </div>
                  <div className="note-list-preview">
                    {getCaptureNoteVisibleText(note).slice(0, 160)}
                    {getCaptureNoteVisibleText(note).length > 160 ? "..." : ""}
                  </div>
                </button>

                <div className="note-list-actions">
                  <button className="danger-lite-btn" onClick={() => handleDelete(note.id)} disabled={deletingNoteId === note.id}>
                    {deletingNoteId === note.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const PDF_PAGE_DIMENSIONS_MM = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 }
};

function readPdfExportPreferences() {
  try {
    const raw = localStorage.getItem("capturePdfExportPreferences");
    const parsed = raw ? JSON.parse(raw) : {};

    return {
      orientation: parsed?.orientation === "portrait" ? "portrait" : "landscape",
      pageSize: parsed?.pageSize === "A3" ? "A3" : "A4",
      layoutMode: parsed?.layoutMode === "multi" ? "multi" : "fit"
    };
  } catch {
    return {
      orientation: "landscape",
      pageSize: "A4",
      layoutMode: "fit"
    };
  }
}

function getPdfPageMetrics(pageSize = "A4", orientation = "landscape", marginMm = 12) {
  const base = PDF_PAGE_DIMENSIONS_MM[pageSize] || PDF_PAGE_DIMENSIONS_MM.A4;
  const isLandscape = orientation === "landscape";
  const pageWidthMm = isLandscape ? base.height : base.width;
  const pageHeightMm = isLandscape ? base.width : base.height;
  const pxPerMm = 96 / 25.4;

  return {
    pageWidthMm,
    pageHeightMm,
    contentWidthPx: Math.max(320, (pageWidthMm - marginMm * 2) * pxPerMm),
    contentHeightPx: Math.max(320, (pageHeightMm - marginMm * 2) * pxPerMm)
  };
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAnalysisSectionForPdf(title, items = []) {
  if (!items.length) return "";

  return `
    <section class="pdf-section">
      <div class="pdf-section-title">${escapeHtml(title)}</div>
      <ul class="pdf-list">
        ${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function getDocumentStyles() {
  return Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map(node => node.outerHTML)
    .join("\n");
}

function mergeNoteTextsForAnalysis(notes = []) {
  return notes
    .map(note => {
      const body = getCaptureNoteVisibleText(note);
      if (!body) return "";
      const pathLabel = [note.roomName, note.subroomName].filter(Boolean).join(" / ");
      return pathLabel ? `${pathLabel}\n${body}` : body;
    })
    .filter(Boolean)
    .join("\n\n");
}

function formatNotesCollectionForPdf(title, notes = []) {
  if (!notes.length) return "";

  return `
    <section class="pdf-section">
      <div class="pdf-section-title">${escapeHtml(title)}</div>
      <div class="pdf-note-stack">
        ${notes
          .map((note, index) => {
            const label = [note.roomName, note.subroomName].filter(Boolean).join(" / ") || `Note ${index + 1}`;
            const meta = [
              note.division ? `Division: ${note.division}` : "",
              note.savedAt ? `Saved: ${formatSavedAt(note.savedAt)}` : ""
            ]
              .filter(Boolean)
              .join(" · ");

            return `
              <div class="pdf-note-card">
                <div class="pdf-note-title">${escapeHtml(label)}</div>
                ${meta ? `<div class="pdf-note-meta">${escapeHtml(meta)}</div>` : ""}
                <p class="pdf-paragraph">${escapeHtml(getCaptureNoteVisibleText(note))}</p>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}


function parseFlashcardPath(card = {}) {
  const topicPath = String(card.topicPath || "").trim();
  const parts = topicPath
    .split('/')
    .map(item => item.trim())
    .filter(Boolean);

  return {
    division: card.division || parts[0] || "",
    roomName: card.roomName || parts[1] || "",
    subroomName: card.subroomName || parts[2] || ""
  };
}

function flashcardMatchesRoom(card = {}, room = null) {
  if (!room) return false;
  const parsed = parseFlashcardPath(card);
  const cardRoomId = card.roomId || "";
  const cardRoomName = normalizeWhitespace(card.roomName || parsed.roomName).toLowerCase();
  const targetRoomName = normalizeWhitespace(room.name || "").toLowerCase();
  return cardRoomId === room.id || (!!cardRoomName && cardRoomName === targetRoomName);
}

function flashcardMatchesSubroom(card = {}, room = null, subroom = null) {
  if (!room || !subroom) return false;
  const parsed = parseFlashcardPath(card);
  const cardSubroomId = card.subroomId || "";
  const cardSubroomName = normalizeWhitespace(card.subroomName || parsed.subroomName).toLowerCase();
  const targetSubroomName = normalizeWhitespace(subroom.name || "").toLowerCase();

  if (cardSubroomId === subroom.id) return true;
  if (!!cardSubroomName && cardSubroomName === targetSubroomName) return true;

  if (!cardSubroomId && !cardSubroomName) {
    return flashcardMatchesRoom(card, room);
  }

  return false;
}

function buildWrongQuestionSourceText({ imagePreview = "", ocrText = "", questionText = "", notesText = "" } = {}) {
  const sections = [];

  if (imagePreview) sections.push('Image attached.');
  if (normalizeWhitespace(ocrText)) sections.push(`OCR Text:\n${String(ocrText).trim()}`);
  if (normalizeWhitespace(questionText)) sections.push(`Wrong Question Text:\n${String(questionText).trim()}`);
  if (normalizeWhitespace(notesText)) sections.push(`Wrong Question Notes:\n${String(notesText).trim()}`);

  return sections.join('\n\n');
}

function normalizeWrongQuestionAnalysis(input) {
  if (!input || typeof input !== 'object') {
    return {
      questionText: '',
      summary: '',
      correctAnswer: [],
      answerExtraction: [],
      bulletPoints: [],
      trapPoint: [],
      memoryHook: ''
    };
  }

  const toArray = value => {
    if (Array.isArray(value)) return value.map(item => sentenceCase(String(item || ''))).filter(Boolean);
    if (typeof value === 'string') return splitEditorLines(value).map(sentenceCase);
    return [];
  };

  return {
    questionText: String(input.questionText || '').trim(),
    summary: String(input.summary || '').trim(),
    correctAnswer: toArray(input.correctAnswer),
    answerExtraction: toArray(input.answerExtraction),
    bulletPoints: toArray(input.bulletPoints),
    trapPoint: toArray(input.trapPoint),
    memoryHook: String(input.memoryHook || '').trim()
  };
}

function buildLocalWrongQuestionAnalysis(text = '') {
  const clean = String(text || '').trim();
  const lines = splitEditorLines(clean);
  const lower = clean.toLowerCase();

  const findSection = labels => {
    for (const line of lines) {
      const lowered = line.toLowerCase();
      for (const label of labels) {
        const token = `${label.toLowerCase()}:`;
        if (lowered.startsWith(token)) {
          return line.slice(token.length).trim();
        }
      }
    }
    return '';
  };

  const questionText = findSection(['question', 'wrong question']) || sentenceCase(lines[0] || clean.slice(0, 180));
  const explicitSummary = findSection(['summary', 'concept']);
  const summary = explicitSummary || sentenceCase(lines.slice(0, 2).join(' ').slice(0, 280));

  const explicitCorrect = findSection(['correct answer', 'answer']);
  const correctAnswer = explicitCorrect
    ? parseListItems(explicitCorrect)
    : lower.includes('not')
      ? ['Check the exception and confirm what is actually required.']
      : ['Use the code-based answer, not the distractor.'];

  const explicitExtraction = findSection(['answer extraction', 'extraction']);
  const answerExtraction = explicitExtraction
    ? parseListItems(explicitExtraction)
    : questionText
      ? [sentenceCase(questionText)]
      : [];

  const bulletPoints = lines.length
    ? uniqueByLabel(lines.slice(0, 6).map(item => ({ label: sentenceCase(item) }))).map(item => item.label)
    : [];

  const explicitTrap = findSection(['trap point', 'trap', 'common mistake']);
  const trapPoint = explicitTrap
    ? parseListItems(explicitTrap)
    : ['Do not rely only on keywords; verify the actual requirement.'];

  const explicitMemory = findSection(['memory hook', 'memory']);
  const memoryHook = explicitMemory || '先抓题目核心目标，再选直接对应目标的答案。';

  return normalizeWrongQuestionAnalysis({
    questionText,
    summary,
    correctAnswer,
    answerExtraction,
    bulletPoints,
    trapPoint,
    memoryHook
  });
}

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [roomTree, setRoomTree] = useState({});
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedSubroomId, setSelectedSubroomId] = useState("");

  const [captureDraft, setCaptureDraft] = useState("");
  const [captureStatus, setCaptureStatus] = useState("Ready.");
  const [captureLocalAnalysis, setCaptureLocalAnalysis] = useState(EMPTY_CAPTURE_ANALYSIS);
  const [captureAiResult, setCaptureAiResult] = useState(null);
  const [captureAnalysisSourceText, setCaptureAnalysisSourceText] = useState("");
  const [captureAnalysisCleared, setCaptureAnalysisCleared] = useState(true);
  const [isCaptureAnalyzing, setIsCaptureAnalyzing] = useState(false);

  const [savedCaptureNotes, setSavedCaptureNotes] = useState([]);
  const [isSavedNotesModalOpen, setIsSavedNotesModalOpen] = useState(false);

  const [wrongQuestionImageFile, setWrongQuestionImageFile] = useState(null);
  const [wrongQuestionImagePreview, setWrongQuestionImagePreview] = useState("");
  const [wrongQuestionOcrText, setWrongQuestionOcrText] = useState("");
  const [wrongQuestionTextDraft, setWrongQuestionTextDraft] = useState("");
  const [wrongQuestionNotesDraft, setWrongQuestionNotesDraft] = useState("");
  const [wrongQuestionStatus, setWrongQuestionStatus] = useState("Ready.");
  const [isRunningOcr, setIsRunningOcr] = useState(false);

  const [wrongQuestionFlashcards, setWrongQuestionFlashcards] = useState([]);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [expandedImage, setExpandedImage] = useState(null);
  const [liveLogicZoom, setLiveLogicZoom] = useState(1);
  const [isOpeningLiveLogicImage, setIsOpeningLiveLogicImage] = useState(false);
  const [wrongQuestionAiResult, setWrongQuestionAiResult] = useState(null);
  const [wrongQuestionLocalAnalysis, setWrongQuestionLocalAnalysis] = useState(buildLocalWrongQuestionAnalysis(""));
  const [wrongQuestionAnalysisSourceText, setWrongQuestionAnalysisSourceText] = useState("");
  const [wrongQuestionAnalysisCleared, setWrongQuestionAnalysisCleared] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewFlashcardRoomId, setPreviewFlashcardRoomId] = useState("");
  const [previewFlashcardSubroomId, setPreviewFlashcardSubroomId] = useState("");

  const liveLogicPrintRef = useRef(null);
  const wrongQuestionFileInputRef = useRef(null);
  const lastHydratedCaptureWorkspaceKeyRef = useRef("");

  const [captureWorkspaceByKey, setCaptureWorkspaceByKey] = useState({});
  const [pdfExportPreferences, setPdfExportPreferences] = useState(readPdfExportPreferences);

  const divisionRooms = useMemo(() => getRoomsForDivision(roomTree, selectedDivision), [roomTree, selectedDivision]);
  const selectedRoom = useMemo(
    () => findRoomById(roomTree, selectedDivision, selectedRoomId),
    [roomTree, selectedDivision, selectedRoomId]
  );
  const selectedSubroom = useMemo(
    () => findSubroomById(roomTree, selectedDivision, selectedRoomId, selectedSubroomId),
    [roomTree, selectedDivision, selectedRoomId, selectedSubroomId]
  );

  const currentPathLabel = useMemo(
    () => getCurrentPathLabel(roomTree, selectedDivision, selectedRoomId, selectedSubroomId),
    [roomTree, selectedDivision, selectedRoomId, selectedSubroomId]
  );

  const captureWorkspaceKey = useMemo(
    () => createCaptureWorkspaceKey(selectedDivision, selectedRoomId, selectedSubroomId),
    [selectedDivision, selectedRoomId, selectedSubroomId]
  );

  const pdfExportOrientation = pdfExportPreferences.orientation || "landscape";
  const pdfExportPageSize = pdfExportPreferences.pageSize || "A4";
  const pdfExportLayoutMode = pdfExportPreferences.layoutMode || "fit";
  const liveLogicZoomPercent = `${Math.round(liveLogicZoom * 100)}%`;

  function updatePdfExportPreferences(partial = {}) {
    setPdfExportPreferences(prev => ({
      ...prev,
      ...partial
    }));
  }

  function adjustLiveLogicZoom(nextZoom) {
    setLiveLogicZoom(Math.min(2.25, Math.max(0.55, Number(nextZoom) || 1)));
  }

  function revokeExpandedImageResources(imageResource = null) {
    if (!imageResource || typeof imageResource !== "object") return;

    [imageResource.src, imageResource.pngUrl, imageResource.jpgUrl, imageResource.previewUrl].forEach(url => {
      if (typeof url === "string" && url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore blob cleanup errors.
        }
      }
    });
  }

  function openExpandedImage(nextImage = null) {
    if (!nextImage?.src) return;

    setExpandedImage(previousImage => {
      revokeExpandedImageResources(previousImage);
      return nextImage;
    });
  }

  function closeExpandedImage() {
    setExpandedImage(previousImage => {
      revokeExpandedImageResources(previousImage);
      return null;
    });
  }

  async function downloadExpandedLogicImage(format = "png") {
    if (!expandedImage || typeof expandedImage !== "object" || !expandedImage.svgMarkup) return;

    try {
      const isJpg = String(format).toLowerCase() === "jpg" || String(format).toLowerCase() === "jpeg";
      const blob = await rasterizeSvgMarkupToBlob(expandedImage.svgMarkup, {
        width: expandedImage.width,
        height: expandedImage.height,
        background: "#f8fafc",
        scale: 2,
        mimeType: isJpg ? "image/jpeg" : "image/png",
        quality: isJpg ? 0.94 : 0.92
      });

      if (!blob) {
        setCaptureStatus("This browser could not save the logic image right now.");
        return;
      }

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `live-logic-image.${isJpg ? "jpg" : "png"}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setCaptureStatus(isJpg ? "JPG saved." : "PNG saved.");
    } catch (error) {
      console.error(error);
      setCaptureStatus("This browser could not save the logic image right now.");
    }
  }

  async function handleOpenLiveLogicImage() {
    if (!currentMindMap || isOpeningLiveLogicImage) return;

    try {
      setIsOpeningLiveLogicImage(true);

      const { svgMarkup, width, height } = buildMindMapSvgMarkup(currentMindMap, {
        background: "#f8fafc",
        padding: 28
      });

      if (!svgMarkup || !width || !height) {
        setCaptureStatus("Image preview could not be generated in this browser right now.");
        return;
      }

      const previewUrl = svgMarkupToBlobUrl(svgMarkup);
      if (!previewUrl) {
        setCaptureStatus("Image preview could not be generated in this browser right now.");
        return;
      }

      openExpandedImage({
        src: previewUrl,
        previewUrl,
        svgMarkup,
        width,
        height,
        pngUrl: "",
        jpgUrl: ""
      });
      setCaptureStatus("Image preview ready. Use Save PNG or Save JPG in the popup.");
    } catch (error) {
      console.error(error);
      setCaptureStatus("Image preview could not be generated in this browser right now.");
    } finally {
      setIsOpeningLiveLogicImage(false);
    }
  }

  function applyCaptureWorkspace(workspace) {
    const nextWorkspace = workspace || buildEmptyCaptureWorkspace();
    setCaptureDraft(nextWorkspace.draft || "");
    setCaptureLocalAnalysis(cloneCaptureAnalysis(nextWorkspace.localAnalysis));
    setCaptureAiResult(nextWorkspace.aiResult || null);
    setCaptureAnalysisSourceText(nextWorkspace.analysisSourceText || "");
    setCaptureAnalysisCleared(Boolean(nextWorkspace.analysisCleared));
    setCaptureStatus(nextWorkspace.status || "Ready.");
  }

  useEffect(() => {
    try {
      localStorage.setItem("capturePdfExportPreferences", JSON.stringify(pdfExportPreferences));
    } catch {
      // ignore storage write errors
    }
  }, [pdfExportPreferences]);

  useEffect(() => {
  fetchRoomsFromCloud(selectedDivision);
}, [selectedDivision]);
  
  useEffect(() => {
    if (!divisionRooms.length) {
      setSelectedRoomId("");
      setSelectedSubroomId("");
      return;
    }

    if (selectedRoomId) {
      const roomStillExists = divisionRooms.some(room => room.id === selectedRoomId);
      if (!roomStillExists) {
        setSelectedRoomId("");
        setSelectedSubroomId("");
        return;
      }
    }

    if (selectedSubroomId) {
      const subroomStillExists = (selectedRoom?.children || []).some(child => child.id === selectedSubroomId);
      if (!subroomStillExists) {
        setSelectedSubroomId("");
      }
    }
  }, [divisionRooms, selectedRoomId, selectedSubroomId, selectedRoom]);


  useEffect(() => {
    fetchSavedNotesFromCloud(selectedDivision);
  }, [selectedDivision]);

  useEffect(() => {
    if (!captureWorkspaceKey) return;

    const nextWorkspace = buildCaptureWorkspaceFromState({
      draft: captureDraft,
      localAnalysis: captureLocalAnalysis,
      aiResult: captureAiResult,
      analysisSourceText: captureAnalysisSourceText,
      analysisCleared: captureAnalysisCleared,
      status: captureStatus
    });

    setCaptureWorkspaceByKey(prev => {
      const currentWorkspace = prev[captureWorkspaceKey];
      if (areCaptureWorkspacesEqual(currentWorkspace, nextWorkspace)) {
        return prev;
      }

      return {
        ...prev,
        [captureWorkspaceKey]: nextWorkspace
      };
    });
  }, [
    captureWorkspaceKey,
    captureDraft,
    captureLocalAnalysis,
    captureAiResult,
    captureAnalysisSourceText,
    captureAnalysisCleared,
    captureStatus
  ]);

  useEffect(() => {
    if (!captureWorkspaceKey) return;

    if (lastHydratedCaptureWorkspaceKeyRef.current === captureWorkspaceKey && captureWorkspaceByKey[captureWorkspaceKey]) {
      return;
    }

    const existingWorkspace = captureWorkspaceByKey[captureWorkspaceKey];
    if (existingWorkspace) {
      applyCaptureWorkspace(existingWorkspace);
      lastHydratedCaptureWorkspaceKeyRef.current = captureWorkspaceKey;
      return;
    }

    const latestSavedNote = [...savedCaptureNotes]
      .filter(note => {
        return (
          note.division === selectedDivision &&
          note.roomId === selectedRoomId &&
          (note.subroomId || "") === (selectedSubroomId || "")
        );
      })
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0];

    const hydratedWorkspace = latestSavedNote
      ? buildCaptureWorkspaceFromNote(
          latestSavedNote,
          `Loaded latest saved note from ${formatSavedAt(latestSavedNote.savedAt)}.`
        )
      : buildEmptyCaptureWorkspace("Ready.");

    setCaptureWorkspaceByKey(prev => ({
      ...prev,
      [captureWorkspaceKey]: hydratedWorkspace
    }));

    applyCaptureWorkspace(hydratedWorkspace);
    lastHydratedCaptureWorkspaceKeyRef.current = captureWorkspaceKey;
  }, [
    captureWorkspaceKey,
    captureWorkspaceByKey,
    savedCaptureNotes,
    selectedDivision,
    selectedRoomId,
    selectedSubroomId
  ]);

  useEffect(() => {
    fetchWrongQuestionFlashcardsFromCloud();
  }, []);


  async function fetchRoomsFromCloud(division) {
  if (!division) return;

  try {
    const response = await fetch(`/api/rooms?division=${encodeURIComponent(division)}`);
    const data = await response.json();

    if (!response.ok) {
      console.error(data.error || "Failed to load rooms.");
      return;
    }

    setRoomTree(prev => ({
      ...prev,
      [division]: Array.isArray(data.rooms) ? data.rooms : []
    }));
  } catch (error) {
    console.error(error);
  }
}

async function createRoomInCloud({ id, division, parentId = null, name, roomType, sortOrder = 0 }) {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      division,
      parentId,
      name,
      roomType,
      sortOrder
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to create room.");
  }

  return data;
}

async function deleteRoomFromCloud(id) {
  const response = await fetch(`/api/rooms?id=${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to delete room.");
  }

  return data;
}
  
  async function fetchSavedNotesFromCloud(division, roomId = "", subroomId = "") {
  if (!division) {
    setSavedCaptureNotes([]);
    return;
  }

  try {
    const params = new URLSearchParams({ division });

    if (roomId) {
      params.set("roomId", roomId);
    }

    if (subroomId) {
      params.set("subroomId", subroomId);
    }

    const response = await fetch(`/api/notes?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      console.error(data.error || "Failed to load notes.");
      setSavedCaptureNotes([]);
      return;
    }

    const normalizedNotes = Array.isArray(data.notes)
      ? data.notes.map(note => {
          const visibleText = getCaptureNoteVisibleText(note);
          const captureMeta = getCaptureNoteStoredMeta(note, visibleText);
          const storedText =
            typeof note?.text === "string" && note.text.includes(CAPTURE_NOTE_META_MARKER)
              ? note.text
              : buildStoredCaptureNoteText(visibleText, captureMeta || {});
          return {
            ...note,
            text: storedText,
            plainText: visibleText,
            captureMeta: captureMeta || null
          };
        })
      : [];

    setSavedCaptureNotes(normalizedNotes);
  } catch (error) {
    console.error(error);
    setSavedCaptureNotes([]);
  }
}

async function deleteSavedNoteFromCloud(noteId) {
  const fallbackDeleteLocal = () => {
    setSavedCaptureNotes(prev => prev.filter(note => note.id !== noteId));
  };

  try {
    const response = await fetch(`/api/notes?id=${encodeURIComponent(noteId)}`, {
      method: "DELETE"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      window.alert(data.error || "Failed to delete saved note.");
      return false;
    }

    fallbackDeleteLocal();
    setCaptureStatus("Saved note deleted.");
    return true;
  } catch (error) {
    console.error(error);
    window.alert("Failed to delete saved note.");
    return false;
  }
}

async function fetchWrongQuestionFlashcardsFromCloud() {
  try {
    const response = await fetch("/api/wrong-questions");
    const data = await response.json();

    if (!response.ok) {
      console.error(data.error || "Failed to load flashcards.");
      return;
    }

    setWrongQuestionFlashcards(Array.isArray(data.flashcards) ? data.flashcards : []);
    setFlashcardIndex(0);
  } catch (error) {
    console.error(error);
  }
}

async function deleteWrongQuestionFlashcardFromCloud(id) {
  try {
    const response = await fetch(`/api/wrong-questions?id=${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    const data = await response.json();

    if (!response.ok) {
      window.alert(data.error || "Failed to delete flashcard.");
      return false;
    }

    return true;
  } catch (error) {
    console.error(error);
    window.alert("Failed to delete flashcard.");
    return false;
  }
}

  const filteredSavedNotes = useMemo(() => {
    return [...savedCaptureNotes]
      .filter(note => {
        if (note.division !== selectedDivision) return false;
        if (note.roomId !== selectedRoomId) return false;
        return (note.subroomId || "") === (selectedSubroomId || "");
      })
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }, [savedCaptureNotes, selectedDivision, selectedRoomId, selectedSubroomId]);

  const divisionSavedNotes = useMemo(() => {
    return [...savedCaptureNotes]
      .filter(note => note.division === selectedDivision)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }, [savedCaptureNotes, selectedDivision]);

  const roomPreviewSavedNotes = useMemo(() => {
    if (!selectedRoomId) return [];

    const validSubroomIds = new Set((selectedRoom?.children || []).map(child => child.id));

    return divisionSavedNotes.filter(note => {
      if (note.roomId !== selectedRoomId) return false;
      if (!note.subroomId) return true;
      if (!validSubroomIds.size) return true;
      return validSubroomIds.has(note.subroomId);
    });
  }, [divisionSavedNotes, selectedRoomId, selectedRoom]);

  const canEditCapture = Boolean(selectedRoomId && selectedSubroomId);
  const isRoomPreview = Boolean(selectedRoomId) && !selectedSubroomId;
  const isDivisionPreview = !selectedRoomId && !selectedSubroomId;

  const previewNotes = useMemo(() => {
    if (isRoomPreview) return roomPreviewSavedNotes;
    if (isDivisionPreview) return divisionSavedNotes;
    return [];
  }, [isRoomPreview, isDivisionPreview, roomPreviewSavedNotes, divisionSavedNotes]);

  const previewNoteSnapshots = useMemo(() => previewNotes.map(note => getCaptureNoteSnapshot(note)), [previewNotes]);

  const previewSourceText = useMemo(() => {
    return previewNoteSnapshots
      .map(snapshot => snapshot.sourceText || snapshot.visibleText)
      .filter(text => normalizeWhitespace(text))
      .join("\n\n");
  }, [previewNoteSnapshots]);

  const previewAnalysis = useMemo(() => {
    return combineCaptureAnalysisSnapshots(previewNoteSnapshots);
  }, [previewNoteSnapshots]);

  const previewMindMap = useMemo(() => {
    const previewLabel = isRoomPreview ? selectedRoom?.name || "Room Preview" : `${selectedDivision} Topic Preview`;
    return combineCaptureMindMapSnapshots(previewLabel, previewNoteSnapshots);
  }, [previewNoteSnapshots, isRoomPreview, selectedRoom, selectedDivision]);

  const activeCaptureAnalysis = useMemo(() => {
    return resolveCaptureAnalysisState({
      localAnalysis: captureLocalAnalysis,
      aiResult: captureAiResult,
      analysisSourceText: captureAnalysisSourceText,
      analysisCleared: captureAnalysisCleared
    });
  }, [captureAnalysisCleared, captureAnalysisSourceText, captureAiResult, captureLocalAnalysis]);

  const activeCaptureSourceText = useMemo(() => {
    if (captureAnalysisCleared) return "";
    return captureAnalysisSourceText;
  }, [captureAnalysisCleared, captureAnalysisSourceText]);

  const activeCaptureMindMap = useMemo(() => {
    return resolveCaptureMindMapState({
      aiResult: captureAiResult,
      analysisSourceText: captureAnalysisSourceText,
      analysisCleared: captureAnalysisCleared
    });
  }, [captureAiResult, captureAnalysisCleared, captureAnalysisSourceText]);

  const activeDisplayAnalysis = useMemo(
    () => (canEditCapture ? activeCaptureAnalysis : previewAnalysis),
    [canEditCapture, activeCaptureAnalysis, previewAnalysis]
  );

  const activeDisplaySourceText = useMemo(
    () => (canEditCapture ? activeCaptureSourceText : previewSourceText),
    [canEditCapture, activeCaptureSourceText, previewSourceText]
  );

  const currentMindMap = useMemo(
    () => (canEditCapture ? activeCaptureMindMap : previewMindMap),
    [canEditCapture, activeCaptureMindMap, previewMindMap]
  );

  const hasActiveDisplayAnalysisContent = useMemo(() => {
    return Boolean(
      activeDisplayAnalysis.summary ||
        activeDisplayAnalysis.bulletPoints.length ||
        activeDisplayAnalysis.logicLinks.length
    );
  }, [activeDisplayAnalysis]);

  const activeDisplayNotesForExport = useMemo(() => {
    if (canEditCapture) {
      if (!normalizeWhitespace(activeDisplaySourceText)) return [];
      return [
        {
          id: "current-capture-analysis",
          division: selectedDivision,
          roomId: selectedRoomId,
          roomName: selectedRoom?.name || "",
          subroomId: selectedSubroomId || "",
          subroomName: selectedSubroom?.name || "",
          savedAt: new Date().toISOString(),
          text: activeDisplaySourceText
        }
      ];
    }

    return previewNotes;
  }, [
    canEditCapture,
    activeDisplaySourceText,
    previewNotes,
    selectedDivision,
    selectedRoomId,
    selectedRoom,
    selectedSubroomId,
    selectedSubroom
  ]);

  const currentSavedNotesCount = useMemo(() => {
    if (canEditCapture) return filteredSavedNotes.length;
    return previewNotes.length;
  }, [canEditCapture, filteredSavedNotes.length, previewNotes.length]);

  const currentViewModeLabel = useMemo(() => {
    if (canEditCapture) return "Sub-room Editing";
    if (isRoomPreview) return "Room Preview";
    return "Topic Preview";
  }, [canEditCapture, isRoomPreview]);

  const currentViewTitle = useMemo(() => {
    if (canEditCapture) return "Analysis";
    if (isRoomPreview) return `${selectedRoom?.name || "Room"} Preview`;
    return `${selectedDivision} Topic Preview`;
  }, [canEditCapture, isRoomPreview, selectedRoom, selectedDivision]);

  const editorPlaceholderText = useMemo(() => {
    if (canEditCapture) return "Paste notes here...";
    if (!divisionRooms.length) return "Create a room and a sub-room first...";
    if (!selectedRoomId) return "Topic preview mode. Select a room or sub-room to continue...";
    return "Room preview mode. Select a sub-room to start writing notes...";
  }, [canEditCapture, divisionRooms.length, selectedRoomId]);

  const capturePanelStatusText = useMemo(() => {
    if (canEditCapture) return captureStatus;
    if (!divisionRooms.length) return "Create a room and a sub-room first before taking notes.";
    if (!selectedRoomId) return "Viewing merged preview of all saved notes in this topic.";
    return "Viewing merged preview of all saved notes inside this room.";
  }, [canEditCapture, captureStatus, divisionRooms.length, selectedRoomId]);

  const allFlashcardsWithPath = useMemo(() => {
    return (wrongQuestionFlashcards || []).map(card => {
      const parsed = parseFlashcardPath(card);
      return {
        ...card,
        division: card.division || parsed.division,
        roomName: card.roomName || parsed.roomName,
        subroomName: card.subroomName || parsed.subroomName
      };
    });
  }, [wrongQuestionFlashcards]);

  const filteredWrongQuestionFlashcards = useMemo(() => {
    return allFlashcardsWithPath.filter(card => {
      if ((card.division || "") !== selectedDivision) return false;
      if (selectedRoomId && !flashcardMatchesRoom(card, selectedRoom)) return false;
      if (selectedSubroomId && !flashcardMatchesSubroom(card, selectedRoom, selectedSubroom)) return false;
      return true;
    });
  }, [allFlashcardsWithPath, selectedDivision, selectedRoomId, selectedSubroomId, selectedRoom, selectedSubroom]);

  const currentFlashcard = filteredWrongQuestionFlashcards[flashcardIndex] || null;

  const topicPreviewFlashcardRooms = useMemo(() => {
    return divisionRooms
      .map(room => ({
        ...room,
        flashcards: allFlashcardsWithPath.filter(
          card => (card.division || "") === selectedDivision && flashcardMatchesRoom(card, room)
        )
      }))
      .filter(room => room.flashcards.length);
  }, [divisionRooms, allFlashcardsWithPath, selectedDivision]);

  const previewFlashcardRoom = useMemo(
    () => topicPreviewFlashcardRooms.find(room => room.id === previewFlashcardRoomId) || null,
    [topicPreviewFlashcardRooms, previewFlashcardRoomId]
  );

  const roomPreviewFlashcardSubrooms = useMemo(() => {
    const targetRoom = isRoomPreview ? selectedRoom : previewFlashcardRoom;
    if (!targetRoom) return [];

    return (targetRoom.children || [])
      .map(subroom => ({
        ...subroom,
        flashcards: allFlashcardsWithPath.filter(card => {
          if ((card.division || "") !== selectedDivision) return false;
          return flashcardMatchesSubroom(card, targetRoom, subroom);
        })
      }))
      .filter(subroom => subroom.flashcards.length);
  }, [isRoomPreview, selectedRoom, previewFlashcardRoom, allFlashcardsWithPath, selectedDivision]);

  const previewFlashcardSubroom = useMemo(
    () => roomPreviewFlashcardSubrooms.find(subroom => subroom.id === previewFlashcardSubroomId) || null,
    [roomPreviewFlashcardSubrooms, previewFlashcardSubroomId]
  );

  const previewFlashcards = useMemo(() => {
    if (canEditCapture) return filteredWrongQuestionFlashcards;
    if (isRoomPreview) return previewFlashcardSubroom?.flashcards || [];
    return previewFlashcardSubroom?.flashcards || [];
  }, [canEditCapture, filteredWrongQuestionFlashcards, isRoomPreview, previewFlashcardSubroom]);

  useEffect(() => {
    if (flashcardIndex > previewFlashcards.length - 1) {
      setFlashcardIndex(Math.max(0, previewFlashcards.length - 1));
    }
  }, [previewFlashcards, flashcardIndex]);

  useEffect(() => {
    if (!isDivisionPreview) {
      setPreviewFlashcardRoomId("");
      return;
    }

    if (previewFlashcardRoomId && !topicPreviewFlashcardRooms.some(room => room.id === previewFlashcardRoomId)) {
      setPreviewFlashcardRoomId("");
      setPreviewFlashcardSubroomId("");
    }
  }, [isDivisionPreview, topicPreviewFlashcardRooms, previewFlashcardRoomId]);

  useEffect(() => {
    if (previewFlashcardSubroomId && !roomPreviewFlashcardSubrooms.some(subroom => subroom.id === previewFlashcardSubroomId)) {
      setPreviewFlashcardSubroomId("");
    }
  }, [roomPreviewFlashcardSubrooms, previewFlashcardSubroomId]);

  const wrongQuestionInputSource = useMemo(
    () =>
      buildWrongQuestionSourceText({
        imagePreview: wrongQuestionImagePreview,
        ocrText: wrongQuestionOcrText,
        questionText: wrongQuestionTextDraft,
        notesText: wrongQuestionNotesDraft
      }),
    [wrongQuestionImagePreview, wrongQuestionOcrText, wrongQuestionTextDraft, wrongQuestionNotesDraft]
  );

  const wrongQuestionAnalysis = useMemo(() => {
    if (wrongQuestionAnalysisCleared || !normalizeWhitespace(wrongQuestionAnalysisSourceText)) {
      return buildLocalWrongQuestionAnalysis("");
    }

    if (wrongQuestionAiResult) {
      const normalized = normalizeWrongQuestionAnalysis(wrongQuestionAiResult);
      return {
        questionText: normalized.questionText || wrongQuestionLocalAnalysis.questionText,
        summary: normalized.summary || wrongQuestionLocalAnalysis.summary,
        correctAnswer:
          Array.isArray(normalized.correctAnswer) && normalized.correctAnswer.length
            ? normalized.correctAnswer
            : wrongQuestionLocalAnalysis.correctAnswer,
        answerExtraction:
          Array.isArray(normalized.answerExtraction) && normalized.answerExtraction.length
            ? normalized.answerExtraction
            : wrongQuestionLocalAnalysis.answerExtraction,
        bulletPoints:
          Array.isArray(normalized.bulletPoints) && normalized.bulletPoints.length
            ? normalized.bulletPoints
            : wrongQuestionLocalAnalysis.bulletPoints,
        trapPoint:
          Array.isArray(normalized.trapPoint) && normalized.trapPoint.length
            ? normalized.trapPoint
            : wrongQuestionLocalAnalysis.trapPoint,
        memoryHook: normalized.memoryHook || wrongQuestionLocalAnalysis.memoryHook
      };
    }

    return wrongQuestionLocalAnalysis;
  }, [wrongQuestionAnalysisCleared, wrongQuestionAnalysisSourceText, wrongQuestionAiResult, wrongQuestionLocalAnalysis]);

  function handleExportAnalysisPdf() {
    if (!hasActiveDisplayAnalysisContent && !activeDisplayNotesForExport.length) {
      setCaptureStatus("Nothing to export yet.");
      return;
    }

    const exportWindow = window.open("", "_blank", "width=980,height=760");

    if (!exportWindow) {
      setCaptureStatus("Popup blocked. Please allow popups and try again.");
      return;
    }

    const exportTime = formatSavedAt(new Date().toISOString());
    const marginMm = 12;
    const pageMetrics = getPdfPageMetrics(pdfExportPageSize, pdfExportOrientation, marginMm);
    const liveLogicHtml = liveLogicPrintRef.current ? liveLogicPrintRef.current.outerHTML : "";
    const liveLogicWidth = liveLogicPrintRef.current?.offsetWidth || 0;
    const liveLogicHeight = liveLogicPrintRef.current?.offsetHeight || 0;
    const styles = getDocumentStyles();

    const logicAvailableWidthPx = Math.max(320, pageMetrics.contentWidthPx - 24);
    const logicAvailableHeightPx = Math.max(320, pageMetrics.contentHeightPx - 130);
    const widthScale = liveLogicWidth ? logicAvailableWidthPx / liveLogicWidth : 1;
    const fitHeightScale = liveLogicHeight ? logicAvailableHeightPx / liveLogicHeight : 1;
    const fitScale = liveLogicHtml ? Math.min(1, widthScale, fitHeightScale) : 1;
    const multiScale = liveLogicHtml ? Math.min(1, widthScale) : 1;
    const activeLogicScale = pdfExportLayoutMode === "fit" ? fitScale : multiScale;
    const logicScaledHeight = liveLogicHeight ? Math.max(240, Math.ceil(liveLogicHeight * activeLogicScale) + 8) : 320;
    const logicScaleCss = Number.isFinite(activeLogicScale) ? activeLogicScale.toFixed(4) : "1";
    const logicSectionClass = pdfExportLayoutMode === "fit" ? "logic-page fit-page" : "logic-page multi-page";
    const logicStageClass = pdfExportLayoutMode === "fit" ? "logic-export-stage fit" : "logic-export-stage multi";
    const pdfModeLabel = pdfExportLayoutMode === "fit" ? "One Page" : "Multi-page";
    const pdfOrientationLabel = pdfExportOrientation === "portrait" ? "Portrait" : "Landscape";

    const metadata = [
      `Division: ${selectedDivision}`,
      `View: ${currentViewModeLabel}`,
      `Room: ${selectedRoom?.name || "All Rooms"}`,
      `Sub Room: ${selectedSubroom?.name || (canEditCapture ? "Selected Sub-room" : "All Sub-rooms")}`,
      `Path: ${currentPathLabel}`,
      `Notes Included: ${activeDisplayNotesForExport.length}`,
      `PDF: ${pdfExportPageSize} ${pdfOrientationLabel} · ${pdfModeLabel}`,
      `Exported: ${exportTime}`
    ];

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <base href="${window.location.origin}/" />
          <title>ARE Study Notes PDF</title>
          ${styles}
          <style>
            @page {
              size: ${pdfExportPageSize} ${pdfExportOrientation};
              margin: ${marginMm}mm;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              color: #111827;
              font-family: Arial, Helvetica, sans-serif;
              line-height: 1.55;
              background: #ffffff;
            }

            .pdf-shell {
              width: 100%;
            }

            .pdf-title {
              font-size: 24px;
              font-weight: 700;
              margin-bottom: 8px;
            }

            .pdf-subtitle {
              font-size: 12px;
              color: #4b5563;
              margin-bottom: 20px;
            }

            .pdf-meta {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 8px 16px;
              padding: 12px 14px;
              border: 1px solid #d1d5db;
              border-radius: 10px;
              margin-bottom: 18px;
              font-size: 12px;
            }

            .pdf-section {
              border: 1px solid #d1d5db;
              border-radius: 12px;
              padding: 14px 16px;
              margin-bottom: 16px;
              page-break-inside: avoid;
            }

            .pdf-section-title {
              font-size: 15px;
              font-weight: 700;
              margin-bottom: 10px;
            }

            .pdf-paragraph {
              white-space: pre-wrap;
              word-break: break-word;
              margin: 0;
            }

            .pdf-list {
              margin: 0;
              padding-left: 18px;
            }

            .pdf-list li {
              margin: 0 0 6px;
              white-space: pre-wrap;
              word-break: break-word;
            }

            .pdf-note-stack {
              display: flex;
              flex-direction: column;
              gap: 12px;
            }

            .pdf-note-card {
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              padding: 12px 14px;
            }

            .pdf-note-title {
              font-size: 13px;
              font-weight: 700;
              margin-bottom: 4px;
            }

            .pdf-note-meta {
              font-size: 11px;
              color: #6b7280;
              margin-bottom: 8px;
            }

            .empty-note {
              color: #6b7280;
              font-style: italic;
            }

            .logic-page {
              page-break-before: always;
            }

            .logic-page.multi-page {
              page-break-inside: auto;
            }

            .logic-export-stage {
              border: 1px solid #d1d5db;
              border-radius: 12px;
              padding: 12px;
              background: #ffffff;
            }

            .logic-export-stage.fit {
              overflow: hidden;
              min-height: ${logicScaledHeight}px;
            }

            .logic-export-stage.multi {
              overflow: visible;
              min-height: ${logicScaledHeight}px;
            }

            .logic-export-inner {
              width: ${liveLogicWidth ? `${liveLogicWidth}px` : "100%"};
              max-width: none;
              margin: 0;
              transform-origin: top left;
              transform: scale(${logicScaleCss});
            }

            .logic-export-inner .mindmap-shell {
              margin: 0;
              padding: 0;
              border: none;
              background: transparent;
            }

            .logic-export-inner .mindmap-board {
              margin: 0 auto;
            }

            .print-note {
              margin-top: 20px;
              font-size: 11px;
              color: #6b7280;
            }

            @media print {
              .print-note {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <div class="pdf-shell">
            <div class="pdf-title">${escapeHtml(currentViewTitle)}</div>
            <div class="pdf-subtitle">Exported from Capture Notes Workspace</div>

            <div class="pdf-meta">
              ${metadata.map(item => `<div>${escapeHtml(item)}</div>`).join("")}
            </div>

            ${formatNotesCollectionForPdf(canEditCapture ? "Capture Notes" : "Saved Notes Included", activeDisplayNotesForExport)}

            <section class="pdf-section">
              <div class="pdf-section-title">Summary</div>
              <p class="pdf-paragraph ${activeDisplayAnalysis.summary ? "" : "empty-note"}">
                ${escapeHtml(activeDisplayAnalysis.summary || "No summary available.")}
              </p>
            </section>

            ${formatAnalysisSectionForPdf("Bullet Points", activeDisplayAnalysis.bulletPoints)}
            ${formatAnalysisSectionForPdf("Logic Links", activeDisplayAnalysis.logicLinks)}

            ${
              liveLogicHtml
                ? `
                  <section class="pdf-section ${logicSectionClass}">
                    <div class="pdf-section-title">Logic Image</div>
                    <div class="${logicStageClass}">
                      <div class="logic-export-inner">
                        ${liveLogicHtml}
                      </div>
                    </div>
                  </section>
                `
                : ""
            }

            <div class="print-note">When the print window opens, choose “Save as PDF”.</div>
          </div>

          <script>
            window.onload = function () {
              setTimeout(function () {
                window.focus();
                window.print();
              }, 350);
            };
          <\/script>
        </body>
      </html>
    `;

    exportWindow.document.open();
    exportWindow.document.write(html);
    exportWindow.document.close();
    setCaptureStatus(`PDF export opened (${pdfExportPageSize} ${pdfOrientationLabel} · ${pdfModeLabel}).`);
  }

  function handleAnalyzeCapture() {
    if (!canEditCapture) {
      setCaptureStatus("Select a sub-room to start writing notes.");
      return;
    }

    if (!normalizeWhitespace(captureDraft)) {
      setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
      setCaptureAiResult(null);
      setCaptureAnalysisSourceText("");
      setCaptureAnalysisCleared(true);
      setCaptureStatus("Editor is empty.");
      return;
    }

    const local = buildLocalCaptureAnalysis(captureDraft);
    setCaptureLocalAnalysis(local);
    setCaptureAiResult(null);
    setCaptureAnalysisSourceText(captureDraft);
    setCaptureAnalysisCleared(false);
    setCaptureStatus("Local analysis complete.");
  }

  function handleClearAnalysis() {
    setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
    setCaptureAiResult(null);
    setCaptureAnalysisSourceText("");
    setCaptureAnalysisCleared(true);
    setCaptureStatus("Analysis cleared.");
  }

  function handleClearEditor() {
    if (!canEditCapture) {
      setCaptureStatus("Select a sub-room to start writing notes.");
      return;
    }

    setCaptureDraft("");
    setCaptureStatus("Editor cleared. Analysis kept.");
  }

  async function handleSaveNote() {
    if (!canEditCapture) {
      setCaptureStatus("Please select a sub-room before saving notes.");
      return;
    }

    if (!normalizeWhitespace(captureDraft)) {
      setCaptureStatus("Editor is empty.");
      return;
    }

    const plainText = getCaptureNoteVisibleText(String(captureDraft || "").trim());
    const captureMeta = buildStoredCaptureNoteMeta({
      localAnalysis: captureLocalAnalysis,
      aiResult: captureAiResult,
      analysisSourceText: captureAnalysisSourceText,
      analysisCleared: captureAnalysisCleared
    });
    const storedText = buildStoredCaptureNoteText(plainText, captureMeta);

    const newNote = {
      id: createId("note"),
      division: selectedDivision,
      roomId: selectedRoomId,
      roomName: selectedRoom?.name || "",
      subroomId: selectedSubroomId || "",
      subroomName: selectedSubroom?.name || "",
      text: storedText,
      plainText,
      captureMeta,
      savedAt: new Date().toISOString()
    };

    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newNote)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSavedCaptureNotes(prev => [newNote, ...prev.filter(item => item.id !== newNote.id)]);
        setCaptureStatus(`Saved locally at ${formatSavedAt(newNote.savedAt)}. Your editor and analysis were kept.`);
        return;
      }

      const returnedNote = data.note || data.savedNote || {};
      const mergedPlainText =
        typeof returnedNote.plainText === "string"
          ? getCaptureNoteVisibleText(returnedNote.plainText)
          : plainText;
      const mergedCaptureMeta =
        returnedNote.captureMeta && typeof returnedNote.captureMeta === "object"
          ? returnedNote.captureMeta
          : captureMeta;
      const mergedText =
        typeof returnedNote.text === "string" && returnedNote.text.includes(CAPTURE_NOTE_META_MARKER)
          ? returnedNote.text
          : buildStoredCaptureNoteText(mergedPlainText, mergedCaptureMeta);

      const savedNote = {
        ...newNote,
        ...returnedNote,
        text: mergedText,
        plainText: mergedPlainText,
        captureMeta: mergedCaptureMeta
      };

      setSavedCaptureNotes(prev => [savedNote, ...prev.filter(item => item.id !== savedNote.id && item.id !== newNote.id)]);
      setCaptureStatus(`Saved note at ${formatSavedAt(savedNote.savedAt || newNote.savedAt)}. Your editor and analysis were kept.`);
    } catch (error) {
      console.error(error);
      setSavedCaptureNotes(prev => [newNote, ...prev.filter(item => item.id !== newNote.id)]);
      setCaptureStatus(`Saved locally at ${formatSavedAt(newNote.savedAt)}. Cloud sync failed, but your editor and analysis were kept.`);
    }
  }

  function handleLoadSavedNote(note) {
    if (!canEditCapture) {
      setCaptureStatus("Select a sub-room to load saved notes.");
      return;
    }

    const visibleText = getCaptureNoteVisibleText(note);
    if (!normalizeWhitespace(visibleText)) {
      setCaptureStatus("Saved note is empty.");
      return;
    }

    const currentDraftText = String(captureDraft || "").trim();
    const shouldMergeWithEditor = Boolean(normalizeWhitespace(currentDraftText));

    if (!shouldMergeWithEditor) {
      const workspace = buildCaptureWorkspaceFromNote(
        note,
        `Loaded saved note from ${formatSavedAt(note.savedAt)} with its original analysis.`
      );

      applyCaptureWorkspace(workspace);
      setCaptureWorkspaceByKey(prev => ({
        ...prev,
        [captureWorkspaceKey]: buildCaptureWorkspaceFromState(workspace)
      }));
      lastHydratedCaptureWorkspaceKeyRef.current = captureWorkspaceKey;
      return;
    }

    const normalizedCurrent = normalizeWhitespace(currentDraftText);
    const normalizedLoaded = normalizeWhitespace(visibleText);
    const mergedDraft = normalizedCurrent === normalizedLoaded
      ? currentDraftText
      : `${currentDraftText}

${visibleText}`;

    const mergedWorkspace = buildCaptureWorkspaceFromState({
      draft: mergedDraft,
      localAnalysis: EMPTY_CAPTURE_ANALYSIS,
      aiResult: null,
      analysisSourceText: "",
      analysisCleared: true,
      status: `Merged saved note from ${formatSavedAt(note.savedAt)} into the editor. Run Analyze or Ask AI to re-analyze everything.`
    });

    applyCaptureWorkspace(mergedWorkspace);
    setCaptureWorkspaceByKey(prev => ({
      ...prev,
      [captureWorkspaceKey]: buildCaptureWorkspaceFromState(mergedWorkspace)
    }));
    lastHydratedCaptureWorkspaceKeyRef.current = captureWorkspaceKey;
  }

  function handleLoadTopicSample() {
    if (!canEditCapture) {
      setCaptureStatus("Select a sub-room to start writing notes.");
      return;
    }

    setCaptureDraft(SAMPLE_BY_DIVISION[selectedDivision] || "");
    setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
    setCaptureAiResult(null);
    setCaptureAnalysisSourceText("");
    setCaptureAnalysisCleared(true);
    setCaptureStatus(`Loaded ${selectedDivision} sample.`);
  }

  async function handleCaptureRunAI() {
    if (!canEditCapture) {
      setCaptureStatus("Select a sub-room to use AI analysis.");
      return;
    }

    if (!normalizeWhitespace(captureDraft)) {
      setCaptureStatus("Please type notes first.");
      return;
    }

    const local = buildLocalCaptureAnalysis(captureDraft);
    setCaptureLocalAnalysis(local);
    setCaptureAiResult(null);
    setCaptureAnalysisSourceText(captureDraft);
    setCaptureAnalysisCleared(false);
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
        setCaptureStatus(`AI Error: ${data.error || `HTTP ${response.status}`}`);
      } else if (data.analysis) {
        setCaptureAiResult(data.analysis);
        setCaptureStatus("AI analysis complete.");
      } else {
        setCaptureStatus("AI Error: Invalid response.");
      }
    } catch {
      setCaptureStatus("AI Error: network or timeout.");
    } finally {
      setIsCaptureAnalyzing(false);
    }
  }

async function handleAddRoom() {
  const name = window.prompt(`New room name for ${selectedDivision}:`);
  if (!name || !name.trim()) return;

  const newRoom = {
    id: createId("room"),
    name: name.trim(),
    children: []
  };

  try {
    await createRoomInCloud({
      id: newRoom.id,
      division: selectedDivision,
      parentId: null,
      name: newRoom.name,
      roomType: "room",
      sortOrder: divisionRooms.length
    });

    setRoomTree(prev => ({
      ...prev,
      [selectedDivision]: [...getRoomsForDivision(prev, selectedDivision), newRoom]
    }));

    setSelectedRoomId(newRoom.id);
    setSelectedSubroomId("");
  } catch (error) {
    console.error(error);
    window.alert("Failed to create room.");
  }
}

async function handleAddSubroom() {
  if (!selectedRoomId) {
    window.alert("Please select a room first.");
    return;
  }

  const name = window.prompt(`New sub-room name under "${selectedRoom?.name || "room"}":`);
  if (!name || !name.trim()) return;

  const newSubroom = {
    id: createId("subroom"),
    name: name.trim()
  };

  try {
    await createRoomInCloud({
      id: newSubroom.id,
      division: selectedDivision,
      parentId: selectedRoomId,
      name: newSubroom.name,
      roomType: "subroom",
      sortOrder: (selectedRoom?.children || []).length
    });

    setRoomTree(prev => ({
      ...prev,
      [selectedDivision]: getRoomsForDivision(prev, selectedDivision).map(room => {
        if (room.id !== selectedRoomId) return room;
        return {
          ...room,
          children: [...(room.children || []), newSubroom]
        };
      })
    }));

    lastHydratedCaptureWorkspaceKeyRef.current = "";
    setSelectedSubroomId(newSubroom.id);
  } catch (error) {
    console.error(error);
    window.alert("Failed to create sub-room.");
  }
}

async function handleDeleteSelectedRoomOrSubroom() {
  if (selectedSubroomId) {
    if (!window.confirm(`Delete sub-room "${selectedSubroom?.name || ""}"?`)) return;

    try {
      await deleteRoomFromCloud(selectedSubroomId);

      setRoomTree(prev => ({
        ...prev,
        [selectedDivision]: getRoomsForDivision(prev, selectedDivision).map(room => {
          if (room.id !== selectedRoomId) return room;
          return {
            ...room,
            children: (room.children || []).filter(child => child.id !== selectedSubroomId)
          };
        })
      }));

      setSelectedSubroomId("");
    } catch (error) {
      console.error(error);
      window.alert("Failed to delete sub-room.");
    }

    return;
  }

  if (!selectedRoomId || !selectedRoom) return;
  if (!window.confirm(`Delete room "${selectedRoom.name}" and all its sub-rooms?`)) return;

  try {
    await deleteRoomFromCloud(selectedRoomId);

    setRoomTree(prev => ({
      ...prev,
      [selectedDivision]: getRoomsForDivision(prev, selectedDivision).filter(room => room.id !== selectedRoomId)
    }));

    setSelectedRoomId("");
    setSelectedSubroomId("");
  } catch (error) {
    console.error(error);
    window.alert("Failed to delete room.");
  }
}

  function handleAnalyzeWrongQuestion() {
    if (!normalizeWhitespace(wrongQuestionInputSource)) {
      setWrongQuestionLocalAnalysis(buildLocalWrongQuestionAnalysis(""));
      setWrongQuestionAiResult(null);
      setWrongQuestionAnalysisSourceText("");
      setWrongQuestionAnalysisCleared(true);
      setWrongQuestionStatus("Please provide an image, wrong-question text, or wrong-question notes first.");
      return;
    }

    const local = buildLocalWrongQuestionAnalysis(wrongQuestionInputSource);
    setWrongQuestionLocalAnalysis(local);
    setWrongQuestionAiResult(null);
    setWrongQuestionAnalysisSourceText(wrongQuestionInputSource);
    setWrongQuestionAnalysisCleared(false);
    setWrongQuestionStatus("Wrong question analysis refreshed.");
  }

  async function runOcrFromFile(file) {
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
      setWrongQuestionTextDraft(detectedText);
      setWrongQuestionStatus("OCR completed.");
    } catch {
      setWrongQuestionStatus("OCR failed.");
    } finally {
      setIsRunningOcr(false);
    }
  }

  async function handleWrongQuestionFile(file) {
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
  }

  async function handleWrongQuestionImageChange(event) {
    const file = event.target.files?.[0] || null;
    await handleWrongQuestionFile(file);
  }

  function handleWrongQuestionDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function handleWrongQuestionDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0] || null;
    if (!file) return;
    await handleWrongQuestionFile(file);
  }

  async function handleRunOcr() {
    if (!wrongQuestionImageFile) {
      setWrongQuestionStatus("Please select an image first.");
      return;
    }

    await runOcrFromFile(wrongQuestionImageFile);
  }

  function handleClearWrongQuestionText() {
    setWrongQuestionTextDraft("");
    setWrongQuestionStatus("Wrong question text cleared. Analysis kept.");
  }

  function handleClearWrongQuestionNotes() {
    setWrongQuestionNotesDraft("");
    setWrongQuestionStatus("Wrong question notes cleared. Analysis kept.");
  }

  function handleClearWrongQuestionAnalysis() {
    setWrongQuestionAiResult(null);
    setWrongQuestionLocalAnalysis(buildLocalWrongQuestionAnalysis(""));
    setWrongQuestionAnalysisSourceText("");
    setWrongQuestionAnalysisCleared(true);
    setWrongQuestionStatus("Wrong question analysis cleared.");
  }

  function handleClearWrongQuestionAll() {
    setWrongQuestionImageFile(null);
    setWrongQuestionImagePreview("");
    setWrongQuestionOcrText("");
    setWrongQuestionTextDraft("");
    setWrongQuestionNotesDraft("");
    setWrongQuestionAiResult(null);
    setWrongQuestionLocalAnalysis(buildLocalWrongQuestionAnalysis(""));
    setWrongQuestionAnalysisSourceText("");
    setWrongQuestionAnalysisCleared(true);
    setWrongQuestionStatus("Wrong question workspace cleared.");
    if (wrongQuestionFileInputRef.current) {
      wrongQuestionFileInputRef.current.value = "";
    }
  }

  async function handleSaveWrongQuestion() {
    if (!canEditCapture) {
      setWrongQuestionStatus("Please select a sub-room before saving a wrong-question flashcard.");
      return;
    }

    if (!normalizeWhitespace(wrongQuestionInputSource)) {
      setWrongQuestionStatus("Please provide an image, wrong-question text, or wrong-question notes first.");
      return;
    }

    const sourceText = normalizeWhitespace(wrongQuestionAnalysisSourceText)
      ? wrongQuestionAnalysisSourceText
      : wrongQuestionInputSource;
    const analysisToSave = normalizeWrongQuestionAnalysis(
      normalizeWhitespace(wrongQuestionAnalysisSourceText) ? wrongQuestionAnalysis : buildLocalWrongQuestionAnalysis(sourceText)
    );

    const newCard = {
      id: createId("flashcard"),
      division: selectedDivision,
      roomId: selectedRoomId || "",
      roomName: selectedRoom?.name || "",
      subroomId: selectedSubroomId || "",
      subroomName: selectedSubroom?.name || "",
      topicPath: currentPathLabel,
      imagePreview: wrongQuestionImagePreview,
      ocrText: wrongQuestionOcrText,
      editedText: wrongQuestionTextDraft.trim(),
      notesText: wrongQuestionNotesDraft.trim(),
      analysisSourceText: sourceText,
      questionText: analysisToSave.questionText,
      summary: analysisToSave.summary,
      correctAnswer: analysisToSave.correctAnswer,
      answerExtraction: analysisToSave.answerExtraction,
      bulletPoints: analysisToSave.bulletPoints,
      trapPoint: analysisToSave.trapPoint,
      memoryHook: analysisToSave.memoryHook,
      savedAt: new Date().toISOString()
    };

    try {
      const response = await fetch("/api/wrong-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCard)
      });

      const data = await response.json();

      if (!response.ok) {
        setWrongQuestionStatus(`Save failed: ${data.error || "Unknown error"}`);
        return;
      }

      setWrongQuestionFlashcards(prev => [data.flashcard || newCard, ...prev]);
      setFlashcardIndex(0);
      setWrongQuestionStatus("Flashcard saved to cloud.");
    } catch (error) {
      console.error(error);
      setWrongQuestionStatus("Save failed: network error.");
    }
  }

  async function handleLoadSavedFlashcards() {
    await fetchWrongQuestionFlashcardsFromCloud();
    setWrongQuestionStatus("Loaded saved flashcards from cloud.");
  }

  async function handleWrongQuestionRunAI() {
    if (!normalizeWhitespace(wrongQuestionInputSource)) {
      setWrongQuestionStatus("Please provide an image, wrong-question text, or wrong-question notes first.");
      return;
    }

    const local = buildLocalWrongQuestionAnalysis(wrongQuestionInputSource);
    setWrongQuestionLocalAnalysis(local);
    setWrongQuestionAiResult(null);
    setWrongQuestionAnalysisSourceText(wrongQuestionInputSource);
    setWrongQuestionAnalysisCleared(false);
    setIsAnalyzing(true);
    setWrongQuestionStatus("AI analyzing...");

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: wrongQuestionInputSource, type: "wrong_question" })
      });

      const data = await response.json();

      if (!response.ok) {
        setWrongQuestionStatus(`AI Error: ${data.error || `HTTP ${response.status}`}`);
      } else if (data.analysis) {
        setWrongQuestionAiResult(data.analysis);
        setWrongQuestionStatus("AI analysis complete.");
      } else {
        setWrongQuestionStatus("AI Error: Invalid response.");
      }
    } catch {
      setWrongQuestionStatus("AI Error: network or timeout.");
    } finally {
      setIsAnalyzing(false);
    }
  }

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
            {DIVISIONS.map(division => (
              <button
                key={division}
                className={`nav-pill ${selectedDivision === division ? "active" : ""}`}
                onClick={() => {
                  setSelectedDivision(division);
                  setSelectedRoomId("");
                  setSelectedSubroomId("");
                  lastHydratedCaptureWorkspaceKeyRef.current = "";
                  setCaptureDraft("");
                  setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
                  setCaptureAiResult(null);
                  setCaptureAnalysisSourceText("");
                  setCaptureAnalysisCleared(true);
                  setCaptureStatus("Ready.");
                  setPreviewFlashcardRoomId("");
                  setPreviewFlashcardSubroomId("");
                  setFlashcardIndex(0);
                }}
              >
                {division}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label-row">
            <div className="sidebar-label">{selectedDivision} Rooms</div>
            <div className="room-toolbar">
              <button className="tiny-action-btn" onClick={handleAddRoom} title="Add room">
                + Room
              </button>
              <button className="tiny-action-btn" onClick={handleAddSubroom} title="Add sub-room">
                + Sub
              </button>
            </div>
          </div>

          <div className="room-tree">
            {divisionRooms.map(room => (
              <div key={room.id} className="room-group">
                <div className="room-row">
                  <button
                    className={`room-pill ${selectedRoomId === room.id && !selectedSubroomId ? "active" : ""}`}
                    onClick={() => {
                      setSelectedRoomId(room.id);
                      setSelectedSubroomId("");
                      lastHydratedCaptureWorkspaceKeyRef.current = "";
                      setPreviewFlashcardSubroomId("");
                      setFlashcardIndex(0);
                    }}
                  >
                    {room.name}
                  </button>
                </div>

                {room.children?.length ? (
                  <div className="subroom-list">
                    {room.children.map(subroom => (
                      <button
                        key={subroom.id}
                        className={`subroom-pill ${selectedSubroomId === subroom.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedRoomId(room.id);
                          lastHydratedCaptureWorkspaceKeyRef.current = "";
                          setSelectedSubroomId(subroom.id);
                          setFlashcardIndex(0);
                        }}
                      >
                        {subroom.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="room-footer-actions">
            <button className="tiny-danger-btn" onClick={handleDeleteSelectedRoomOrSubroom}>
              Delete Selected
            </button>
          </div>
        </div>
      </aside>

      <main className="main-workspace">
        <section className="workspace-card capture-workspace">
          <div className="workspace-header">
            <h2>Capture Notes Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span>
              <span>{currentViewModeLabel}</span>
              <span>{selectedRoom?.name || "All Rooms"}</span>
              <span>{selectedSubroom?.name || (canEditCapture ? "Selected Sub-room" : "All Sub-rooms")}</span>
              <span>Saved Notes: {currentSavedNotesCount}</span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Capture Editor</div>
            <textarea
              className="panel-textarea"
              value={canEditCapture ? captureDraft : ""}
              disabled={!canEditCapture}
              onChange={event => {
                setCaptureDraft(event.target.value);
              }}
              placeholder={editorPlaceholderText}
            />
            <div className="button-row top-gap">
              <button onClick={handleAnalyzeCapture} disabled={!canEditCapture}>
                Analyze
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="button-row">
              <button onClick={handleSaveNote} disabled={!canEditCapture}>
                Save Note
              </button>
              <button onClick={() => setIsSavedNotesModalOpen(true)} disabled={!canEditCapture || !filteredSavedNotes.length}>
                Load Saved Notes
              </button>
              <button onClick={handleLoadTopicSample} disabled={!canEditCapture}>
                Load {selectedDivision} Sample
              </button>
              <button onClick={handleClearEditor} disabled={!canEditCapture}>
                Clear Editor
              </button>
              <button onClick={handleClearAnalysis} disabled={!canEditCapture || !normalizeWhitespace(activeCaptureSourceText)}>
                Clear Analysis
              </button>
            </div>
            <div className="status-text success">{capturePanelStatusText}</div>
          </div>

          <div className="workspace-grid">
            <div className="panel">
              <div className="panel-head-row">
                <h3>
                  {currentViewTitle}{" "}
                  <span className={`engine-badge ${canEditCapture && captureAiResult ? "ai" : "local"}`}>
                    {canEditCapture && captureAiResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
                </h3>
                <div className="button-row" style={{ flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
                  <select
                    value={pdfExportLayoutMode}
                    onChange={event => updatePdfExportPreferences({ layoutMode: event.target.value })}
                    title="PDF layout mode"
                    style={{ minHeight: "36px", padding: "0 10px", borderRadius: "10px", border: "1px solid #d1d5db" }}
                  >
                    <option value="fit">One Page</option>
                    <option value="multi">Multi-page</option>
                  </select>
                  <select
                    value={pdfExportOrientation}
                    onChange={event => updatePdfExportPreferences({ orientation: event.target.value })}
                    title="PDF orientation"
                    style={{ minHeight: "36px", padding: "0 10px", borderRadius: "10px", border: "1px solid #d1d5db" }}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                  <select
                    value={pdfExportPageSize}
                    onChange={event => updatePdfExportPreferences({ pageSize: event.target.value })}
                    title="PDF page size"
                    style={{ minHeight: "36px", padding: "0 10px", borderRadius: "10px", border: "1px solid #d1d5db" }}
                  >
                    <option value="A4">A4</option>
                    <option value="A3">A3</option>
                  </select>
                  <button
                    onClick={handleExportAnalysisPdf}
                    disabled={!hasActiveDisplayAnalysisContent && !activeDisplayNotesForExport.length}
                  >
                    Export PDF
                  </button>
                  <button className="ask-ai-btn" onClick={handleCaptureRunAI} disabled={!canEditCapture || isCaptureAnalyzing}>
                    {isCaptureAnalyzing ? "Thinking..." : "✨ Ask AI"}
                  </button>
                </div>
              </div>

              <div className="analysis-stack">
                <CapturePanelSection title="Summary" empty={!activeDisplayAnalysis.summary}>
                  {activeDisplayAnalysis.summary || ""}
                </CapturePanelSection>

                <CapturePanelSection title="Bullet Points" empty={!activeDisplayAnalysis.bulletPoints.length}>
                  {activeDisplayAnalysis.bulletPoints.length ? (
                    <ul className="clean-list">
                      {activeDisplayAnalysis.bulletPoints.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    ""
                  )}
                </CapturePanelSection>

                <CapturePanelSection title="Logic Links" empty={!activeDisplayAnalysis.logicLinks.length}>
                  {activeDisplayAnalysis.logicLinks.length ? (
                    <ul className="clean-list">
                      {activeDisplayAnalysis.logicLinks.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    ""
                  )}
                </CapturePanelSection>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head-row">
                <h3>
                  Live Logic Image{" "}
                  <span className={`engine-badge ${canEditCapture && captureAiResult ? "ai" : "local"}`}>
                    {canEditCapture && captureAiResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
                </h3>
                <div className="button-row" style={{ flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
                  <button onClick={() => adjustLiveLogicZoom(liveLogicZoom - 0.15)} disabled={!currentMindMap}>
                    −
                  </button>
                  <button onClick={() => adjustLiveLogicZoom(1)} disabled={!currentMindMap}>
                    Reset {liveLogicZoomPercent}
                  </button>
                  <button onClick={() => adjustLiveLogicZoom(liveLogicZoom + 0.15)} disabled={!currentMindMap}>
                    +
                  </button>
                  <button onClick={handleOpenLiveLogicImage} disabled={!currentMindMap || isOpeningLiveLogicImage}>
                    {isOpeningLiveLogicImage ? "Opening Image..." : "Open Image"}
                  </button>
                </div>
              </div>

              <div className="mindmap-shell" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {!currentMindMap ? (
                  <div className="analysis-box is-empty">
                    {!normalizeWhitespace(activeDisplaySourceText) && !canEditCapture
                      ? "No saved notes to preview in this level yet."
                      : ""}
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#64748b",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        flexWrap: "wrap"
                      }}
                    >
                      <span>Click the logic image to open a full image preview.</span>
                      <span>Zoom: {liveLogicZoomPercent}</span>
                    </div>

                    <div
                      style={{
                        overflow: "auto",
                        borderRadius: "18px",
                        border: "1px solid rgba(148, 163, 184, 0.22)",
                        background: "linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.92))",
                        padding: "14px"
                      }}
                    >
                      <div style={{ width: "max-content", minWidth: "100%", zoom: liveLogicZoom }}>
                        <div
                          className="mindmap-board"
                          ref={liveLogicPrintRef}
                          onClick={handleOpenLiveLogicImage}
                          style={{ cursor: isOpeningLiveLogicImage ? "progress" : "zoom-in" }}
                          title="Open full image preview"
                        >
                          <MindMapNode node={currentMindMap} isRoot />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="workspace-card wrong-question-workspace">
          <div className="workspace-header">
            <h2>Wrong Question Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span>
              <span>{currentViewModeLabel}</span>
              <span>{selectedRoom?.name || "All Rooms"}</span>
              <span>{selectedSubroom?.name || (canEditCapture ? "Selected Sub-room" : "All Sub-rooms")}</span>
              <span>Saved Flashcards: {previewFlashcards.length}</span>
            </div>
          </div>

          <div className="workspace-grid">
            <div className="panel">
              <div className="panel-title">Wrong Question Input</div>

              <div
                className="subcard compact-subcard"
                onDragOver={handleWrongQuestionDragOver}
                onDrop={handleWrongQuestionDrop}
              >
                <div className="subcard-title">Image Upload</div>

                {wrongQuestionImagePreview ? (
                  <img src={wrongQuestionImagePreview} alt="Preview" className="image-preview" />
                ) : (
                  <div className="image-placeholder">Drag and drop an image here, or upload one.</div>
                )}

                <div className="button-row top-gap">
                  <label className="upload-nav-pill">
                    Upload Image
                    <input ref={wrongQuestionFileInputRef} type="file" accept="image/*" onChange={handleWrongQuestionImageChange} hidden />
                  </label>

                  {wrongQuestionImagePreview ? (
                    <button
                      className="danger-lite-btn"
                      onClick={() => {
                        setWrongQuestionImageFile(null);
                        setWrongQuestionImagePreview("");
                        setWrongQuestionOcrText("");
                        setWrongQuestionStatus("Image removed. Analysis kept.");
                        if (wrongQuestionFileInputRef.current) {
                          wrongQuestionFileInputRef.current.value = "";
                        }
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
                  value={wrongQuestionTextDraft}
                  onChange={event => setWrongQuestionTextDraft(event.target.value)}
                  placeholder="Paste wrong-question text here or edit the OCR result..."
                />
              </div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Wrong Question Notes</div>
                <textarea
                  className="panel-textarea wrong-question-textarea"
                  value={wrongQuestionNotesDraft}
                  onChange={event => setWrongQuestionNotesDraft(event.target.value)}
                  placeholder="Write your own wrong-question notes here..."
                />
                <div className="button-row top-gap">
                  <button onClick={handleAnalyzeWrongQuestion}>Analyze</button>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head-row">
                <h3>
                  Analysis {" "}
                  <span className={`engine-badge ${wrongQuestionAiResult ? "ai" : "local"}`}>
                    {wrongQuestionAiResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
                </h3>
                <button className="ask-ai-btn" onClick={handleWrongQuestionRunAI} disabled={isAnalyzing}>
                  {isAnalyzing ? "Thinking..." : "✨ Ask AI"}
                </button>
              </div>

              <div className="analysis-mini-grid">
                <div className="subcard analysis-span-2">
                  <div className="subcard-title">Summary</div>
                  <div className={`analysis-box ${wrongQuestionAnalysisCleared ? "is-empty" : ""}`}>{wrongQuestionAnalysis.summary}</div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Correct Answer</div>
                  <div className={`analysis-box ${wrongQuestionAnalysisCleared ? "is-empty" : ""}`}>
                    {Array.isArray(wrongQuestionAnalysis.correctAnswer)
                      ? wrongQuestionAnalysis.correctAnswer.join(" / ")
                      : wrongQuestionAnalysis.correctAnswer}
                  </div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Memory Hook</div>
                  <div className={`analysis-box ${wrongQuestionAnalysisCleared ? "is-empty" : ""}`}>{wrongQuestionAnalysis.memoryHook}</div>
                </div>

                <div className="subcard analysis-span-2">
                  <div className="subcard-title">Bullet Points</div>
                  <div className={`analysis-box ${wrongQuestionAnalysisCleared ? "is-empty" : ""}`}>
                    <ul className="clean-list">
                      {wrongQuestionAnalysis.bulletPoints.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="subcard analysis-span-2">
                  <div className="subcard-title">Answer Extraction</div>
                  <div className={`analysis-box ${wrongQuestionAnalysisCleared ? "is-empty" : ""}`}>
                    <ul className="clean-list">
                      {wrongQuestionAnalysis.answerExtraction.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="subcard analysis-span-2">
                  <div className="subcard-title">Trap Point</div>
                  <div className={`analysis-box ${wrongQuestionAnalysisCleared ? "is-empty" : ""}`}>
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

          <div className="panel">
            <div className="button-row">
              <button onClick={handleSaveWrongQuestion} disabled={!canEditCapture}>Save Wrong Question</button>
              <button onClick={handleLoadSavedFlashcards}>Load Saved Flashcards</button>
              <button onClick={handleClearWrongQuestionText}>Clear Text</button>
              <button onClick={handleClearWrongQuestionNotes}>Clear Notes</button>
              <button onClick={handleClearWrongQuestionAnalysis}>Clear Analysis</button>
              <button onClick={handleClearWrongQuestionAll}>Clear All</button>
            </div>
            <div className="status-text success">{wrongQuestionStatus}</div>
          </div>

          <div className="panel">
            <div className="panel-title">Wrong Question Flashcards</div>

            {canEditCapture ? (
              !previewFlashcards.length ? (
                <div className="flashcard-placeholder">No saved flashcards in this sub-room yet.</div>
              ) : (
                <div className="flashcard-carousel">
                  <div className="flashcard-carousel-header">
                    <button onClick={() => setFlashcardIndex(prev => Math.max(0, prev - 1))} disabled={flashcardIndex === 0}>
                      ← Previous
                    </button>
                    <div className="flashcard-counter">
                      {flashcardIndex + 1} / {previewFlashcards.length}
                    </div>
                    <button
                      onClick={() => setFlashcardIndex(prev => Math.min(previewFlashcards.length - 1, prev + 1))}
                      disabled={flashcardIndex === previewFlashcards.length - 1}
                    >
                      Next →
                    </button>
                  </div>

                  {currentFlashcard ? (
                    <div className="flashcard-slide">
                      <div className="flashcard-slide-top">
                        <div className="flashcard-meta">
                          {currentFlashcard.topicPath} · {formatSavedAt(currentFlashcard.savedAt)}
                        </div>
                        <button
                          className="danger-lite-btn"
                          onClick={async () => {
                            if (!window.confirm("Delete this flashcard?")) return;
                            const deleted = await deleteWrongQuestionFlashcardFromCloud(currentFlashcard.id);
                            if (!deleted) return;
                            setWrongQuestionFlashcards(prev => prev.filter(card => card.id !== currentFlashcard.id));
                            setFlashcardIndex(prev => (prev > 0 ? prev - 1 : 0));
                          }}
                        >
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
              )
            ) : isRoomPreview ? (
              <div className="preview-browser-stack">
                <div className="preview-browser-title">Select a sub-room to preview saved flashcards in this room.</div>
                {!roomPreviewFlashcardSubrooms.length ? (
                  <div className="flashcard-placeholder">No saved flashcards in this room yet.</div>
                ) : (
                  <>
                    <div className="preview-pill-grid">
                      {roomPreviewFlashcardSubrooms.map(subroom => (
                        <button
                          key={subroom.id}
                          className={`subroom-pill ${previewFlashcardSubroomId === subroom.id ? "active" : ""}`}
                          onClick={() => {
                            setPreviewFlashcardSubroomId(subroom.id);
                            setFlashcardIndex(0);
                          }}
                        >
                          {subroom.name} ({subroom.flashcards.length})
                        </button>
                      ))}
                    </div>

                    {!previewFlashcardSubroom ? (
                      <div className="flashcard-placeholder">Choose a sub-room above to preview its flashcards.</div>
                    ) : (
                      <div className="flashcard-list-stack">
                        {previewFlashcards.map(card => (
                          <div key={card.id} className="subcard compact-subcard">
                            <div className="flashcard-meta">{card.subroomName} · {formatSavedAt(card.savedAt)}</div>
                            <div className="subcard-title">{card.questionText}</div>
                            <p className="plain-paragraph">{card.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="preview-browser-stack">
                <div className="preview-browser-title">Select a room, then a sub-room, to preview saved flashcards in this topic.</div>
                {!topicPreviewFlashcardRooms.length ? (
                  <div className="flashcard-placeholder">No saved flashcards in this topic yet.</div>
                ) : (
                  <>
                    <div className="preview-pill-grid">
                      {topicPreviewFlashcardRooms.map(room => (
                        <button
                          key={room.id}
                          className={`room-pill ${previewFlashcardRoomId === room.id ? "active" : ""}`}
                          onClick={() => {
                            setPreviewFlashcardRoomId(room.id);
                            setPreviewFlashcardSubroomId("");
                            setFlashcardIndex(0);
                          }}
                        >
                          {room.name} ({room.flashcards.length})
                        </button>
                      ))}
                    </div>

                    {previewFlashcardRoom ? (
                      <>
                        <div className="preview-browser-title">{previewFlashcardRoom.name} sub-rooms</div>
                        <div className="preview-pill-grid">
                          {roomPreviewFlashcardSubrooms.map(subroom => (
                            <button
                              key={subroom.id}
                              className={`subroom-pill ${previewFlashcardSubroomId === subroom.id ? "active" : ""}`}
                              onClick={() => {
                                setPreviewFlashcardSubroomId(subroom.id);
                                setFlashcardIndex(0);
                              }}
                            >
                              {subroom.name} ({subroom.flashcards.length})
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}

                    {!previewFlashcardSubroom ? (
                      <div className="flashcard-placeholder">Choose a sub-room to preview its saved flashcards.</div>
                    ) : (
                      <div className="flashcard-list-stack">
                        {previewFlashcards.map(card => (
                          <div key={card.id} className="subcard compact-subcard">
                            <div className="flashcard-meta">
                              {card.roomName} / {card.subroomName} · {formatSavedAt(card.savedAt)}
                            </div>
                            <div className="subcard-title">{card.questionText}</div>
                            <p className="plain-paragraph">{card.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <SavedNotesModal
        isOpen={isSavedNotesModalOpen}
        onClose={() => setIsSavedNotesModalOpen(false)}
        notes={filteredSavedNotes}
        onLoadNote={handleLoadSavedNote}
        onDeleteNote={deleteSavedNoteFromCloud}
        currentPathLabel={currentPathLabel}
      />

      {expandedImage ? (
        <div className="overlay-backdrop" onClick={closeExpandedImage}>
          <div className="overlay-card image-modal" onClick={event => event.stopPropagation()}>
            <button className="icon-close-btn image-close" onClick={closeExpandedImage}>
              ×
            </button>
            <div className="button-row" style={{ justifyContent: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
              {typeof expandedImage === "object" && expandedImage?.svgMarkup ? (
                <>
                  <button
                    type="button"
                    onClick={() => downloadExpandedLogicImage("png")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: "38px",
                      padding: "0 16px",
                      borderRadius: "12px",
                      border: "1px solid #cbd5e1",
                      background: "#ffffff",
                      color: "#0f172a",
                      textDecoration: "none",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    Save PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadExpandedLogicImage("jpg")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: "38px",
                      padding: "0 16px",
                      borderRadius: "12px",
                      border: "1px solid #cbd5e1",
                      background: "#ffffff",
                      color: "#0f172a",
                      textDecoration: "none",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    Save JPG
                  </button>
                </>
              ) : null}
            </div>
            {typeof expandedImage === "object" && expandedImage?.svgMarkup ? (
              <div style={{ marginBottom: "10px", textAlign: "center", color: "#475569", fontSize: "13px" }}>
                Preview is SVG for sharp display. Use the buttons above to save PNG or JPG.
              </div>
            ) : null}
            <img src={typeof expandedImage === "string" ? expandedImage : expandedImage?.src} alt="Expanded" className="image-modal-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
