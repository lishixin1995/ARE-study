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
  PA: `Site analysis should start with climate, zoning, topography, and access.\nProgramming should connect client needs to spatial requirements.\nEarly code review helps define occupancy, egress, and height/area limits.`,
  PPD: `Building system: active system relies on mechanical equipment and uses more energy.\nPassive system relies on sun, air, and wind flow.\nIn cold climate, reduce heat loss and gain solar heat.\nIn hot climate, control heat gain and optimize natural ventilation.\nTrombe wall helps stabilize temperature but takes more space.`,
  PDD: `Envelope detailing must control water, air, vapor, and thermal transfer.\nMaterial selection affects durability, constructability, and maintenance.\nDocumentation should clearly coordinate assemblies, dimensions, and specifications.`,
  PCM: `Practice management connects staffing, risk, finance, and firm operations.\nA sustainable office workflow depends on planning, communication, and resource control.`,
  PJM: `Project management coordinates scope, schedule, consultant communication, and delivery expectations.\nConstruction administration requires tracking submittals, RFIs, and field conditions.`,
  CE: `Construction evaluation depends on site observation, documentation, and follow-up.\nPunch list review compares completed work against contract expectations.`
};

// ==========================================
// 🧠 Capture Smart Parser
// ==========================================
function capitalizeWords(text) {
  return (text || "")
    .trim()
    .split(" ")
    .map(word => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function smartSplit(text) {
  if (!text) return [];
  const formatted = text.replace(/(\d+\.)/g, "| $1");
  return formatted
    .split(/[。！？;；|]/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
}

function buildCaptureSummary(text) {
  if (!text) return "等待输入...";
  const lower = text.toLowerCase();
  const topics = [];
  if (lower.includes("system") || lower.includes("active") || lower.includes("passive")) {
    topics.push("Building Systems (Active/Passive)");
  }
  if (lower.includes("climate") || lower.includes("hot") || lower.includes("cold")) {
    topics.push("Climate Strategies");
  }
  if (lower.includes("solar") || lower.includes("sun") || lower.includes("daylight")) {
    topics.push("Solar & Daylighting");
  }

  if (topics.length > 0) {
    return `📝 核心考点探讨：${topics.join(" / ")}。主要记录了不同系统与自然气候条件下的建筑应对策略及优缺点。`;
  }
  const frags = smartSplit(text);
  return frags.length > 0 ? frags[0] : "无法生成摘要";
}

function buildCaptureExtraction(text) {
  if (!text) return ["等待输入以提取核心知识点..."];
  const frags = smartSplit(text);
  const extractions = [];

  frags.forEach(f => {
    if (f.includes(":") || f.includes("：")) {
      const parts = f.split(/[:：]/);
      extractions.push(`🎯 关键定义 [${capitalizeWords(parts[0])}]：${parts[1]?.trim() || ""}`);
    } else if (f.includes("- ") || f.includes("– ")) {
      extractions.push(`📌 策略关联：${f}`);
    } else if (f.length > 15) {
      extractions.push(`🔸 ${f}`);
    }
  });
  return extractions;
}

function buildCaptureBulletPoints(text) {
  if (!text) return ["等待输入..."];
  const frags = smartSplit(text);
  return frags
    .map(f => {
      let clean = f.replace(/^[1-9]\.\s*/, "");
      if (clean.includes(":") || clean.includes("：")) {
        const parts = clean.split(/[:：]/);
        return `${capitalizeWords(parts[0])}: ${parts[1]?.trim() || ""}`;
      }
      return clean;
    })
    .filter(f => f.length > 5);
}

function buildCaptureLogicLinks(text) {
  if (!text) return ["等待输入以生成逻辑链..."];
  const links = [];
  const frags = smartSplit(text);

  frags.forEach(f => {
    if (f.includes(":") || f.includes("：")) {
      const pts = f.split(/[:：]/);
      links.push(`[${capitalizeWords(pts[0])}] ➔ ${pts[1]?.trim() || ""}`);
    } else if (f.includes(" - ") || f.includes(" – ")) {
      const pts = f.split(/\s*[-–]\s*/);
      links.push(`[${capitalizeWords(pts[0])}] ➔ ${pts[1]?.trim() || ""}`);
    } else {
      const match = f.match(/(.*?)\s+(need to|avoid|use|provide|minimize|reduce|gain|collect)\s+(.*)/i);
      if (match && match[1].length < 30) {
        links.push(`[${capitalizeWords(match[1])}] ➔ ${match[2].toLowerCase()} ➔ ${match[3]}`);
      }
    }
  });

  return links.length > 0
    ? links
    : ["💡 提示：在笔记中使用冒号 (:) 或破折号 (-) 即可自动生成完美逻辑链。"];
}

function node(label, relation = null, children = []) {
  return { label, relation, children };
}

function buildCaptureLogicForest(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const trees = [];

  const systemsChildren = [];
  if (lower.includes("active system") || lower.includes("mechanical")) {
    systemsChildren.push(
      node("Active System", "typically for", [
        node("Mechanical Equipment", "relies on"),
        node("Large Building", "used for"),
        node("Heavy Energy Use", "effect")
      ])
    );
  }
  if (lower.includes("passive system") || lower.includes("air") || lower.includes("sun")) {
    systemsChildren.push(
      node("Passive System", "features", [
        node("Air / Sun / Windflow", "depends on"),
        node("Less Control", "trade-off"),
        node("Better Sustainable", "advantage")
      ])
    );
  }
  if (systemsChildren.length) trees.push(node("Building Systems", null, systemsChildren));

  const climateChildren = [];
  if (lower.includes("cold climate") || lower.includes("heat loss")) {
    climateChildren.push(
      node("Cold Climate", "strategy", [
        node("Minimize Heat Loss", "goal"),
        node("Block Cold Wind", "action"),
        node("Gain Solar Heat", "action")
      ])
    );
  }
  if (lower.includes("hot climate") || lower.includes("heat gain")) {
    climateChildren.push(
      node("Hot Climate", "strategy", [
        node("Control Heat Gain", "goal"),
        node("Provide Shading", "action"),
        node("Natural Ventilation", "optimize")
      ])
    );
  }
  if (climateChildren.length) trees.push(node("Climate Strategies", null, climateChildren));

  const componentsChildren = [];
  if (lower.includes("trombe wall")) {
    componentsChildren.push(
      node("Trombe Wall", "component", [
        node("Stable Temperature", "provides"),
        node("Lot of Space", "needs")
      ])
    );
  }
  if (lower.includes("flat collector")) {
    componentsChildren.push(node("Flat Collector", "component", [node("Collect Sunlight", "function")]));
  }
  if (lower.includes("rock bed")) {
    componentsChildren.push(
      node("Fan Forced Rock Bed", "component", [node("Greatest Temp Control", "advantage")])
    );
  }
  if (componentsChildren.length) trees.push(node("Specific Components", null, componentsChildren));

  if (!trees.length) {
    const frags = smartSplit(text).slice(0, 4);
    trees.push(node("Key Concepts", null, frags.map(s => node(s.substring(0, 30) + "...", "note"))));
  }
  return trees;
}

// ==========================================
// ❌ Wrong Question Parser
// ==========================================
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
    ? correctLines.map(line =>
        line.replace(/^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i, "").trim()
      )
    : ["未检测到 Correct 关键词，请手动修改。"];
}

function buildWrongQuestionTrapPoint(text) {
  const incorrectLines = normalizeWrongQuestionLines(text).filter(line =>
    /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i.test(line)
  );

  return incorrectLines.length
    ? incorrectLines.map(line =>
        line.replace(/^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i, "").trim()
      )
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
        {tree.relation && (
          <span className={`logic-relation-pill relation-${tree.relation.replace(/\s+/g, "-")}`}>
            {capitalizeWords(tree.relation)}
          </span>
        )}
        <div className={`logic-node-card ${depth === 0 ? "root" : ""}`}>{tree.label}</div>
      </div>
      {tree.children?.length ? (
        <div className="logic-children">
          {tree.children.map((child, i) => (
            <LogicTreeNode key={i} tree={child} depth={depth + 1} />
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

// ==========================================
// 🎯 Main App
// ==========================================
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
  }, [captureDraft, savedNotesByTopic, currentTopicKey]);

  useEffect(() => {
    setAiAnalysisResult(null);
  }, [wrongQuestionDraftText]);

  const effectiveCaptureText = useMemo(() => captureDraft.trim(), [captureDraft]);

  const isCaptureEmpty = !effectiveCaptureText.trim();

  const captureSummary = useMemo(
    () =>
      isCaptureEmpty
        ? "等待输入..."
        : captureAiResult?.summary || buildCaptureSummary(effectiveCaptureText),
    [effectiveCaptureText, captureAiResult, isCaptureEmpty]
  );

  const captureExtraction = useMemo(
    () =>
      isCaptureEmpty
        ? ["等待输入以提取核心知识点..."]
        : captureAiResult?.extraction || buildCaptureExtraction(effectiveCaptureText),
    [effectiveCaptureText, captureAiResult, isCaptureEmpty]
  );

  const captureBulletPoints = useMemo(
    () =>
      isCaptureEmpty
        ? ["等待输入..."]
        : captureAiResult?.bulletPoints || buildCaptureBulletPoints(effectiveCaptureText),
    [effectiveCaptureText, captureAiResult, isCaptureEmpty]
  );

  const captureLogicLinks = useMemo(
    () =>
      isCaptureEmpty
        ? ["等待输入以生成逻辑链..."]
        : captureAiResult?.logicLinks || buildCaptureLogicLinks(effectiveCaptureText),
    [effectiveCaptureText, captureAiResult, isCaptureEmpty]
  );

  const captureLogicForest = useMemo(
    () =>
      isCaptureEmpty
        ? []
        : captureAiResult?.logicForest || buildCaptureLogicForest(effectiveCaptureText),
    [effectiveCaptureText, captureAiResult, isCaptureEmpty]
  );

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

  // =========================
  // Capture handlers
  // =========================
  const handleAnalyzeCapture = () => {
    if (!effectiveCaptureText.trim()) {
      setCaptureAiResult(null);
      setCaptureStatus("Please type notes first.");
      return;
    }
    setCaptureAiResult(null);
    setCaptureStatus("Analysis refreshed.");
  };

  const handleCaptureTextareaKeyDown = e => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      setTimeout(() => {
        handleAnalyzeCapture();
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
    setCaptureStatus("Saved locally and analysis refreshed.");
  };

  const handleLoadSavedNotes = () => {
    if (!savedNotesForTopic.length) {
      setCaptureStatus(`No notes found for ${currentTopicKey}.`);
      return;
    }

    const mergedText = savedNotesForTopic.map(item => item.text).join("\n\n");
    setCaptureDraft(mergedText);
    setCaptureAiResult(null);
    setCaptureStatus(`${currentTopicKey} loaded ${savedNotesForTopic.length} notes.`);
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

  // =========================
  // Wrong question handlers
  // =========================
  const handleAnalyzeWrongQuestion = () => {
    if (!wrongQuestionDraftText.trim()) {
      setWrongQuestionStatus("Please provide text first.");
      return;
    }
    setAiAnalysisResult(null);
    setWrongQuestionStatus("Analysis refreshed.");
  };

  const handleWrongQuestionTextareaKeyDown = e => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      setTimeout(() => {
        handleAnalyzeWrongQuestion();
      }, 0);
    }
  };

  const runOcrFromFile = async file => {
    if (!file) return;

    try {
      setIsRunningOcr(true);
      setWrongQuestionStatus("Reading image...");

      const result = await Tesseract.recognize(file, "eng");

      if (!result?.data?.text?.trim()) {
        setWrongQuestionStatus("No text detected.");
        return;
      }

      const detectedText = result.data.text.trim();
      setWrongQuestionOcrText(detectedText);
      setWrongQuestionDraftText(detectedText);
      setAiAnalysisResult(null);
      setWrongQuestionStatus("OCR completed and analysis refreshed.");
    } catch (e) {
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
    setFlashcardIndex(p => Math.max(0, p - 1));
  };

  const handleNextFlashcard = () => {
    setFlashcardIndex(p => Math.min(wrongQuestionFlashcards.length - 1, p + 1));
  };

  const handleDeleteFlashcard = idToDelete => {
    if (!window.confirm("Delete this flashcard?")) return;
    setWrongQuestionFlashcards(prev => prev.filter(c => c.id !== idToDelete));
    setFlashcardIndex(p => (p > 0 ? p - 1 : 0));
    setWrongQuestionStatus("Deleted.");
  };

  // =========================
  // AI handlers
  // =========================
  const handleCaptureRunAI = async () => {
    if (!effectiveCaptureText.trim()) {
      setCaptureStatus("Please type notes first.");
      return;
    }

    setIsCaptureAnalyzing(true);
    setCaptureStatus("AI thinking...");

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: effectiveCaptureText, type: "capture" })
      });

      const data = await res.json();

      if (data.analysis) {
        setCaptureAiResult(data.analysis);
        setCaptureStatus("AI Analysis Complete!");
      } else {
        setCaptureStatus("AI Error: " + (data.error || "Unknown"));
      }
    } catch (e) {
      setCaptureStatus("AI Error: Network/Timeout. Please check Vercel API Key.");
    }

    setIsCaptureAnalyzing(false);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: wrongQuestionDraftText, type: "wrong_question" })
      });

      const data = await res.json();

      if (data.analysis) {
        setAiAnalysisResult(data.analysis);
        setWrongQuestionStatus("AI Analysis Complete!");
      } else {
        setWrongQuestionStatus("AI Error: " + (data.error || "Unknown"));
      }
    } catch (e) {
      setWrongQuestionStatus("AI Error: Network/Timeout. Please check Vercel API Key.");
    }

    setIsAnalyzing(false);
  };

  const scrollableStyle = {
    maxHeight: "250px",
    overflowY: "auto",
    padding: "12px",
    backgroundColor: "#f8fafc",
    borderRadius: "6px",
    border: "1px solid #e2e8f0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    marginTop: "6px"
  };

  const captureAnalysisScrollStyle = {
    maxHeight: "600px",
    overflowY: "auto",
    paddingRight: "4px"
  };

  const analysisMiniGridStyle = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    alignItems: "start"
  };

  const spanTwoStyle = {
    gridColumn: "1 / -1"
  };

  const flashcardSlideStyle = {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "18px",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "18px"
  };

  const flashcardSlideTopStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap"
  };

  const flashcardSlideBodyStyle = {
    display: "grid",
    gridTemplateColumns: "360px 1fr",
    gap: "20px",
    alignItems: "start"
  };

  const flashcardColStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "14px"
  };

  const flashcardImageStyle = {
    width: "100%",
    maxHeight: "260px",
    objectFit: "contain",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    cursor: "pointer"
  };

  const flashcardNoImageStyle = {
    width: "100%",
    height: "260px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    borderRadius: "12px",
    color: "#64748b"
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-title">ARE Study Vault</div>
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
        {/* ================= Capture Workspace ================= */}
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
              onChange={e => setCaptureDraft(e.target.value)}
              onKeyDown={handleCaptureTextareaKeyDown}
              placeholder="粘贴长笔记，本地智脑会自动生成结构化解析..."
            />
            <div className="button-row" style={{ marginTop: "12px" }}>
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
            <div style={{ color: "#10b981", marginTop: "10px" }}>{captureStatus}</div>
          </div>

          <div className="workspace-grid">
            <div className="panel capture-analysis-panel">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                <h3 style={{ margin: 0 }}>
                  Analysis{" "}
                  <span
                    style={{
                      fontSize: "12px",
                      background: captureAiResult ? "#dbeafe" : "#f1f5f9",
                      padding: "4px 8px",
                      borderRadius: "12px"
                    }}
                  >
                    {captureAiResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
                </h3>
                <button
                  onClick={handleCaptureRunAI}
                  disabled={isCaptureAnalyzing}
                  style={{
                    background: "#2563eb",
                    color: "white",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer"
                  }}
                >
                  {isCaptureAnalyzing ? "Thinking..." : "✨ Ask AI"}
                </button>
              </div>

              <div style={captureAnalysisScrollStyle}>
                <div className="subcard">
                  <div className="subcard-title">Summary</div>
                  <div style={scrollableStyle}>{captureSummary}</div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Extraction</div>
                  <div style={scrollableStyle}>
                    <ul>
                      {captureExtraction.map((item, i) => (
                        <li key={i} style={{ marginBottom: "6px" }}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Bullet Points</div>
                  <div style={scrollableStyle}>
                    <ul>
                      {captureBulletPoints.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Logic Links</div>
                  <div style={scrollableStyle}>
                    <ul>
                      {captureLogicLinks.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel live-logic-graph-panel">
              <h3 style={{ margin: 0, marginBottom: "10px" }}>
                Live Logic Image{" "}
                <span
                  style={{
                    fontSize: "12px",
                    background: captureAiResult ? "#dbeafe" : "#f1f5f9",
                    padding: "4px 8px",
                    borderRadius: "12px"
                  }}
                >
                  {captureAiResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                </span>
              </h3>

              <div
                style={{
                  maxHeight: "600px",
                  overflowY: "auto",
                  background: "#f8fafc",
                  padding: "10px",
                  borderRadius: "8px"
                }}
              >
                {captureLogicForest.length === 0 ? (
                  <div style={{ color: "#64748b" }}>输入内容生成导图...</div>
                ) : (
                  <div className="logic-forest">
                    {captureLogicForest.map((tree, i) => (
                      <div key={i} className="logic-tree-card">
                        <LogicTreeNode tree={tree} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ================= Wrong Question Workspace ================= */}
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

                <div className="button-row wrongq-button-row" style={{ marginTop: 12 }}>
                  <label className="nav-pill upload-nav-pill">
                    Upload Image
                    <input type="file" accept="image/*" onChange={handleWrongQuestionImageChange} hidden />
                  </label>

                  {wrongQuestionImagePreview && (
                    <button
                      className="nav-pill"
                      onClick={() => {
                        setWrongQuestionImageFile(null);
                        setWrongQuestionImagePreview("");
                      }}
                      style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}
                      type="button"
                    >
                      Delete Image
                    </button>
                  )}

                  <button
                    className="nav-pill nav-action-pill"
                    onClick={handleRunOcr}
                    disabled={isRunningOcr}
                    type="button"
                  >
                    {isRunningOcr ? "Running..." : "Run OCR"}
                  </button>
                </div>
              </div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Wrong Question Text</div>
                <textarea
                  className="panel-textarea wrong-question-textarea"
                  value={wrongQuestionDraftText}
                  onChange={e => setWrongQuestionDraftText(e.target.value)}
                  onKeyDown={handleWrongQuestionTextareaKeyDown}
                  placeholder="粘贴错题..."
                  style={{ minHeight: "200px" }}
                />
                <div className="button-row" style={{ marginTop: "12px" }}>
                  <button onClick={handleAnalyzeWrongQuestion}>Analyze</button>
                </div>
              </div>
            </div>

            <div className="panel wrong-question-analysis-panel">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                <h3 style={{ margin: 0 }}>
                  Analysis{" "}
                  <span
                    style={{
                      fontSize: "12px",
                      background: aiAnalysisResult ? "#dbeafe" : "#f1f5f9",
                      padding: "4px 8px",
                      borderRadius: "12px"
                    }}
                  >
                    {aiAnalysisResult ? "✨ AI Active" : "⚙️ Local Smart Engine"}
                  </span>
                </h3>
                <button
                  onClick={handleWrongQuestionRunAI}
                  disabled={isAnalyzing}
                  style={{
                    background: "#2563eb",
                    color: "white",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer"
                  }}
                >
                  {isAnalyzing ? "Thinking..." : "✨ Ask AI"}
                </button>
              </div>

              <div style={analysisMiniGridStyle}>
                <div className="subcard" style={spanTwoStyle}>
                  <div className="subcard-title">Summary</div>
                  <div style={scrollableStyle}>{wrongQuestionAnalysis.summary}</div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Correct Answer</div>
                  <div style={scrollableStyle}>
                    {Array.isArray(wrongQuestionAnalysis.correctAnswer)
                      ? wrongQuestionAnalysis.correctAnswer.join(" / ")
                      : wrongQuestionAnalysis.correctAnswer}
                  </div>
                </div>

                <div className="subcard">
                  <div className="subcard-title">Memory Hook</div>
                  <div style={scrollableStyle}>{wrongQuestionAnalysis.memoryHook}</div>
                </div>

                <div className="subcard" style={spanTwoStyle}>
                  <div className="subcard-title">Bullet Points</div>
                  <div style={scrollableStyle}>
                    <ul>
                      {wrongQuestionAnalysis.bulletPoints.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="subcard" style={spanTwoStyle}>
                  <div className="subcard-title">Answer Extraction</div>
                  <div style={scrollableStyle}>
                    <ul>
                      {wrongQuestionAnalysis.answerExtraction.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="subcard" style={spanTwoStyle}>
                  <div className="subcard-title">Trap Point</div>
                  <div style={scrollableStyle}>
                    <ul>
                      {wrongQuestionAnalysis.trapPoint.map((item, i) => (
                        <li key={i}>{item}</li>
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
            <div style={{ color: "#10b981", marginTop: "10px" }}>{wrongQuestionStatus}</div>
          </div>

          <div className="panel flashcard-panel">
            <div className="panel-title">Wrong Question Flashcards</div>

            {wrongQuestionFlashcards.length === 0 ? (
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
                  <div style={flashcardSlideStyle}>
                    <div style={flashcardSlideTopStyle}>
                      <div className="flashcard-meta">
                        {currentFlashcard.topicKey} · {formatSavedAt(currentFlashcard.savedAt)}
                      </div>

                      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                        <button
                          onClick={() => handleDeleteFlashcard(currentFlashcard.id)}
                          style={{
                            background: "#fee2e2",
                            color: "#dc2626",
                            border: "1px solid #fecaca",
                            borderRadius: "8px",
                            padding: "6px 10px",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: "bold"
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        ...flashcardSlideBodyStyle,
                        gridTemplateColumns:
                          typeof window !== "undefined" && window.innerWidth <= 1100 ? "1fr" : "360px 1fr"
                      }}
                    >
                      <div style={flashcardColStyle}>
                        {currentFlashcard.imagePreview ? (
                          <img
                            src={currentFlashcard.imagePreview}
                            alt="Wrong question"
                            style={flashcardImageStyle}
                            onClick={() => setExpandedImage(currentFlashcard.imagePreview)}
                          />
                        ) : (
                          <div style={flashcardNoImageStyle}>No image</div>
                        )}

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Wrong Question Summary</div>
                          <p style={{ margin: 0, lineHeight: 1.6 }}>{currentFlashcard.summary}</p>
                        </div>
                      </div>

                      <div style={flashcardColStyle}>
                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Correct Answer</div>
                          {Array.isArray(currentFlashcard.correctAnswer) ? (
                            <p style={{ margin: 0, lineHeight: 1.6 }}>
                              {currentFlashcard.correctAnswer.join(" / ")}
                            </p>
                          ) : (
                            <p style={{ margin: 0, lineHeight: 1.6 }}>{currentFlashcard.correctAnswer}</p>
                          )}
                        </div>

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Bullet Points</div>
                          <ul style={{ margin: 0, paddingLeft: "18px" }}>
                            {(currentFlashcard.bulletPoints || []).map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Memory Hook</div>
                          <p style={{ margin: 0, lineHeight: 1.6 }}>{currentFlashcard.memoryHook}</p>
                        </div>

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Trap Point</div>
                          <ul style={{ margin: 0, paddingLeft: "18px" }}>
                            {(currentFlashcard.trapPoint || []).map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="subcard compact-subcard">
                          <div className="subcard-title">Answer Extraction</div>
                          <ul style={{ margin: 0, paddingLeft: "18px" }}>
                            {(currentFlashcard.answerExtraction || []).map((item, i) => (
                              <li key={i}>{item}</li>
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
          <div className="image-modal-content" onClick={e => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setExpandedImage("")}>
              ×
            </button>
            <img src={expandedImage} alt="Expanded" className="image-modal-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
