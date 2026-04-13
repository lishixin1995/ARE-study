import { useEffect, useMemo, useState } from "react";
import Tesseract from "tesseract.js";
import "./App.css";

// --- 常量配置 ---
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

// --- 基础工具函数 ---
function splitSentences(text) {
  return (text || "").replace(/\r/g, "").replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
}
function splitLines(text) {
  return (text || "").replace(/\r/g, "").split("\n").map((item) => item.trim()).filter(Boolean);
}
function capitalizeWords(text) {
  return (text || "").split(" ").map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(" ");
}
function formatSavedAt(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString()}`;
}

// --- Capture 笔记分析逻辑 (保留原有牛逼功能) ---
function buildCaptureSummary(text) {
  const sentences = splitSentences(text);
  if (sentences.length >= 2) return `${sentences[0]} ${sentences[1]}`;
  if (sentences.length === 1) return sentences[0];
  return "No notes yet for this topic.";
}
function buildCaptureExtraction(text) {
  const lines = splitLines(text);
  if (lines.length >= 4) return lines.slice(0, 4);
  const sentences = splitSentences(text);
  if (sentences.length >= 4) return sentences.slice(0, 4);
  if (lines.length > 0) return lines;
  return ["Start typing or save notes in this topic to generate extraction."];
}
function buildCaptureBulletPoints(text) {
  const lower = (text || "").toLowerCase();
  const points = [];
  if (lower.includes("active system")) points.push("Active systems usually depend on equipment and direct control.");
  if (lower.includes("passive system")) points.push("Passive systems usually depend on climate, orientation, air, or sun.");
  if (lower.includes("cold climate") || lower.includes("heat loss")) points.push("Cold-climate strategies often start with reducing heat loss.");
  if (lower.includes("hot climate") || lower.includes("heat gain")) points.push("Hot-climate strategies often focus on controlling heat gain and ventilation.");
  if (lower.includes("trombe wall")) points.push("Trombe wall is a passive thermal strategy and needs space.");
  if (lower.includes("envelope")) points.push("Envelope design must coordinate water, air, vapor, and thermal control.");
  if (lower.includes("documentation")) points.push("Documentation should coordinate dimensions, assemblies, and specifications clearly.");
  if (points.length) return points;
  return buildCaptureExtraction(text).slice(0, 3);
}
function buildCaptureLogicLinks(text) {
  const lower = (text || "").toLowerCase();
  const links = [];
  if (lower.includes("passive system") || lower.includes("sun") || lower.includes("air") || lower.includes("wind")) links.push("Passive System → depends on → Sun / Air / Wind");
  if (lower.includes("active system") || lower.includes("mechanical equipment")) links.push("Active System → relies on → Mechanical Equipment");
  if (lower.includes("cold climate") || lower.includes("heat loss")) links.push("Cold Climate → goal → Reduce Heat Loss");
  if (lower.includes("hot climate") || lower.includes("heat gain")) links.push("Hot Climate → goal → Control Heat Gain");
  if (lower.includes("cold climate") && lower.includes("hot climate")) links.push("Cold Climate ↔ contrasts with ↔ Hot Climate");
  if (lower.includes("trombe wall")) links.push("Trombe Wall → example of → Passive Strategy");
  if (lower.includes("envelope detailing")) links.push("Envelope Detailing → controls → Water / Air / Vapor / Thermal Transfer");
  if (lower.includes("material selection")) links.push("Material Selection → affects → Durability / Constructability / Maintenance");
  if (lower.includes("documentation")) links.push("Documentation → coordinates → Assemblies / Dimensions / Specifications");
  if (!links.length) links.push("Start typing or save notes to generate logic links.");
  return links;
}
function node(label, relation = null, children = []) { return { label, relation, children }; }
function buildCaptureLogicForest(text) {
  const lower = (text || "").toLowerCase();
  const trees = [];
  const systemsChildren = [];

  if (lower.includes("active system") || lower.includes("mechanical equipment")) {
    const activeChildren = [];
    if (lower.includes("mechanical equipment")) activeChildren.push(node("Mechanical Equipment", "relies on"));
    if (lower.includes("more energy") || lower.includes("energy")) activeChildren.push(node("Higher Energy Use", "effect"));
    systemsChildren.push(node("Active System", "category", activeChildren));
  }
  if (lower.includes("passive system") || lower.includes("sun") || lower.includes("air") || lower.includes("wind")) {
    const passiveChildren = [];
    if (lower.includes("sun")) passiveChildren.push(node("Sun", "depends on"));
    if (lower.includes("air")) passiveChildren.push(node("Air", "depends on"));
    if (lower.includes("wind")) passiveChildren.push(node("Wind", "depends on"));
    systemsChildren.push(node("Passive System", "category", passiveChildren));
  }
  if (systemsChildren.length) trees.push(node("Building Systems", null, systemsChildren));

  const climateChildren = [];
  if (lower.includes("cold climate") || lower.includes("heat loss") || lower.includes("solar heat")) {
    const coldChildren = [];
    if (lower.includes("heat loss")) coldChildren.push(node("Reduce Heat Loss", "goal"));
    if (lower.includes("solar heat")) coldChildren.push(node("Gain Solar Heat", "goal"));
    climateChildren.push(node("Cold Climate", "category", coldChildren));
  }
  if (lower.includes("hot climate") || lower.includes("heat gain") || lower.includes("ventilation")) {
    const hotChildren = [];
    if (lower.includes("heat gain")) hotChildren.push(node("Control Heat Gain", "goal"));
    if (lower.includes("ventilation")) hotChildren.push(node("Natural Ventilation", "strategy"));
    climateChildren.push(node("Hot Climate", "category", hotChildren));
  }
  if (climateChildren.length) trees.push(node("Climate Strategy", null, climateChildren));

  const envelopeChildren = [];
  if (lower.includes("envelope detailing")) {
    const detailChildren = [];
    if (lower.includes("water")) detailChildren.push(node("Water", "controls"));
    if (lower.includes("air")) detailChildren.push(node("Air", "controls"));
    if (lower.includes("vapor")) detailChildren.push(node("Vapor", "controls"));
    if (lower.includes("thermal transfer")) detailChildren.push(node("Thermal Transfer", "controls"));
    envelopeChildren.push(node("Envelope Detailing", "category", detailChildren));
  }
  if (envelopeChildren.length) trees.push(node("Envelope / Documentation", null, envelopeChildren));

  if (!trees.length) {
    const fallbackLines = buildCaptureExtraction(text).slice(0, 3);
    trees.push(node("Key Concepts", null, fallbackLines.map((line) => node(line, "note"))));
  }
  return trees;
}

// =========================================================================
// 🚀 全新升级版：最强错题智能解析引擎 (融合了你之前的格式，加强了抗错)
// =========================================================================

// 提取带标签的文字
const extractLabeledContent = (text, label) => {
  const regex = new RegExp(`(?:${label})[\\s]*(?:[:：]|)[\\s]*([\\s\\S]*?)(?=(?:\\n(?:Question|Correct Answer|Summary|Trap Point|Memory Hook|Extraction)[\\s]*(?:[:：]|))|\\n(?:☑|✔|☐|❌|\\[x\\]|\\[ \\])?\\s*(?:Correct|Incorrect)\\b|$)`, 'i');
  const match = (text || "").match(regex);
  return match ? match[1].trim() : null;
};

function buildWrongQuestionAnalysis(text) {
  if (!text) return { questionText: "Waiting for text...", summary: "No content.", correctAnswer: "Not detected.", answerExtraction: ["Not detected."], trapPoint: ["Not detected."], memoryHook: "Not detected." };

  const allLines = splitLines(text);
  
  // 1. 抓题目
  let questionText = extractLabeledContent(text, "Question|Q");
  if (!questionText && allLines.length > 0) {
    questionText = allLines.find(l => !/^(correct|incorrect|extraction|trap|memory|summary)/i.test(l)) || "No question detected.";
  }

  // 2. 抓答案
  const correctAnswer = extractLabeledContent(text, "Correct Answer|Answer") || "Check analysis below";

  // 3. 智能抓知识点 (优先找 Extraction 标签，找不到就找 Correct. 开头的行)
  let answerExtraction = extractLabeledContent(text, "Extraction|Answer Extraction");
  answerExtraction = answerExtraction ? splitLines(answerExtraction) : [];
  if (answerExtraction.length === 0) {
    const correctRegex = /^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i;
    answerExtraction = allLines.filter(l => correctRegex.test(l.trim())).map(l => l.replace(correctRegex, '').trim());
  }
  if (answerExtraction.length === 0) answerExtraction = ["Not detected. (Auto-detects 'Correct.' lines)"];

  // 4. 智能抓陷阱 (优先找 Trap Point 标签，找不到就找 Incorrect. 开头的行)
  let trapPoint = extractLabeledContent(text, "Trap Point|Trap");
  trapPoint = trapPoint ? splitLines(trapPoint) : [];
  if (trapPoint.length === 0) {
    const incorrectRegex = /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i;
    trapPoint = allLines.filter(l => incorrectRegex.test(l.trim())).map(l => l.replace(incorrectRegex, '').trim());
  }
  if (trapPoint.length === 0) trapPoint = ["Not detected. (Auto-detects 'Incorrect.' lines)"];

  // 5. 其他
  const memoryHook = extractLabeledContent(text, "Memory Hook|Hook") || "Not detected.";
  const summary = buildCaptureSummary(text);

  return { questionText, summary, correctAnswer, answerExtraction, trapPoint, memoryHook };
}

// --- UI 组件 ---
function LogicTreeNode({ tree, depth = 0 }) {
  return (
    <div className={`logic-tree-level depth-${depth}`}>
      <div className="logic-tree-row">
        {tree.relation ? <span className={`logic-relation-pill relation-${tree.relation.replace(/\s+/g, "-")}`}>{capitalizeWords(tree.relation)}</span> : null}
        <div className={`logic-node-card ${depth === 0 ? "root" : ""}`}>{tree.label}</div>
      </div>
      {tree.children?.length ? (
        <div className="logic-children">
          {tree.children.map((child, index) => <LogicTreeNode key={`${child.label}-${index}`} tree={child} depth={depth + 1} />)}
        </div>
      ) : null}
    </div>
  );
}

// =========================================================================
// 🎯 主组件入口
// =========================================================================

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [selectedRoom, setSelectedRoom] = useState("Site");

  const [captureDraft, setCaptureDraft] = useState("");
  const [debouncedCaptureDraft, setDebouncedCaptureDraft] = useState("");
  const [captureStatus, setCaptureStatus] = useState("Connecting to Cloud...");

  // 错题区专属状态
  const [wrongQuestionImageFile, setWrongQuestionImageFile] = useState(null);
  const [wrongQuestionImagePreview, setWrongQuestionImagePreview] = useState("");
  const [wrongQuestionOcrText, setWrongQuestionOcrText] = useState("");
  const [wrongQuestionDraftText, setWrongQuestionDraftText] = useState("");
  const [wrongQuestionStatus, setWrongQuestionStatus] = useState("Connecting to Cloud...");
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [expandedImage, setExpandedImage] = useState("");

  // 云同步状态
  const [savedNotesByTopic, setSavedNotesByTopic] = useState({});
  const [wrongQuestionFlashcards, setWrongQuestionFlashcards] = useState([]);
  const [isCloudLoaded, setIsCloudLoaded] = useState(false);

  // 1. 加载云端数据
  useEffect(() => {
    fetch('/api/sync')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (item.key === 'savedNotesByTopic') setSavedNotesByTopic(item.value || {});
            if (item.key === 'wrongQuestionFlashcards') setWrongQuestionFlashcards(item.value || []);
          });
        }
        setIsCloudLoaded(true);
        setCaptureStatus("Cloud Synced ✅");
        setWrongQuestionStatus("Cloud Synced ✅");
      })
      .catch(err => {
        console.error("Cloud sync failed:", err);
        setCaptureStatus("Offline Mode ⚠️");
        setWrongQuestionStatus("Offline Mode ⚠️");
        setIsCloudLoaded(true); 
      });
  }, []);

  // 2. 自动保存笔记
  useEffect(() => {
    if (!isCloudLoaded) return;
    fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'savedNotesByTopic', value: savedNotesByTopic }) });
  }, [savedNotesByTopic, isCloudLoaded]);

  // 3. 自动保存错题卡
  useEffect(() => {
    if (!isCloudLoaded) return;
    fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'wrongQuestionFlashcards', value: wrongQuestionFlashcards }) });
  }, [wrongQuestionFlashcards, isCloudLoaded]);

  const currentTopicKey = useMemo(() => `${selectedDivision}::${selectedRoom}`, [selectedDivision, selectedRoom]);
  const rooms = ROOMS_BY_DIVISION[selectedDivision] || [];
  const savedNotesForTopic = useMemo(() => savedNotesByTopic[currentTopicKey] || [], [savedNotesByTopic, currentTopicKey]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCaptureDraft(captureDraft), 1200);
    return () => clearTimeout(timer);
  }, [captureDraft]);

  useEffect(() => {
    if (flashcardIndex > wrongQuestionFlashcards.length - 1) setFlashcardIndex(Math.max(0, wrongQuestionFlashcards.length - 1));
  }, [wrongQuestionFlashcards, flashcardIndex]);

  const effectiveCaptureText = useMemo(() => {
    const saved = savedNotesForTopic.map(item => item.text).join("\n\n").trim();
    const draft = debouncedCaptureDraft.trim();
    return saved && draft ? `${saved}\n\n${draft}` : saved || draft || "";
  }, [savedNotesForTopic, debouncedCaptureDraft]);

  const captureSummary = useMemo(() => buildCaptureSummary(effectiveCaptureText), [effectiveCaptureText]);
  const captureExtraction = useMemo(() => buildCaptureExtraction(effectiveCaptureText), [effectiveCaptureText]);
  const captureBulletPoints = useMemo(() => buildCaptureBulletPoints(effectiveCaptureText), [effectiveCaptureText]);
  const captureLogicLinks = useMemo(() => buildCaptureLogicLinks(effectiveCaptureText), [effectiveCaptureText]);
  const captureLogicForest = useMemo(() => buildCaptureLogicForest(effectiveCaptureText), [effectiveCaptureText]);
  
  // ⚡️ 触发最强解析引擎
  const wrongQuestionAnalysis = useMemo(() => buildWrongQuestionAnalysis(wrongQuestionDraftText), [wrongQuestionDraftText]);

  const currentFlashcard = wrongQuestionFlashcards[flashcardIndex] || null;

  // --- 各种处理函数 ---
  const handleSaveNote = () => {
    const trimmed = captureDraft.trim();
    if (!trimmed) { setCaptureStatus("Capture editor is empty."); return; }
    const newNote = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: trimmed, savedAt: new Date().toISOString() };
    setSavedNotesByTopic((prev) => ({ ...prev, [currentTopicKey]: [...(prev[currentTopicKey] || []), newNote] }));
    setCaptureDraft(""); setDebouncedCaptureDraft(""); setCaptureStatus(`Saved to Cloud ✅`);
  };

  const handleWrongQuestionImageChange = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setWrongQuestionImageFile(null); setWrongQuestionImagePreview(""); setWrongQuestionStatus("No image selected."); return;
    }
    setWrongQuestionImageFile(file);
    setWrongQuestionStatus(`Selected image: ${file.name}`);
    const reader = new FileReader();
    reader.onloadend = () => setWrongQuestionImagePreview(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  };

  const handleRunOcr = async () => {
    if (!wrongQuestionImageFile) { setWrongQuestionStatus("Please select an image first."); return; }
    try {
      setIsRunningOcr(true); setWrongQuestionStatus("Running OCR... (Reading Image)");
      const result = await Tesseract.recognize(wrongQuestionImageFile, "eng");
      const extractedText = result?.data?.text?.trim() || "";
      if (!extractedText) { setWrongQuestionStatus("No text detected."); return; }
      setWrongQuestionOcrText(extractedText);
      setWrongQuestionDraftText(extractedText);
      setWrongQuestionStatus("OCR completed. Auto-parsing logic applied!");
    } catch (error) {
      console.error(error); setWrongQuestionStatus("OCR failed.");
    } finally { setIsRunningOcr(false); }
  };

  const handleSaveWrongQuestion = () => {
    const trimmed = wrongQuestionDraftText.trim();
    if (!trimmed) { setWrongQuestionStatus("Text is empty."); return; }
    const newCard = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      topicKey: currentTopicKey,
      imagePreview: wrongQuestionImagePreview,
      ocrText: wrongQuestionOcrText,
      editedText: trimmed,
      ...wrongQuestionAnalysis,
      savedAt: new Date().toISOString()
    };
    setWrongQuestionFlashcards((prev) => [newCard, ...prev]);
    setFlashcardIndex(0);
    setWrongQuestionStatus("Flashcard Saved to Cloud ✅");
  };

  return (
    <div className="app-shell">
      {/* 侧边栏完美回归 */}
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-title">ARE Study Vault</div>
          <div className="brand-subtitle">Cloud Sync Enabled ☁️</div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-label">Memory Palace</div>
          <div className="division-list">
            {DIVISIONS.map((div) => (
              <button key={div} className={`nav-pill ${selectedDivision === div ? "active" : ""}`} onClick={() => { setSelectedDivision(div); setSelectedRoom(ROOMS_BY_DIVISION[div][0]); }}>{div}</button>
            ))}
          </div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-label">{selectedDivision} Rooms</div>
          <div className="room-list">
            {rooms.map((room) => (
              <button key={room} className={`room-pill ${selectedRoom === room ? "active" : ""}`} onClick={() => setSelectedRoom(room)}>{room}</button>
            ))}
          </div>
        </div>
      </aside>

      <main className="main-workspace">
        
        {/* 笔记捕获区回归 */}
        <section className="workspace-card capture-workspace">
          <div className="workspace-header">
            <h2>Capture Notes Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span><span>{selectedRoom}</span><span>Cloud Notes: {savedNotesForTopic.length}</span>
            </div>
          </div>
          <div className="panel capture-editor-panel">
            <div className="panel-title">Capture Editor</div>
            <textarea className="panel-textarea" value={captureDraft} onChange={(e) => setCaptureDraft(e.target.value)} placeholder="Type notes here..." />
          </div>
          <div className="panel capture-controls">
            <div className="button-row">
              <button onClick={handleSaveNote}>Save Note</button>
              <button onClick={() => { setCaptureDraft(""); setDebouncedCaptureDraft(""); }}>Clear</button>
            </div>
            <div style={{ marginTop: 12, color: '#10b981', fontWeight: 600 }}>{captureStatus}</div>
          </div>
          <div className="workspace-grid">
            <div className="panel capture-analysis-panel">
              <div className="panel-title">Logic Extraction</div>
              <div className="subcard compact-subcard">
                <div className="subcard-title">Bullet Points</div>
                <ul>{captureBulletPoints.map((item, index) => <li key={index}>{item}</li>)}</ul>
              </div>
            </div>
            <div className="panel live-logic-graph-panel">
              <div className="panel-title">Live Logic Forest</div>
              {captureLogicForest.length === 0 ? <div className="logic-graph-placeholder">Start typing...</div> : (
                <div className="logic-forest">{captureLogicForest.map((tree, index) => <div key={index} className="logic-tree-card"><LogicTreeNode tree={tree} /></div>)}</div>
              )}
            </div>
          </div>
        </section>

        {/* 错题区：融合了旧的 UI 和最强的新脑子 */}
        <section className="workspace-card wrong-question-workspace">
          <div className="workspace-header">
            <h2>Wrong Question Workspace 🚀 (Smart OCR Edition)</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span><span>{selectedRoom}</span><span>Flashcards: {wrongQuestionFlashcards.length}</span>
            </div>
          </div>

          <div className="workspace-grid">
            {/* 左侧：输入与上传 */}
            <div className="panel wrong-question-input-panel">
              <div className="panel-title">Input & OCR</div>
              <div className="subcard compact-subcard">
                {wrongQuestionImagePreview ? <img src={wrongQuestionImagePreview} alt="Preview" className="image-preview" /> : <div className="image-placeholder">Upload Image</div>}
                <div className="button-row" style={{ marginTop: 12 }}>
                  <label className="nav-pill upload-nav-pill">Upload <input type="file" accept="image/*" onChange={handleWrongQuestionImageChange} hidden /></label>
                  <button className="nav-pill nav-action-pill" onClick={handleRunOcr} disabled={isRunningOcr}>{isRunningOcr ? "Running..." : "Run OCR"}</button>
                </div>
              </div>
              <div className="subcard compact-subcard">
                <div className="subcard-title">Extracted Text (Edit here)</div>
                <textarea 
                  className="panel-textarea wrong-question-textarea" 
                  value={wrongQuestionDraftText} 
                  onChange={(e) => setWrongQuestionDraftText(e.target.value)} 
                  placeholder="Run OCR or paste text. Code auto-detects 'Correct.' and 'Incorrect.' lines!"
                />
              </div>
            </div>

            {/* 右侧：实时智能解析预览 */}
            <div className="panel wrong-question-analysis-panel" style={{ border: '2px solid #3b82f6', backgroundColor: '#eff6ff' }}>
              <div className="panel-title" style={{ color: '#1d4ed8' }}>Live Analysis Preview 🧠</div>
              <div className="analysis-mini-grid">
                
                <div className="subcard compact-subcard analysis-span-2">
                  <div className="subcard-title" style={{color: '#1e40af'}}>Question Detected</div>
                  <p style={{fontWeight: 600}}>{wrongQuestionAnalysis.questionText}</p>
                </div>
                
                <div className="subcard compact-subcard analysis-span-2" style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
                  <div className="subcard-title" style={{color: '#166534'}}>Correct Logic (Knowledge) ✅</div>
                  <ul style={{ color: '#14532d' }}>{wrongQuestionAnalysis.answerExtraction.map((item, i) => <li key={i}>{item}</li>)}</ul>
                </div>

                <div className="subcard compact-subcard analysis-span-2" style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca' }}>
                  <div className="subcard-title" style={{color: '#991b1b'}}>Trap Points (Incorrect Logic) ⚠️</div>
                  <ul style={{ color: '#7f1d1d' }}>{wrongQuestionAnalysis.trapPoint.map((item, i) => <li key={i}>{item}</li>)}</ul>
                </div>

              </div>
            </div>
          </div>

          <div className="panel wrong-question-controls">
            <div className="button-row">
              <button onClick={handleSaveWrongQuestion}>Save Flashcard to Cloud</button>
              <button onClick={() => { setWrongQuestionDraftText(""); setWrongQuestionImagePreview(""); }}>Clear Workspace</button>
            </div>
            <div style={{ marginTop: 12, color: '#2563eb', fontWeight: 600 }}>{wrongQuestionStatus}</div>
          </div>

          {/* Flashcard 展示区 */}
          <div className="panel flashcard-panel">
            <div className="panel-title">Saved Cloud Flashcards</div>
            {wrongQuestionFlashcards.length === 0 ? <div className="flashcard-placeholder">No flashcards yet.</div> : (
              <div className="flashcard-carousel">
                <div className="flashcard-carousel-header">
                  <button onClick={() => setFlashcardIndex(p => Math.max(0, p - 1))} disabled={flashcardIndex === 0}>← Prev</button>
                  <div className="flashcard-counter">{flashcardIndex + 1} / {wrongQuestionFlashcards.length}</div>
                  <button onClick={() => setFlashcardIndex(p => Math.min(wrongQuestionFlashcards.length - 1, p + 1))} disabled={flashcardIndex === wrongQuestionFlashcards.length - 1}>Next →</button>
                </div>
                {currentFlashcard && (
                  <div className="flashcard-slide">
                     <div className="flashcard-slide-top">
                      <div className="flashcard-meta">{currentFlashcard.topicKey} · {formatSavedAt(currentFlashcard.savedAt)}</div>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        {currentFlashcard.imagePreview && (
                          <div className="flashcard-thumb-wrap">
                            <img src={currentFlashcard.imagePreview} className="flashcard-thumb" onClick={() => setExpandedImage(currentFlashcard.imagePreview)} alt="thumb" />
                          </div>
                        )}
                        <button onClick={() => {
                          if(window.confirm("Delete?")) {
                            const updated = wrongQuestionFlashcards.filter(c => c.id !== currentFlashcard.id);
                            setWrongQuestionFlashcards(updated);
                            fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'wrongQuestionFlashcards', value: updated }) });
                          }
                        }} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', padding: '0 10px' }}>Delete</button>
                      </div>
                    </div>
                    <div className="flashcard-question"><div className="subcard-title">Question</div><p>{currentFlashcard.questionText}</p></div>
                    <div className="flashcard-detail-grid">
                      <div className="subcard compact-subcard analysis-span-2" style={{ backgroundColor: '#f0fdf4' }}>
                        <div className="subcard-title">Correct Logic</div>
                        <ul>{currentFlashcard.answerExtraction.map((item, i) => <li key={i}>{item}</li>)}</ul>
                      </div>
                      <div className="subcard compact-subcard analysis-span-2" style={{ backgroundColor: '#fef2f2' }}>
                        <div className="subcard-title">Trap Point</div>
                        <ul>{currentFlashcard.trapPoint.map((item, i) => <li key={i}>{item}</li>)}</ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

      </main>

      {expandedImage && (
        <div className="image-modal-backdrop" onClick={() => setExpandedImage("")}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setExpandedImage("")}>×</button>
            <img src={expandedImage} alt="Expanded" className="image-modal-img" />
          </div>
        </div>
      )}
    </div>
  );
}
