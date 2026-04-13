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

function splitSentences(text) {
  return (text || "").replace(/\r/g, "").replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
}

function splitLines(text) {
  return (text || "").replace(/\r/g, "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function capitalizeWords(text) {
  return (text || "").split(" ").map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(" ");
}

// 优化本地占位符：当没有 AI 时，清楚地告诉用户需要点击按钮
function buildCaptureSummary(text) { return text ? "👉 请点击蓝色按钮 'Ask AI to Analyze' 获取智能摘要..." : "No notes yet for this topic."; }
function buildCaptureExtraction(text) { return text ? ["👉 请点击 'Ask AI to Analyze' 提取核心知识点..."] : ["Start typing or save notes in this topic..."]; }
function buildCaptureBulletPoints(text) { return text ? ["👉 等待 AI 智能分块分析..."] : ["Start typing or save notes..."]; }
function buildCaptureLogicLinks(text) { return text ? ["👉 等待 AI 梳理逻辑链路..."] : ["Start typing to generate logic links."]; }
function buildCaptureLogicForest(text) { return []; }

function parseCorrectAnswer(text) {
  const match = (text || "").match(/correct answer\s*[:\-]\s*(.+)/i);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw) return null;
  if (raw.includes("/") || raw.includes(",")) return raw.split(/[\/,]/).map((item) => item.trim()).filter(Boolean);
  return raw;
}

function buildWrongQuestionQuestionText(text) {
  const lines = splitLines(text);
  const questionLines = [];
  for (let line of lines) {
    if (/^(?:☑|✔|☐|❌|\[x\]|\[ \])?\s*(?:Correct|Incorrect)[\.\s:-]+/i.test(line)) break;
    if (/^correct answer[:\-]/i.test(line)) break;
    if (/^summary[:\-]/i.test(line)) break;
    if (/^trap point[:\-]/i.test(line)) break;
    if (/^memory hook[:\-]/i.test(line)) break;
    if (/^reference[:\-]/i.test(line)) break;
    questionLines.push(line);
  }
  if (!questionLines.length) return "No question text yet.";
  return questionLines.slice(0, 6).join(" ");
}

function buildWrongQuestionSummary(text) { return text ? "👉 请点击 'Ask AI to Analyze' 获取错题分析..." : "No wrong-question content yet."; }
function buildWrongQuestionCorrectAnswer(text) { const parsed = parseCorrectAnswer(text); return parsed ? parsed : "Not detected yet."; }
function buildWrongQuestionAnswerExtraction(text) {
  const lines = splitLines(text);
  const correctLines = lines.filter(l => /^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i.test(l.trim()));
  if (correctLines.length > 0) return correctLines.map(l => l.replace(/^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i, '').trim());
  return ["👉 请点击 'Ask AI to Analyze' 解析正确选项逻辑..."];
}
function buildWrongQuestionTrapPoint(text) {
  const lines = splitLines(text);
  const incorrectLines = lines.filter(l => /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i.test(l.trim()));
  if (incorrectLines.length > 0) return incorrectLines.map(l => l.replace(/^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i, '').trim());
  return ["👉 请点击 'Ask AI to Analyze' 提取避坑指南..."];
}
function buildWrongQuestionMemoryHook(text) { return "👉 请点击 'Ask AI to Analyze' 生成记忆钩子..."; }

function buildWrongQuestionAnalysis(text) {
  return {
    questionText: buildWrongQuestionQuestionText(text),
    summary: buildWrongQuestionSummary(text),
    correctAnswer: buildWrongQuestionCorrectAnswer(text),
    answerExtraction: buildWrongQuestionAnswerExtraction(text),
    trapPoint: buildWrongQuestionTrapPoint(text),
    memoryHook: buildWrongQuestionMemoryHook(text)
  };
}

function readSavedNotesByTopic() { try { const raw = localStorage.getItem("savedNotesByTopic"); return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
function readWrongQuestionFlashcards() { try { const raw = localStorage.getItem("wrongQuestionFlashcards"); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function formatSavedAt(dateString) { if (!dateString) return ""; const d = new Date(dateString); return Number.isNaN(d.getTime()) ? dateString : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString()}`; }

function LogicTreeNode({ tree, depth = 0 }) {
  return (
    <div className={`logic-tree-level depth-${depth}`}>
      <div className="logic-tree-row">
        {tree.relation ? <span className={`logic-relation-pill relation-${tree.relation.replace(/\s+/g, "-")}`}>{capitalizeWords(tree.relation)}</span> : null}
        <div className={`logic-node-card ${depth === 0 ? "root" : ""}`}>{tree.label}</div>
      </div>
      {tree.children?.length ? <div className="logic-children">{tree.children.map((child, index) => <LogicTreeNode key={`${child.label}-${index}`} tree={child} depth={depth + 1} />)}</div> : null}
    </div>
  );
}

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

  useEffect(() => { const timer = setTimeout(() => { setDebouncedCaptureDraft(captureDraft); }, 1200); return () => clearTimeout(timer); }, [captureDraft]);
  useEffect(() => { setCaptureAiResult(null); }, [debouncedCaptureDraft]);
  useEffect(() => { setAiAnalysisResult(null); }, [wrongQuestionDraftText]);
  useEffect(() => { localStorage.setItem("savedNotesByTopic", JSON.stringify(savedNotesByTopic)); }, [savedNotesByTopic]);
  useEffect(() => { localStorage.setItem("wrongQuestionFlashcards", JSON.stringify(wrongQuestionFlashcards)); }, [wrongQuestionFlashcards]);
  useEffect(() => { if (flashcardIndex > wrongQuestionFlashcards.length - 1) setFlashcardIndex(Math.max(0, wrongQuestionFlashcards.length - 1)); }, [wrongQuestionFlashcards, flashcardIndex]);

  const savedTopicText = useMemo(() => savedNotesForTopic.map((item) => item.text).join("\n\n"), [savedNotesForTopic]);
  const effectiveCaptureText = useMemo(() => {
    const saved = savedTopicText.trim(); const draft = debouncedCaptureDraft.trim();
    if (saved && draft) return `${saved}\n\n${draft}`;
    if (saved) return saved; if (draft) return draft; return "";
  }, [savedTopicText, debouncedCaptureDraft]);

  const captureSummary = useMemo(() => captureAiResult?.summary || buildCaptureSummary(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);
  const captureExtraction = useMemo(() => captureAiResult?.extraction || buildCaptureExtraction(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);
  const captureBulletPoints = useMemo(() => captureAiResult?.bulletPoints || buildCaptureBulletPoints(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);
  const captureLogicLinks = useMemo(() => captureAiResult?.logicLinks || buildCaptureLogicLinks(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);
  const captureLogicForest = useMemo(() => captureAiResult?.logicForest || buildCaptureLogicForest(effectiveCaptureText), [effectiveCaptureText, captureAiResult]);

  const wrongQuestionAnalysis = useMemo(() => {
    if (aiAnalysisResult) return aiAnalysisResult;
    return buildWrongQuestionAnalysis(wrongQuestionDraftText);
  }, [wrongQuestionDraftText, aiAnalysisResult]);

  const currentFlashcard = wrongQuestionFlashcards[flashcardIndex] || null;

  const handleSaveNote = () => {
    const trimmed = captureDraft.trim();
    if (!trimmed) { setCaptureStatus("Capture editor is empty."); return; }
    const newNote = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: trimmed, savedAt: new Date().toISOString() };
    setSavedNotesByTopic((prev) => { const current = prev[currentTopicKey] || []; return { ...prev, [currentTopicKey]: [...current, newNote] }; });
    setCaptureDraft(""); setDebouncedCaptureDraft(""); setCaptureStatus(`Saved 1 note to ${currentTopicKey}.`);
  };

  const handleLoadSavedNotes = () => {
    if (!savedNotesForTopic.length) { setCaptureStatus(`No saved notes found for ${currentTopicKey}.`); return; }
    setCaptureStatus(`${currentTopicKey} already has ${savedNotesForTopic.length} saved notes. Current analysis is already using them.`);
  };

  const handleLoadTopicSample = () => {
    const sample = SAMPLE_BY_DIVISION[selectedDivision] || ""; setCaptureDraft(sample);
    setCaptureStatus(`Loaded ${selectedDivision} sample. Analysis will update in about 1 second.`);
  };

  const handleClearEditor = () => { setCaptureDraft(""); setDebouncedCaptureDraft(""); setCaptureStatus("Capture editor cleared."); };

  const handleWrongQuestionImageChange = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) { setWrongQuestionImageFile(null); setWrongQuestionImagePreview(""); setWrongQuestionStatus("No image selected."); return; }
    setWrongQuestionImageFile(file); setWrongQuestionStatus(`Selected image: ${file.name}`);
    const reader = new FileReader();
    reader.onloadend = () => { setWrongQuestionImagePreview(typeof reader.result === "string" ? reader.result : ""); };
    reader.readAsDataURL(file);
  };

  const handleRunOcr = async () => {
    if (!wrongQuestionImageFile) { setWrongQuestionStatus("Please select an image first."); return; }
    try {
      setIsRunningOcr(true); setWrongQuestionStatus("Reading image text...");
      const result = await Tesseract.recognize(wrongQuestionImageFile, "eng");
      const extractedText = result?.data?.text?.trim() || "";
      if (!extractedText) { setWrongQuestionStatus("No text detected from this image."); return; }
      setWrongQuestionOcrText(extractedText); setWrongQuestionDraftText(extractedText);
      setWrongQuestionStatus("OCR completed. Text has been added to Wrong Question Text.");
    } catch (error) { console.error(error); setWrongQuestionStatus("OCR failed. Try another image."); } finally { setIsRunningOcr(false); }
  };

  const handleSaveWrongQuestion = () => {
    const trimmed = wrongQuestionDraftText.trim();
    if (!trimmed) { setWrongQuestionStatus("Wrong Question Text is empty."); return; }
    const newCard = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, topicKey: currentTopicKey, imagePreview: wrongQuestionImagePreview,
      ocrText: wrongQuestionOcrText, editedText: trimmed, questionText: wrongQuestionAnalysis.questionText,
      summary: wrongQuestionAnalysis.summary, correctAnswer: wrongQuestionAnalysis.correctAnswer,
      answerExtraction: wrongQuestionAnalysis.answerExtraction, trapPoint: wrongQuestionAnalysis.trapPoint,
      memoryHook: wrongQuestionAnalysis.memoryHook, savedAt: new Date().toISOString()
    };
    setWrongQuestionFlashcards((prev) => [newCard, ...prev]); setFlashcardIndex(0); setWrongQuestionStatus("Wrong question saved as flashcard.");
  };

  const handleLoadSavedFlashcards = () => {
    const loaded = readWrongQuestionFlashcards(); setWrongQuestionFlashcards(loaded); setFlashcardIndex(0);
    setWrongQuestionStatus(`Loaded ${loaded.length} saved flashcards.`);
  };

  const handleClearWrongQuestion = () => {
    setWrongQuestionImageFile(null); setWrongQuestionImagePreview(""); setWrongQuestionOcrText(""); setWrongQuestionDraftText("");
    setWrongQuestionStatus("Wrong question workspace cleared.");
  };

  const handlePrevFlashcard = () => { setFlashcardIndex((prev) => Math.max(0, prev - 1)); };
  const handleNextFlashcard = () => { setFlashcardIndex((prev) => Math.min(wrongQuestionFlashcards.length - 1, prev + 1)); };

  const handleDeleteFlashcard = (idToDelete) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this flashcard?");
    if (!confirmDelete) return;
    setWrongQuestionFlashcards((prev) => prev.filter((card) => card.id !== idToDelete));
    setFlashcardIndex((prev) => (prev > 0 ? prev - 1 : 0)); setWrongQuestionStatus("Flashcard deleted.");
  };

  const handleCaptureRunAI = async () => {
    if (!effectiveCaptureText.trim()) { setCaptureStatus("Please type some notes first."); return; }
    setIsCaptureAnalyzing(true); setCaptureStatus("AI is thinking... (Please wait up to 10 seconds)");
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: effectiveCaptureText, type: 'capture' }) });
      const data = await res.json();
      if (data.analysis) { setCaptureAiResult(data.analysis); setCaptureStatus("AI Analysis Complete! 🌟"); } else { setCaptureStatus("AI Error: " + (data.error || "Unknown")); }
    } catch (e) { setCaptureStatus("AI Backend not connected or timed out."); }
    setIsCaptureAnalyzing(false);
  };

  const handleWrongQuestionRunAI = async () => {
    if (!wrongQuestionDraftText.trim()) { setWrongQuestionStatus("Please provide text first."); return; }
    setIsAnalyzing(true); setWrongQuestionStatus("AI is analyzing...");
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: wrongQuestionDraftText, type: 'wrong_question' }) });
      const data = await res.json();
      if (data.analysis) { setAiAnalysisResult(data.analysis); setWrongQuestionStatus("AI Analysis Complete! 🌟"); } else { setWrongQuestionStatus("AI Error: " + (data.error || "Unknown")); }
    } catch (e) { setWrongQuestionStatus("AI Backend not connected or timed out."); }
    setIsAnalyzing(false);
  };

  // 通用的滚动框样式
  const scrollableStyle = { maxHeight: '200px', overflowY: 'auto', paddingRight: '5px' };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-title">ARE Study Vault</div>
          <div className="brand-subtitle">空间结构 + 自动分块</div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-label">Memory Palace</div>
          <div className="division-list">
            {DIVISIONS.map((division) => (
              <button key={division} className={`nav-pill ${selectedDivision === division ? "active" : ""}`} onClick={() => { setSelectedDivision(division); setSelectedRoom(ROOMS_BY_DIVISION[division][0]); }}>{division}</button>
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
        <section className="workspace-card capture-workspace">
          <div className="workspace-header">
            <h2>Capture Notes Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span><span>{selectedRoom}</span><span>{currentTopicKey}</span><span>Saved Notes: {savedNotesForTopic.length}</span>
            </div>
          </div>
          <div className="panel capture-editor-panel">
            <div className="panel-title">Capture Editor</div>
            <textarea className="panel-textarea" value={captureDraft} onChange={(e) => setCaptureDraft(e.target.value)} placeholder="粘贴长笔记到这里，然后点击下方的蓝色 ✨Ask AI to Analyze 按钮！" />
          </div>
          <div className="panel capture-controls">
            <div className="panel-title">Capture Controls</div>
            <div className="button-row">
              <button onClick={handleSaveNote}>Save Note</button>
              <button onClick={handleCaptureRunAI} disabled={isCaptureAnalyzing} style={{ backgroundColor: '#3b82f6', color: '#fff', borderColor: '#2563eb', fontWeight: 'bold' }}>
                {isCaptureAnalyzing ? "AI 正在飞速思考中..." : "✨ Ask AI to Analyze"}
              </button>
              <button onClick={handleLoadSavedNotes}>Load Saved Notes</button>
              <button onClick={handleClearEditor}>Clear Editor</button>
            </div>
            <div style={{ marginTop: 12, color: isCaptureAnalyzing ? '#3b82f6' : '#10b981', fontWeight: 600 }}>{captureStatus}</div>
          </div>

          <div className="workspace-grid">
            <div className="panel capture-analysis-panel">
              <div className="panel-title">Capture Analysis</div>
              <div className="subcard compact-subcard">
                <div className="subcard-title">Summary</div>
                <div style={scrollableStyle}><p>{captureSummary}</p></div>
              </div>
              <div className="subcard compact-subcard">
                <div className="subcard-title">Extraction</div>
                <div style={scrollableStyle}><ul>{captureExtraction.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
              </div>
              <div className="subcard compact-subcard">
                <div className="subcard-title">Bullet Points</div>
                <div style={scrollableStyle}><ul>{captureBulletPoints.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
              </div>
              <div className="subcard compact-subcard">
                <div className="subcard-title">Logic Links</div>
                <div style={scrollableStyle}><ul>{captureLogicLinks.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
              </div>
            </div>

            <div className="panel live-logic-graph-panel">
              <div className="panel-title">Live Logic Image</div>
              <div style={{ maxHeight: '600px', overflowY: 'auto', paddingRight: '5px' }}>
                {captureLogicForest.length === 0 ? (
                  <div className="logic-graph-placeholder">等待 AI 生成你的知识逻辑树...</div>
                ) : (
                  <div className="logic-forest">{captureLogicForest.map((tree, index) => <div key={`${tree.label}-${index}`} className="logic-tree-card"><LogicTreeNode tree={tree} /></div>)}</div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="workspace-card wrong-question-workspace">
          <div className="workspace-header">
            <h2>Wrong Question Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span><span>{selectedRoom}</span><span>{currentTopicKey}</span><span>Flashcards: {wrongQuestionFlashcards.length}</span>
            </div>
          </div>
          <div className="workspace-grid">
            <div className="panel wrong-question-input-panel">
              <div className="panel-title">Wrong Question Input</div>
              <div className="subcard compact-subcard">
                <div className="subcard-title">Image Upload</div>
                {wrongQuestionImagePreview ? <img src={wrongQuestionImagePreview} alt="Preview" className="image-preview" /> : <div className="image-placeholder">Image Preview</div>}
                <div className="button-row wrongq-button-row" style={{ marginTop: 12 }}>
                  <label className="nav-pill upload-nav-pill">Upload Image<input type="file" accept="image/*" onChange={handleWrongQuestionImageChange} hidden /></label>
                  {wrongQuestionImagePreview && <button className="nav-pill" onClick={() => { setWrongQuestionImageFile(null); setWrongQuestionImagePreview(""); setWrongQuestionStatus("Image deleted."); }} style={{ backgroundColor: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' }} type="button">Delete Image</button>}
                  <button className="nav-pill nav-action-pill" onClick={handleRunOcr} disabled={isRunningOcr} type="button">{isRunningOcr ? "Running OCR..." : "Run OCR"}</button>
                </div>
              </div>
              <div className="subcard compact-subcard">
                <div className="subcard-title">Wrong Question Text</div>
                <textarea className="panel-textarea wrong-question-textarea" value={wrongQuestionDraftText} onChange={(e) => setWrongQuestionDraftText(e.target.value)} placeholder="粘贴错题文字，然后点击右侧的 ✨ Ask AI to Analyze" />
              </div>
            </div>

            <div className="panel wrong-question-analysis-panel">
              <div className="panel-title">Wrong Question Analysis</div>
              <div className="analysis-mini-grid">
                <div className="subcard compact-subcard"><div className="subcard-title">Summary</div><div style={scrollableStyle}><p>{wrongQuestionAnalysis.summary}</p></div></div>
                <div className="subcard compact-subcard"><div className="subcard-title">Correct Answer</div><div style={scrollableStyle}>{Array.isArray(wrongQuestionAnalysis.correctAnswer) ? <p>{wrongQuestionAnalysis.correctAnswer.join(" / ")}</p> : <p>{wrongQuestionAnalysis.correctAnswer}</p>}</div></div>
                <div className="subcard compact-subcard analysis-span-2"><div className="subcard-title">Answer Extraction</div><div style={scrollableStyle}><ul>{wrongQuestionAnalysis.answerExtraction.map((item, index) => <li key={index}>{item}</li>)}</ul></div></div>
                <div className="subcard compact-subcard"><div className="subcard-title">Trap Point</div><div style={scrollableStyle}><ul>{wrongQuestionAnalysis.trapPoint.map((item, index) => <li key={index}>{item}</li>)}</ul></div></div>
                <div className="subcard compact-subcard"><div className="subcard-title">Memory Hook</div><div style={scrollableStyle}><p>{wrongQuestionAnalysis.memoryHook}</p></div></div>
              </div>
            </div>
          </div>

          <div className="panel wrong-question-controls">
            <div className="panel-title">Wrong Question Controls</div>
            <div className="button-row">
              <button onClick={handleSaveWrongQuestion}>Save Wrong Question</button>
              <button onClick={handleWrongQuestionRunAI} disabled={isAnalyzing} style={{ backgroundColor: '#3b82f6', color: '#fff', borderColor: '#2563eb', fontWeight: 'bold' }}>{isAnalyzing ? "AI 正在分析错题..." : "✨ Ask AI to Analyze"}</button>
              <button onClick={handleLoadSavedFlashcards}>Load Saved Flashcards</button>
              <button onClick={handleClearWrongQuestion}>Clear Wrong Question</button>
            </div>
            <div style={{ marginTop: 12, color: isAnalyzing ? '#3b82f6' : '#10b981', fontWeight: 600 }}>{wrongQuestionStatus}</div>
          </div>

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
                        {currentFlashcard.imagePreview ? (
                          <div className="flashcard-thumb-wrap">
                            <img src={currentFlashcard.imagePreview} alt="Wrong question thumbnail" className="flashcard-thumb" onClick={() => setExpandedImage(currentFlashcard.imagePreview)} />
                            <button className="tiny-link-btn" onClick={() => setExpandedImage(currentFlashcard.imagePreview)}>View Image</button>
                          </div>
                        ) : null}
                        <button onClick={() => handleDeleteFlashcard(currentFlashcard.id)} style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Delete</button>
                      </div>
                    </div>
                    <div className="flashcard-question"><div className="subcard-title">Question</div><p>{currentFlashcard.questionText}</p></div>
                    <div className="flashcard-detail-grid">
                      <div className="subcard compact-subcard"><div className="subcard-title">Correct Answer</div>{Array.isArray(currentFlashcard.correctAnswer) ? <p>{currentFlashcard.correctAnswer.join(" / ")}</p> : <p>{currentFlashcard.correctAnswer}</p>}</div>
                      <div className="subcard compact-subcard"><div className="subcard-title">Memory Hook</div><p>{currentFlashcard.memoryHook}</p></div>
                      <div className="subcard compact-subcard analysis-span-2"><div className="subcard-title">Answer Extraction</div><ul>{currentFlashcard.answerExtraction.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
                      <div className="subcard compact-subcard analysis-span-2"><div className="subcard-title">Trap Point</div><ul>{currentFlashcard.trapPoint.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
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
            <img src={expandedImage} alt="Expanded wrong question" className="image-modal-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
