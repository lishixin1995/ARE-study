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

// ==========================================
// ⚙️ 强大的本地解析器 (Local Parser - 免费且瞬间完成)
// ==========================================

function splitSentences(text) {
  return (text || "").replace(/\r/g, "").replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
}

function splitLines(text) {
  return (text || "").replace(/\r/g, "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function capitalizeWords(text) {
  return (text || "").split(" ").map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(" ");
}

// 笔记区本地逻辑
function buildCaptureSummary(text) {
  if (!text) return "No notes yet for this topic.";
  const sentences = splitSentences(text);
  if (sentences.length >= 2) return `${sentences[0]} ${sentences[1]}`;
  return sentences[0];
}

function buildCaptureExtraction(text) {
  if (!text) return ["Start typing or save notes to generate local extraction."];
  const lines = splitLines(text);
  if (lines.length >= 4) return lines.slice(0, 4);
  const sentences = splitSentences(text);
  if (sentences.length >= 4) return sentences.slice(0, 4);
  return lines;
}

function buildCaptureBulletPoints(text) {
  if (!text) return ["Waiting for input..."];
  const bulletLines = splitLines(text).filter(l => l.trim().startsWith('-') || l.trim().startsWith('•') || l.trim().startsWith('*') || l.match(/^\d+\./));
  if (bulletLines.length > 0) return bulletLines.map(l => l.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, ''));
  return buildCaptureExtraction(text).slice(0, 3);
}

function buildCaptureLogicLinks(text) {
  if (!text) return ["Start typing to generate logic links."];
  const sentences = splitSentences(text);
  if (sentences.length > 1) return [`${sentences[0].substring(0, 30)}... ➔ ${sentences[1].substring(0, 30)}...`];
  return ["Not enough text to generate local logic links. Try AI."];
}

function buildCaptureLogicForest(text) {
  return []; 
}

// 错题区本地逻辑
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

function buildWrongQuestionSummary(text) {
  if (!text) return "No wrong-question content yet.";
  const sentences = splitSentences(text);
  return sentences.length >= 2 ? `${sentences[0]} ${sentences[1]}` : sentences[0];
}

function buildWrongQuestionCorrectAnswer(text) {
  const parsed = parseCorrectAnswer(text);
  return parsed ? parsed : "Not detected. Add 'Correct Answer:' or Use AI.";
}

function buildWrongQuestionAnswerExtraction(text) {
  const lines = splitLines(text);
  const correctLines = lines.filter(l => /^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i.test(l.trim()));
  if (correctLines.length > 0) return correctLines.map(l => l.replace(/^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i, '').trim());
  const otherLines = lines.filter(l => !l.toLowerCase().includes("incorrect") && l.length > 30);
  if (otherLines.length > 0) return otherLines.slice(0, 3);
  return ["Not detected by Local Parser. Click 'Ask AI'."];
}

function buildWrongQuestionTrapPoint(text) {
  const lines = splitLines(text);
  const incorrectLines = lines.filter(l => /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i.test(l.trim()));
  if (incorrectLines.length > 0) return incorrectLines.map(l => l.replace(/^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i, '').trim());
  return ["Not detected by Local Parser. Click 'Ask AI'."];
}

function buildWrongQuestionMemoryHook(text) {
  return "Local Parser active. (Tip: Use AI for a creative memory hook!)";
}

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

// --- 数据读取 ---
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
    setCaptureStatus(`${currentTopicKey} already has ${savedNotesForTopic.length} saved notes.`);
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
      setWrongQuestionStatus("OCR completed. Local Parser Active ⚙️");
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

  // AI 呼叫逻辑
  const handleCaptureRunAI = async () => {
    if (!effectiveCaptureText.trim()) { setCaptureStatus("Please type some notes first."); return; }
    setIsCaptureAnalyzing(true); setCaptureStatus("AI is thinking... (Please wait up to 10 seconds)");
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: effectiveCaptureText, type: 'capture' }) });
      const data = await res.json();
      if (data.analysis) { setCaptureAiResult(data.analysis); setCaptureStatus("AI Analysis Complete! 🌟"); } 
      else { setCaptureStatus("AI Error: " + (data.error || "Unknown")); }
    } catch (e) { setCaptureStatus("AI Backend Error. Check your internet or API key."); }
    setIsCaptureAnalyzing(false);
  };

  const handleWrongQuestionRunAI = async () => {
    if (!wrongQuestionDraftText.trim()) { setWrongQuestionStatus("Please provide text first."); return; }
    setIsAnalyzing(true); setWrongQuestionStatus("AI is analyzing...");
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: wrongQuestionDraftText, type: 'wrong_question' }) });
      const data = await res.json();
      if (data.analysis) { setAiAnalysisResult(data.analysis); setWrongQuestionStatus("AI Analysis Complete! 🌟"); } 
      else { setWrongQuestionStatus("AI Error: " + (data.error || "Unknown")); }
    } catch (e) { setWrongQuestionStatus("AI Backend Error. Check your internet or API key."); }
    setIsAnalyzing(false);
  };

  // 【终极防切割滚动条样式】强制带背景框、内边距、自动换行和滚动条
  const scrollableStyle = { 
    maxHeight: '220px', 
    overflowY: 'auto', 
    overflowX: 'hidden',
    padding: '12px', 
    backgroundColor: '#f8fafc', 
    borderRadius: '8px', 
    border: '1px solid #e2e8f0',
    whiteSpace: 'pre-wrap', 
    wordBreak: 'break-word',
    marginTop: '8px'
  };

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
            <textarea className="panel-textarea" value={captureDraft} onChange={(e) => setCaptureDraft(e.target.value)} placeholder="粘贴长笔记到这里，本地引擎会自动解析。需要深度分析时点击专属 AI 按钮！" />
          </div>
          <div className="panel capture-controls">
            <div className="button-row">
              <button onClick={handleSaveNote}>Save Note</button>
              {/* ✨ AI 按钮已经从这里搬走了，挪到了 Analysis 面板的标题上！ */}
              <button onClick={handleLoadSavedNotes}>Load Saved Notes</button>
              <button onClick={handleClearEditor}>Clear Editor</button>
            </div>
            <div style={{ marginTop: 12, color: '#10b981', fontWeight: 600 }}>{captureStatus}</div>
          </div>

          <div className="workspace-grid">
            <div className="panel capture-analysis-panel">
              {/* ✨ 专属 AI 按钮区域 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
                <h3 style={{ margin: 0, color: '#1e293b' }}>
                  Capture Analysis 
                  <span style={{ fontSize: '12px', marginLeft: '10px', padding: '4px 8px', borderRadius: '12px', backgroundColor: captureAiResult ? '#dbeafe' : '#f1f5f9', color: captureAiResult ? '#1e40af' : '#64748b' }}>
                    {captureAiResult ? "✨ AI Active" : "⚙️ Local Active"}
                  </span>
                </h3>
                <button 
                  onClick={handleCaptureRunAI} 
                  disabled={isCaptureAnalyzing} 
                  style={{ backgroundColor: '#2563eb', color: '#fff', padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(37,99,235,0.2)' }}
                >
                  {isCaptureAnalyzing ? "⏳ AI Thinking..." : "✨ Ask AI to Analyze"}
                </button>
              </div>

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
              <div style={{ maxHeight: '600px', overflowY: 'auto', paddingRight: '5px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' }}>
                {captureLogicForest.length === 0 ? (
                  <div className="logic-graph-placeholder" style={{ color: '#64748b' }}>思维导图需要强大的逻辑推理，请点击右上角的 Ask AI 按钮生成。</div>
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
              {/* ✨ 专属 AI 按钮区域 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
                <h3 style={{ margin: 0, color: '#1e293b' }}>
                  Wrong Question Analysis
                  <span style={{ fontSize: '12px', marginLeft: '10px', padding: '4px 8px', borderRadius: '12px', backgroundColor: aiAnalysisResult ? '#dbeafe' : '#f1f5f9', color: aiAnalysisResult ? '#1e40af' : '#64748b' }}>
                    {aiAnalysisResult ? "✨ AI Active" : "⚙️ Local Active"}
                  </span>
                </h3>
                <button 
                  onClick={handleWrongQuestionRunAI} 
                  disabled={isAnalyzing} 
                  style={{ backgroundColor: '#2563eb', color: '#fff', padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(37,99,235,0.2)' }}
                >
                  {isAnalyzing ? "⏳ AI Analyzing..." : "✨ Ask AI to Analyze"}
                </button>
              </div>

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
            <div className="button-row">
              <button onClick={handleSaveWrongQuestion}>Save Wrong Question</button>
              {/* ✨ AI 按钮搬走了！ */}
              <button onClick={handleLoadSavedFlashcards}>Load Saved Flashcards</button>
              <button onClick={handleClearWrongQuestion}>Clear Wrong Question</button>
            </div>
            <div style={{ marginTop: 12, color: '#10b981', fontWeight: 600 }}>{wrongQuestionStatus}</div>
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
