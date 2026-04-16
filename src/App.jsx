import { useEffect, useMemo, useState } from "react";
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

  DIVISIONS.forEach(division => {
    tree[division] = (DEFAULT_ROOM_NAMES[division] || []).map(name => ({
      id: `${division}-${slugify(name)}`,
      name,
      children: []
    }));

  return tree;
}

function readSavedCaptureNotes() {
  try {
    const raw = localStorage.getItem("savedCaptureNotes");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }

function readWrongQuestionFlashcards() {
  try {
    const raw = localStorage.getItem("wrongQuestionFlashcards");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
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

function normalizeAiCaptureAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return EMPTY_CAPTURE_ANALYSIS;

  return {
    summary: typeof analysis.summary === "string" ? analysis.summary.trim() : "",
    bulletPoints: Array.isArray(analysis.bulletPoints)
      ? analysis.bulletPoints.map(item => String(item).trim()).filter(Boolean)
      : [],
    logicLinks: Array.isArray(analysis.logicLinks)
      ? analysis.logicLinks.map(item => String(item).trim()).filter(Boolean)
      : []
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
  currentPathLabel
}) {
  if (!isOpen) return null;

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
              <button
                key={note.id}
                className="note-list-item"
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
                  {note.text.slice(0, 160)}
                  {note.text.length > 160 ? "..." : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
  const [captureAnalysisCleared, setCaptureAnalysisCleared] = useState(true);
  const [isCaptureAnalyzing, setIsCaptureAnalyzing] = useState(false);

  const [savedCaptureNotes, setSavedCaptureNotes] = useState([]);
  const [isSavedNotesModalOpen, setIsSavedNotesModalOpen] = useState(false);

  const [wrongQuestionImageFile, setWrongQuestionImageFile] = useState(null);
  const [wrongQuestionImagePreview, setWrongQuestionImagePreview] = useState("");
  const [wrongQuestionOcrText, setWrongQuestionOcrText] = useState("");
  const [wrongQuestionDraftText, setWrongQuestionDraftText] = useState("");
  const [wrongQuestionStatus, setWrongQuestionStatus] = useState("Ready.");
  const [isRunningOcr, setIsRunningOcr] = useState(false);

  const [wrongQuestionFlashcards, setWrongQuestionFlashcards] = useState([]);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [expandedImage, setExpandedImage] = useState("");
  const [aiAnalysisResult, setAiAnalysisResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

  useEffect(() => {
  fetchRoomsFromCloud(selectedDivision);
}, [selectedDivision]);
  
  useEffect(() => {
    if (!divisionRooms.length) {
      setSelectedRoomId("");
      setSelectedSubroomId("");
      return;
    }

    const roomStillExists = divisionRooms.some(room => room.id === selectedRoomId);
    if (!selectedRoomId || !roomStillExists) {
      setSelectedRoomId(divisionRooms[0].id);
      setSelectedSubroomId("");
      return;
    }

    if (selectedSubroomId) {
      const subroomStillExists = (selectedRoom?.children || []).some(child => child.id === selectedSubroomId);
      if (!subroomStillExists) {
        setSelectedSubroomId("");
      }
    }
  }, [divisionRooms, selectedRoomId, selectedSubroomId, selectedRoom]);

  useEffect(() => {
    if (flashcardIndex > wrongQuestionFlashcards.length - 1) {
      setFlashcardIndex(Math.max(0, wrongQuestionFlashcards.length - 1));
    }
  }, [wrongQuestionFlashcards, flashcardIndex]);

  useEffect(() => {
  fetchSavedNotesFromCloud(selectedDivision, selectedRoomId, selectedSubroomId || "");
}, [selectedDivision, selectedRoomId, selectedSubroomId]);

  const currentFlashcard = wrongQuestionFlashcards[flashcardIndex] || null;

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
  
  async function fetchSavedNotesFromCloud(division, roomId, subroomId = "") {
  if (!division || !roomId) {
    setSavedCaptureNotes([]);
    return;
  }

  try {
    const params = new URLSearchParams({
      division,
      roomId,
      subroomId: subroomId || ""
    });

    const response = await fetch(`/api/notes?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      console.error(data.error || "Failed to load notes.");
      setSavedCaptureNotes([]);
      return;
    }

    setSavedCaptureNotes(Array.isArray(data.notes) ? data.notes : []);
  } catch (error) {
    console.error(error);
    setSavedCaptureNotes([]);
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

  const activeCaptureAnalysis = useMemo(() => {
    if (captureAnalysisCleared || !normalizeWhitespace(captureDraft)) {
      return EMPTY_CAPTURE_ANALYSIS;
    }

    if (captureAiResult) {
      const normalized = normalizeAiCaptureAnalysis(captureAiResult);
      return {
        summary: normalized.summary || captureLocalAnalysis.summary,
        bulletPoints: normalized.bulletPoints.length ? normalized.bulletPoints : captureLocalAnalysis.bulletPoints,
        logicLinks: normalized.logicLinks.length ? normalized.logicLinks : captureLocalAnalysis.logicLinks
      };
    }

    return captureLocalAnalysis;
  }, [captureAnalysisCleared, captureDraft, captureAiResult, captureLocalAnalysis]);

  const currentMindMap = useMemo(() => {
    if (captureAnalysisCleared || !normalizeWhitespace(captureDraft)) return null;
    return buildMindMapFromText(captureDraft);
  }, [captureAnalysisCleared, captureDraft]);

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

  function handleAnalyzeCapture() {
    if (!normalizeWhitespace(captureDraft)) {
      setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
      setCaptureAiResult(null);
      setCaptureAnalysisCleared(true);
      setCaptureStatus("Editor is empty.");
      return;
    }

    const local = buildLocalCaptureAnalysis(captureDraft);
    setCaptureLocalAnalysis(local);
    setCaptureAiResult(null);
    setCaptureAnalysisCleared(false);
    setCaptureStatus("Local analysis complete.");
  }

  function handleClearAnalysis() {
    setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
    setCaptureAiResult(null);
    setCaptureAnalysisCleared(true);
    setCaptureStatus("Analysis cleared.");
  }

  function handleClearEditor() {
    setCaptureDraft("");
    setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
    setCaptureAiResult(null);
    setCaptureAnalysisCleared(true);
    setCaptureStatus("Editor cleared.");
  }

  function handleSaveNote() {
    if (!normalizeWhitespace(captureDraft)) {
      setCaptureStatus("Editor is empty.");
      return;
    }

    const newNote = {
      id: createId("note"),
      division: selectedDivision,
      roomId: selectedRoomId,
      roomName: selectedRoom?.name || "",
      subroomId: selectedSubroomId || "",
      subroomName: selectedSubroom?.name || "",
      text: captureDraft.trim(),
      savedAt: new Date().toISOString()
    };

    setSavedCaptureNotes(prev => [newNote, ...prev]);
    setCaptureDraft("");
    setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
    setCaptureAiResult(null);
    setCaptureAnalysisCleared(true);
    setCaptureStatus(`Saved note at ${formatSavedAt(newNote.savedAt)}.`);
  }

  function handleLoadSavedNote(note) {
    setCaptureDraft(note.text || "");
    setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
    setCaptureAiResult(null);
    setCaptureAnalysisCleared(true);
    setCaptureStatus(`Loaded saved note from ${formatSavedAt(note.savedAt)}.`);
  }

  function handleLoadTopicSample() {
    setCaptureDraft(SAMPLE_BY_DIVISION[selectedDivision] || "");
    setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
    setCaptureAiResult(null);
    setCaptureAnalysisCleared(true);
    setCaptureStatus(`Loaded ${selectedDivision} sample.`);
  }

  async function handleCaptureRunAI() {
    if (!normalizeWhitespace(captureDraft)) {
      setCaptureStatus("Please type notes first.");
      return;
    }

    const local = buildLocalCaptureAnalysis(captureDraft);
    setCaptureLocalAnalysis(local);
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
    if (!wrongQuestionDraftText.trim()) {
      setWrongQuestionStatus("Please provide text first.");
      return;
    }

    setAiAnalysisResult(null);
    setWrongQuestionStatus("Local analysis refreshed.");
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
      setWrongQuestionDraftText(detectedText);
      setAiAnalysisResult(null);
      setWrongQuestionStatus("OCR completed.");
    } catch {
      setWrongQuestionStatus("OCR failed.");
    } finally {
      setIsRunningOcr(false);
    }
  }

  async function handleWrongQuestionImageChange(event) {
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
  }

  async function handleRunOcr() {
    if (!wrongQuestionImageFile) {
      setWrongQuestionStatus("Please select an image first.");
      return;
    }

    await runOcrFromFile(wrongQuestionImageFile);
  }

  function handleClearWrongQuestion() {
  setWrongQuestionImageFile(null);
  setWrongQuestionImagePreview("");
  setWrongQuestionOcrText("");
  setWrongQuestionDraftText("");
  setAiAnalysisResult(null);
  setWrongQuestionStatus("Cleared.");
}
  
  function handleSaveWrongQuestion() {
    if (!wrongQuestionDraftText.trim()) {
      setWrongQuestionStatus("Text is empty.");
      return;
    }

    const newCard = {
      id: createId("flashcard"),
      topicPath: currentPathLabel,
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
  }

async function handleLoadSavedFlashcards() {
  await fetchWrongQuestionFlashcardsFromCloud();
  setWrongQuestionStatus("Loaded saved flashcards from cloud.");
}
  
async function handleSaveWrongQuestion() {
  if (!wrongQuestionDraftText.trim()) {
    setWrongQuestionStatus("Text is empty.");
    return;
  }

  const newCard = {
    id: createId("flashcard"),
    topicPath: currentPathLabel,
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

    setWrongQuestionFlashcards(prev => [data.flashcard, ...prev]);
    setFlashcardIndex(0);
    setWrongQuestionStatus("Flashcard saved to cloud.");
  } catch (error) {
    console.error(error);
    setWrongQuestionStatus("Save failed: network error.");
  }
}

  async function handleWrongQuestionRunAI() {
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
        setWrongQuestionStatus(`AI Error: ${data.error || `HTTP ${response.status}`}`);
      } else if (data.analysis) {
        setAiAnalysisResult(data.analysis);
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
                  setCaptureDraft("");
                  setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
                  setCaptureAiResult(null);
                  setCaptureAnalysisCleared(true);
                  setCaptureStatus("Ready.");
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
                          setSelectedSubroomId(subroom.id);
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
              <span>{selectedRoom?.name || "No Room"}</span>
              <span>{selectedSubroom?.name || "Root Level"}</span>
              <span>Saved Notes: {filteredSavedNotes.length}</span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Capture Editor</div>
            <textarea
              className="panel-textarea"
              value={captureDraft}
              onChange={event => {
                setCaptureDraft(event.target.value);
                if (!normalizeWhitespace(event.target.value)) {
                  setCaptureLocalAnalysis(EMPTY_CAPTURE_ANALYSIS);
                  setCaptureAiResult(null);
                  setCaptureAnalysisCleared(true);
                }
              }}
              placeholder="Paste notes here..."
            />
            <div className="button-row top-gap">
              <button onClick={handleAnalyzeCapture}>Analyze</button>
            </div>
          </div>

          <div className="panel">
            <div className="button-row">
              <button onClick={handleSaveNote}>Save Note</button>
              <button onClick={() => setIsSavedNotesModalOpen(true)}>Load Saved Notes</button>
              <button onClick={handleLoadTopicSample}>Load {selectedDivision} Sample</button>
              <button onClick={handleClearEditor}>Clear Editor</button>
              <button onClick={handleClearAnalysis}>Clear Analysis</button>
            </div>
            <div className="status-text success">{captureStatus}</div>
          </div>

          <div className="workspace-grid">
            <div className="panel">
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
                <CapturePanelSection title="Summary" empty={!activeCaptureAnalysis.summary}>
                  {activeCaptureAnalysis.summary || ""}
                </CapturePanelSection>

                <CapturePanelSection title="Bullet Points" empty={!activeCaptureAnalysis.bulletPoints.length}>
                  {activeCaptureAnalysis.bulletPoints.length ? (
                    <ul className="clean-list">
                      {activeCaptureAnalysis.bulletPoints.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    ""
                  )}
                </CapturePanelSection>

                <CapturePanelSection title="Logic Links" empty={!activeCaptureAnalysis.logicLinks.length}>
                  {activeCaptureAnalysis.logicLinks.length ? (
                    <ul className="clean-list">
                      {activeCaptureAnalysis.logicLinks.map((item, index) => (
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
                  <span className={`engine-badge ${captureAiResult ? "ai" : "local"}`}>
                    {captureAiResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
                </h3>
              </div>

              <div className="mindmap-shell">
                {!currentMindMap ? (
                  <div className="analysis-box is-empty">
                    {normalizeWhitespace(captureDraft) ? "" : ""}
                  </div>
                ) : (
                  <div className="mindmap-board">
                    <MindMapNode node={currentMindMap} isRoot />
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
            <div className="panel">
              <div className="panel-title">Wrong Question Input</div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Image Upload</div>

                {wrongQuestionImagePreview ? (
                  <img src={wrongQuestionImagePreview} alt="Preview" className="image-preview" />
                ) : (
                  <div className="image-placeholder">Image Preview</div>
                )}

                <div className="button-row top-gap">
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
                  placeholder="Paste wrong-question text here..."
                />
                <div className="button-row top-gap">
                  <button onClick={handleAnalyzeWrongQuestion}>Analyze</button>
                </div>
              </div>
            </div>

            <div className="panel">
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

          <div className="panel">
            <div className="button-row">
              <button onClick={handleSaveWrongQuestion}>Save Wrong Question</button>
              <button onClick={handleLoadSavedFlashcards}>Load Saved Flashcards</button>
              <button onClick={handleClearWrongQuestion}>Clear Wrong Question</button>
            </div>
            <div className="status-text success">{wrongQuestionStatus}</div>
          </div>

          <div className="panel">
            <div className="panel-title">Wrong Question Flashcards</div>

            {!wrongQuestionFlashcards.length ? (
              <div className="flashcard-placeholder">No saved flashcards yet.</div>
            ) : (
              <div className="flashcard-carousel">
                <div className="flashcard-carousel-header">
                  <button onClick={() => setFlashcardIndex(prev => Math.max(0, prev - 1))} disabled={flashcardIndex === 0}>
                    ← Previous
                  </button>
                  <div className="flashcard-counter">
                    {flashcardIndex + 1} / {wrongQuestionFlashcards.length}
                  </div>
                  <button
                    onClick={() => setFlashcardIndex(prev => Math.min(wrongQuestionFlashcards.length - 1, prev + 1))}
                    disabled={flashcardIndex === wrongQuestionFlashcards.length - 1}
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
                        onClick={() => {
                          if (!window.confirm("Delete this flashcard?")) return;
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
            )}
          </div>
        </section>
      </main>

      <SavedNotesModal
        isOpen={isSavedNotesModalOpen}
        onClose={() => setIsSavedNotesModalOpen(false)}
        notes={filteredSavedNotes}
        onLoadNote={handleLoadSavedNote}
        currentPathLabel={currentPathLabel}
      />

      {expandedImage ? (
        <div className="overlay-backdrop" onClick={() => setExpandedImage("")}>
          <div className="overlay-card image-modal" onClick={event => event.stopPropagation()}>
            <button className="icon-close-btn image-close" onClick={() => setExpandedImage("")}>
              ×
            </button>
            <img src={expandedImage} alt="Expanded" className="image-modal-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
