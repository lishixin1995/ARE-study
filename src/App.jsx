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
// ⚙️ 本地简单引擎 (负责免费兜底)
// ==========================================
function splitSentences(text) { return (text || "").replace(/\r/g, "").replace(/\n+/g, " ").split(/(?<=[.!?。！？])\s+/).map(item => item.trim()).filter(Boolean); }
function splitLines(text) { return (text || "").replace(/\r/g, "").split("\n").map(item => item.trim()).filter(Boolean); }
function capitalizeWords(text) { return (text || "").split(" ").map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(" "); }

function buildCaptureSummary(text) {
  if (!text) return "等待输入...";
  const sentences = splitSentences(text);
  return sentences.length >= 2 ? `${sentences[0]} ${sentences[1]}` : sentences[0];
}

function buildCaptureExtraction(text) {
  if (!text) return ["等待输入以提取核心知识点..."];
  const lines = splitLines(text);
  if (lines.length > 2) return lines; 
  return splitSentences(text); 
}

function buildCaptureBulletPoints(text) {
  if (!text) return ["等待输入..."];
  const sentences = splitSentences(text);
  const points = sentences.filter(s => s.match(/system|climate|heat|solar|control|reduce|ventilation|系统|气候|热|太阳|控制/i));
  return points.length > 0 ? points : sentences; 
}

function buildCaptureLogicLinks(text) {
  if (!text) return ["等待输入以生成逻辑链..."];
  const links = [];
  const lower = text.toLowerCase();
  if (lower.includes("passive")) links.push("Passive System ➔ depends on ➔ Climate / Sun / Air");
  if (lower.includes("active")) links.push("Active System ➔ relies on ➔ Mechanical Equipment");
  if (lower.includes("cold")) links.push("Cold Climate ➔ goal ➔ Reduce Heat Loss & Gain Solar");
  if (lower.includes("hot")) links.push("Hot Climate ➔ goal ➔ Control Heat Gain & Ventilation");
  if (links.length === 0) {
    const sentences = splitSentences(text);
    if (sentences.length > 1) links.push(`${sentences[0].substring(0, 20)}... ➔ ${sentences[1].substring(0, 20)}...`);
  }
  return links.length > 0 ? links : ["无法自动提取逻辑，请点击 Ask AI。"];
}

function node(label, relation = null, children = []) { return { label, relation, children }; }
function buildCaptureLogicForest(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const trees = [];
  const systemsChildren = [];
  if (lower.includes("active") || lower.includes("mechanical")) {
    systemsChildren.push(node("Active System", "category", [node("Mechanical Equipment", "relies on"), node("Higher Energy Use", "effect")]));
  }
  if (lower.includes("passive") || lower.includes("sun") || lower.includes("air")) {
    systemsChildren.push(node("Passive System", "category", [node("Sun", "depends on"), node("Air / Wind", "depends on")]));
  }
  if (systemsChildren.length) trees.push(node("Building Systems", null, systemsChildren));

  const climateChildren = [];
  if (lower.includes("cold") || lower.includes("heat loss")) {
    climateChildren.push(node("Cold Climate", "category", [node("Reduce Heat Loss", "goal"), node("Gain Solar Heat", "goal")]));
  }
  if (lower.includes("hot") || lower.includes("heat gain")) {
    climateChildren.push(node("Hot Climate", "category", [node("Control Heat Gain", "goal"), node("Natural Ventilation", "strategy")]));
  }
  if (climateChildren.length) trees.push(node("Climate Strategy", null, climateChildren));

  if (!trees.length) {
    const sentences = splitSentences(text).slice(0, 4);
    trees.push(node("Key Concepts", null, sentences.map(s => node(s.substring(0,30)+"...", "note"))));
  }
  return trees;
}

function buildWrongQuestionQuestionText(text) {
  const lines = splitLines(text);
  const questionLines = [];
  for (let line of lines) {
    if (/^(?:☑|✔|☐|❌|\[x\]|\[ \])?\s*(?:Correct|Incorrect)[\.\s:-]+/i.test(line) || /^correct answer/i.test(line)) break;
    questionLines.push(line);
  }
  return questionLines.length ? questionLines.slice(0, 6).join(" ") : "No question text yet.";
}
function buildWrongQuestionSummary(text) { return text ? buildCaptureSummary(text) : "等待输入..."; }
function buildWrongQuestionCorrectAnswer(text) { return "等待输入或使用 AI 解析..."; }
function buildWrongQuestionAnswerExtraction(text) {
  const correctLines = splitLines(text).filter(l => /^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i.test(l.trim()));
  return correctLines.length > 0 ? correctLines.map(l => l.replace(/^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i, '').trim()) : ["未检测到 Correct 关键词，请点击 Ask AI。"];
}
function buildWrongQuestionTrapPoint(text) {
  const incorrectLines = splitLines(text).filter(l => /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i.test(l.trim()));
  return incorrectLines.length > 0 ? incorrectLines.map(l => l.replace(/^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i, '').trim()) : ["未检测到 Incorrect 关键词，请点击 Ask AI。"];
}

function LogicTreeNode({ tree, depth = 0 }) {
  return (
    <div className={`logic-tree-level depth-${depth}`}>
      <div className="logic-tree-row">
        {tree.relation && <span className={`logic-relation-pill relation-${tree.relation.replace(/\s+/g, "-")}`}>{capitalizeWords(tree.relation)}</span>}
        <div className={`logic-node-card ${depth === 0 ? "root" : ""}`}>{tree.label}</div>
      </div>
      {tree.children?.length ? <div className="logic-children">{tree.children.map((child, i) => <LogicTreeNode key={i} tree={child} depth={depth + 1} />)}</div> : null}
    </div>
  );
}

function readSavedNotesByTopic() { try { const raw = localStorage.getItem("savedNotesByTopic"); return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
function readWrongQuestionFlashcards() { try { const raw = localStorage.getItem("wrongQuestionFlashcards"); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function formatSavedAt(dateString) { if (!dateString) return ""; const d = new Date(dateString); return Number.isNaN(d.getTime()) ? dateString : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString()}`; }

// ==========================================
// 🎯 主组件入口
// ==========================================
export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [selectedRoom, setSelectedRoom] = useState("Site");

  const [captureDraft, setCaptureDraft] = useState("");
  const [debouncedCaptureDraft, setDebouncedCaptureDraft] = useState("");
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
  const savedNotesForTopic = useMemo(() => savedNotesByTopic[currentTopicKey] || [], [savedNotesByTopic, currentTopicKey]);

  useEffect(() => { const timer = setTimeout(() => setDebouncedCaptureDraft(captureDraft), 800); return () => clearTimeout(timer); }, [captureDraft]);
  useEffect(() => { setCaptureAiResult(null); }, [debouncedCaptureDraft]);
  useEffect(() => { setAiAnalysisResult(null); }, [wrongQuestionDraftText]);
  useEffect(() => { localStorage.setItem("savedNotesByTopic", JSON.stringify(savedNotesByTopic)); }, [savedNotesByTopic]);
  useEffect(() => { localStorage.setItem("wrongQuestionFlashcards", JSON.stringify(wrongQuestionFlashcards)); }, [wrongQuestionFlashcards]);
  useEffect(() => { if (flashcardIndex > wrongQuestionFlashcards.length - 1) setFlashcardIndex(Math.max(0, wrongQuestionFlashcards.length - 1)); }, [wrongQuestionFlashcards, flashcardIndex]);

  const savedTopicText = useMemo(() => savedNotesForTopic.map(item => item.text).join("\n\n").trim(), [savedNotesForTopic]);
  const effectiveCaptureText = useMemo(() => {
    const draft = debouncedCaptureDraft.trim();
    return savedTopicText && draft ? `${savedTopicText}\n\n${draft}` : savedTopicText || draft || "";
  }, [savedTopicText, debouncedCaptureDraft]);

  const captureSummary = useMemo(() => captureAiResult?.summary || buildCaptureSummary(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);
  const captureExtraction = useMemo(() => captureAiResult?.extraction || buildCaptureExtraction(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);
  const captureBulletPoints = useMemo(() => captureAiResult?.bulletPoints || buildCaptureBulletPoints(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);
  const captureLogicLinks = useMemo(() => captureAiResult?.logicLinks || buildCaptureLogicLinks(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);
  const captureLogicForest = useMemo(() => captureAiResult?.logicForest || buildCaptureLogicForest(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);

  const wrongQuestionAnalysis = useMemo(() => aiAnalysisResult || {
    questionText: buildWrongQuestionQuestionText(wrongQuestionDraftText),
    summary: buildWrongQuestionSummary(wrongQuestionDraftText),
    correctAnswer: buildWrongQuestionCorrectAnswer(wrongQuestionDraftText),
    answerExtraction: buildWrongQuestionAnswerExtraction(wrongQuestionDraftText),
    trapPoint: buildWrongQuestionTrapPoint(wrongQuestionDraftText),
    memoryHook: "Local Active"
  }, [wrongQuestionDraftText, aiAnalysisResult]);

  const currentFlashcard = wrongQuestionFlashcards[flashcardIndex] || null;

  // --- Capture Action Handlers ---
  const handleSaveNote = () => {
    if (!captureDraft.trim()) { setCaptureStatus("Editor is empty."); return; }
    const newNote = { id: Date.now(), text: captureDraft.trim(), savedAt: new Date().toISOString() };
    setSavedNotesByTopic(prev => ({ ...prev, [currentTopicKey]: [...(prev[currentTopicKey] || []), newNote] }));
    setCaptureDraft(""); setCaptureStatus("Saved locally.");
  };

  const handleLoadSavedNotes = () => {
    if (!savedNotesForTopic.length) { setCaptureStatus(`No notes found for ${currentTopicKey}.`); return; }
    setCaptureStatus(`${currentTopicKey} loaded ${savedNotesForTopic.length} notes.`);
  };

  const handleLoadTopicSample = () => {
    setCaptureDraft(SAMPLE_BY_DIVISION[selectedDivision] || "");
    setCaptureStatus(`Loaded ${selectedDivision} sample.`);
  };

  const handleClearEditor = () => { setCaptureDraft(""); setCaptureStatus("Editor cleared."); };

  // --- Wrong Question Action Handlers ---
  const handleWrongQuestionImageChange = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) { setWrongQuestionImageFile(null); setWrongQuestionImagePreview(""); setWrongQuestionStatus("No image selected."); return; }
    setWrongQuestionImageFile(file); setWrongQuestionStatus(`Selected: ${file.name}`);
    const reader = new FileReader();
    reader.onloadend = () => { setWrongQuestionImagePreview(typeof reader.result === "string" ? reader.result : ""); };
    reader.readAsDataURL(file);
  };

  const handleRunOcr = async () => {
    if (!wrongQuestionImageFile) return setWrongQuestionStatus("Please select an image first.");
    try {
      setIsRunningOcr(true); setWrongQuestionStatus("Reading image...");
      const result = await Tesseract.recognize(wrongQuestionImageFile, "eng");
      if (!result?.data?.text?.trim()) return setWrongQuestionStatus("No text detected.");
      setWrongQuestionOcrText(result.data.text.trim()); setWrongQuestionDraftText(result.data.text.trim());
      setWrongQuestionStatus("OCR completed.");
    } catch (e) { setWrongQuestionStatus("OCR failed."); } finally { setIsRunningOcr(false); }
  };

  const handleSaveWrongQuestion = () => {
    if (!wrongQuestionDraftText.trim()) return setWrongQuestionStatus("Text is empty.");
    const newCard = {
      id: Date.now(), topicKey: currentTopicKey, imagePreview: wrongQuestionImagePreview,
      ocrText: wrongQuestionOcrText, editedText: wrongQuestionDraftText.trim(), ...wrongQuestionAnalysis,
      savedAt: new Date().toISOString()
    };
    setWrongQuestionFlashcards(prev => [newCard, ...prev]); setFlashcardIndex(0); setWrongQuestionStatus("Flashcard saved.");
  };

  const handleLoadSavedFlashcards = () => {
    const loaded = readWrongQuestionFlashcards(); setWrongQuestionFlashcards(loaded); setFlashcardIndex(0);
    setWrongQuestionStatus(`Loaded ${loaded.length} flashcards.`);
  };

  const handleClearWrongQuestion = () => {
    setWrongQuestionImageFile(null); setWrongQuestionImagePreview(""); setWrongQuestionOcrText(""); setWrongQuestionDraftText("");
    setWrongQuestionStatus("Cleared.");
  };

  const handlePrevFlashcard = () => { setFlashcardIndex(p => Math.max(0, p - 1)); };
  const handleNextFlashcard = () => { setFlashcardIndex(p => Math.min(wrongQuestionFlashcards.length - 1, p + 1)); };
  const handleDeleteFlashcard = (idToDelete) => {
    if (!window.confirm("Delete this flashcard?")) return;
    setWrongQuestionFlashcards(prev => prev.filter(c => c.id !== idToDelete));
    setFlashcardIndex(p => (p > 0 ? p - 1 : 0)); setWrongQuestionStatus("Deleted.");
  };

  // --- AI Handlers ---
  const handleCaptureRunAI = async () => {
    if (!effectiveCaptureText.trim()) return setCaptureStatus("Please type notes first.");
    setIsCaptureAnalyzing(true); setCaptureStatus("AI thinking...");
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: effectiveCaptureText, type: 'capture' }) });
      const data = await res.json();
      if (data.analysis) { setCaptureAiResult(data.analysis); setCaptureStatus("AI Analysis Complete!"); } else { setCaptureStatus("AI Error: " + (data.error || "Unknown")); }
    } catch (e) { setCaptureStatus("AI Error: Network/Timeout"); }
    setIsCaptureAnalyzing(false);
  };

  const handleWrongQuestionRunAI = async () => {
    if (!wrongQuestionDraftText.trim()) return setWrongQuestionStatus("Please provide text first.");
    setIsAnalyzing(true); setWrongQuestionStatus("AI analyzing...");
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: wrongQuestionDraftText, type: 'wrong_question' }) });
      const data = await res.json();
      if (data.analysis) { setAiAnalysisResult(data.analysis); setWrongQuestionStatus("AI Analysis Complete!"); } else { setWrongQuestionStatus("AI Error: " + (data.error || "Unknown")); }
    } catch (e) { setWrongQuestionStatus("AI Error: Network/Timeout"); }
    setIsAnalyzing(false);
  };

  const scrollableStyle = { 
    maxHeight: '250px', 
    overflowY: 'auto', 
    padding: '12px', 
    backgroundColor: '#f8fafc', 
    borderRadius: '6px', 
    border: '1px solid #e2e8f0',
    whiteSpace: 'pre-wrap', 
    wordBreak: 'break-word',
    marginTop: '6px'
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card"><div className="brand-title">ARE Study Vault</div></div>
        <div className="sidebar-section">
          <div className="sidebar-label">Memory Palace</div>
          <div className="division-list">{DIVISIONS.map(div => <button key={div} className={`nav-pill ${selectedDivision === div ? "active" : ""}`} onClick={() => { setSelectedDivision(div); setSelectedRoom(ROOMS_BY_DIVISION[div][0]); }}>{div}</button>)}</div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-label">{selectedDivision} Rooms</div>
          <div className="room-list">{rooms.map(room => <button key={room} className={`room-pill ${selectedRoom === room ? "active" : ""}`} onClick={() => setSelectedRoom(room)}>{room}</button>)}</div>
        </div>
      </aside>

      <main className="main-workspace">
        {/* ================= Capture 区 ================= */}
        <section className="workspace-card capture-workspace">
          <div className="workspace-header">
            <h2>Capture Notes Workspace</h2>
            <div className="workspace-meta"><span>{selectedDivision}</span><span>{selectedRoom}</span><span>Saved Notes: {savedNotesForTopic.length}</span></div>
          </div>
          <div className="panel capture-editor-panel">
            <div className="panel-title">Capture Editor</div>
            <textarea className="panel-textarea" value={captureDraft} onChange={e => setCaptureDraft(e.target.value)} placeholder="粘贴长笔记..." />
          </div>
          <div className="panel capture-controls">
             {/* 所有的操作按钮都在这里，绝没删减！ */}
            <div className="button-row">
              <button onClick={handleSaveNote}>Save Note</button>
              <button onClick={handleLoadSavedNotes}>Load Saved Notes</button>
              <button onClick={handleLoadTopicSample}>Load {selectedDivision} Sample</button>
              <button onClick={handleClearEditor}>Clear Editor</button>
            </div>
            <div style={{color: '#10b981', marginTop: '10px'}}>{captureStatus}</div>
          </div>

          <div className="workspace-grid">
            <div className="panel capture-analysis-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <h3 style={{margin:0}}>Analysis <span style={{fontSize:'12px', background: captureAiResult?'#dbeafe':'#f1f5f9', padding:'4px 8px', borderRadius:'12px'}}>{captureAiResult?"✨ AI Active":"⚙️ Local Active"}</span></h3>
                <button onClick={handleCaptureRunAI} disabled={isCaptureAnalyzing} style={{ background: '#2563eb', color: 'white', padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}>{isCaptureAnalyzing ? "Thinking..." : "✨ Ask AI"}</button>
              </div>
              <div className="subcard"><div className="subcard-title">Summary</div><div style={scrollableStyle}>{captureSummary}</div></div>
              <div className="subcard"><div className="subcard-title">Extraction</div><div style={scrollableStyle}><ul>{captureExtraction.map((item, i) => <li key={i} style={{marginBottom:'6px'}}>{item}</li>)}</ul></div></div>
              <div className="subcard"><div className="subcard-title">Bullet Points</div><div style={scrollableStyle}><ul>{captureBulletPoints.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div>
              <div className="subcard"><div className="subcard-title">Logic Links</div><div style={scrollableStyle}><ul>{captureLogicLinks.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div>
            </div>
            <div className="panel live-logic-graph-panel">
              <h3 style={{margin:0, marginBottom:'10px'}}>Live Logic Image <span style={{fontSize:'12px', background: captureAiResult?'#dbeafe':'#f1f5f9', padding:'4px 8px', borderRadius:'12px'}}>{captureAiResult?"✨ AI Active":"⚙️ Local Active"}</span></h3>
              <div style={{ maxHeight: '600px', overflowY: 'auto', background: '#f8fafc', padding: '10px', borderRadius: '8px' }}>
                {captureLogicForest.length === 0 ? <div style={{color:'#64748b'}}>输入内容生成导图...</div> : <div className="logic-forest">{captureLogicForest.map((tree, i) => <div key={i} className="logic-tree-card"><LogicTreeNode tree={tree} /></div>)}</div>}
              </div>
            </div>
          </div>
        </section>

        {/* ================= 错题 区 ================= */}
        <section className="workspace-card wrong-question-workspace">
          <div className="workspace-header"><h2>Wrong Question Workspace</h2></div>
          <div className="workspace-grid">
            <div className="panel wrong-question-input-panel">
               <div className="panel-title">Wrong Question Input</div>
               <div className="subcard compact-subcard">
                 <div className="subcard-title">Image Upload</div>
                 {wrongQuestionImagePreview ? <img src={wrongQuestionImagePreview} alt="Preview" className="image-preview" /> : <div className="image-placeholder">Image Preview</div>}
                 {/* 上传、删除、OCR 按钮都在这！ */}
                 <div className="button-row wrongq-button-row" style={{ marginTop: 12 }}>
                   <label className="nav-pill upload-nav-pill">Upload Image<input type="file" accept="image/*" onChange={handleWrongQuestionImageChange} hidden /></label>
                   {wrongQuestionImagePreview && <button className="nav-pill" onClick={() => { setWrongQuestionImageFile(null); setWrongQuestionImagePreview(""); }} style={{ backgroundColor: '#fee2e2', color: '#dc2626' }} type="button">Delete Image</button>}
                   <button className="nav-pill nav-action-pill" onClick={handleRunOcr} disabled={isRunningOcr} type="button">{isRunningOcr ? "Running..." : "Run OCR"}</button>
                 </div>
               </div>
               <div className="subcard compact-subcard">
                 <div className="subcard-title">Wrong Question Text</div>
                 <textarea className="panel-textarea wrong-question-textarea" value={wrongQuestionDraftText} onChange={e => setWrongQuestionDraftText(e.target.value)} placeholder="粘贴错题..." style={{minHeight: '200px'}}/>
               </div>
            </div>

            <div className="panel wrong-question-analysis-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <h3 style={{margin:0}}>Analysis <span style={{fontSize:'12px', background: aiAnalysisResult?'#dbeafe':'#f1f5f9', padding:'4px 8px', borderRadius:'12px'}}>{aiAnalysisResult?"✨ AI Active":"⚙️ Local Active"}</span></h3>
                <button onClick={handleWrongQuestionRunAI} disabled={isAnalyzing} style={{ background: '#2563eb', color: 'white', padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}>{isAnalyzing ? "Thinking..." : "✨ Ask AI"}</button>
              </div>
              <div className="analysis-mini-grid">
                <div className="subcard"><div className="subcard-title">Summary</div><div style={scrollableStyle}>{wrongQuestionAnalysis.summary}</div></div>
                <div className="subcard"><div className="subcard-title">Correct Answer</div><div style={scrollableStyle}>{Array.isArray(wrongQuestionAnalysis.correctAnswer) ? wrongQuestionAnalysis.correctAnswer.join(" / ") : wrongQuestionAnalysis.correctAnswer}</div></div>
                <div className="subcard analysis-span-2"><div className="subcard-title">Answer Extraction</div><div style={scrollableStyle}><ul>{wrongQuestionAnalysis.answerExtraction.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div>
                <div className="subcard analysis-span-2"><div className="subcard-title">Trap Point</div><div style={scrollableStyle}><ul>{wrongQuestionAnalysis.trapPoint.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div>
                <div className="subcard"><div className="subcard-title">Memory Hook</div><div style={scrollableStyle}>{wrongQuestionAnalysis.memoryHook}</div></div>
              </div>
            </div>
          </div>

          <div className="panel wrong-question-controls">
            <div className="button-row">
              <button onClick={handleSaveWrongQuestion}>Save Wrong Question</button>
              <button onClick={handleLoadSavedFlashcards}>Load Saved Flashcards</button>
              <button onClick={handleClearWrongQuestion}>Clear Wrong Question</button>
            </div>
            <div style={{color: '#10b981', marginTop: '10px'}}>{wrongQuestionStatus}</div>
          </div>

          {/* ================= Flashcards 轮播区 (完好无损) ================= */}
          <div className="panel flashcard-panel">
            <div className="panel-title">Wrong Question Flashcards</div>
            {wrongQuestionFlashcards.length === 0 ? <div className="flashcard-placeholder">No saved flashcards yet.</div> : (
              <div className="flashcard-carousel">
                <div className="flashcard-carousel-header">
                  <button onClick={handlePrevFlashcard} disabled={flashcardIndex === 0}>← Previous</button>
                  <div className="flashcard-counter">{flashcardIndex + 1} / {wrongQuestionFlashcards.length}</div>
                  <button onClick={handleNextFlashcard} disabled={flashcardIndex === wrongQuestionFlashcards.length - 1}>Next →</button>
                </div>
                {currentFlashcard ? (
                  <div className="flashcard-slide">
                    <div className="flashcard-slide-top">
                      <div className="flashcard-meta">{currentFlashcard.topicKey} · {formatSavedAt(currentFlashcard.savedAt)}</div>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        {currentFlashcard.imagePreview && (
                          <div className="flashcard-thumb-wrap">
                            <img src={currentFlashcard.imagePreview} alt="thumb" className="flashcard-thumb" onClick={() => setExpandedImage(currentFlashcard.imagePreview)} />
                            <button className="tiny-link-btn" onClick={() => setExpandedImage(currentFlashcard.imagePreview)}>View Image</button>
                          </div>
                        )}
                        <button onClick={() => handleDeleteFlashcard(currentFlashcard.id)} style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Delete</button>
                      </div>
                    </div>
                    <div className="flashcard-question"><div className="subcard-title">Question</div><p>{currentFlashcard.questionText}</p></div>
                    <div className="flashcard-detail-grid">
                      <div className="subcard compact-subcard"><div className="subcard-title">Correct Answer</div>{Array.isArray(currentFlashcard.correctAnswer) ? <p>{currentFlashcard.correctAnswer.join(" / ")}</p> : <p>{currentFlashcard.correctAnswer}</p>}</div>
                      <div className="subcard compact-subcard"><div className="subcard-title">Memory Hook</div><p>{currentFlashcard.memoryHook}</p></div>
                      <div className="subcard compact-subcard analysis-span-2"><div className="subcard-title">Answer Extraction</div><ul>{currentFlashcard.answerExtraction.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                      <div className="subcard compact-subcard analysis-span-2"><div className="subcard-title">Trap Point</div><ul>{currentFlashcard.trapPoint.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
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
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setExpandedImage("")}>×</button>
            <img src={expandedImage} alt="Expanded" className="image-modal-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
