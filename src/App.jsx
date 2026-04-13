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
// ⚙️ 恢复到最强状态的本地大脑 (无截断限制 + 恢复逻辑树)
// ==========================================
function splitSentences(text) {
  return (text || "").replace(/\r/g, "").replace(/\n+/g, " ").split(/(?<=[.!?。！？])\s+/).map(item => item.trim()).filter(Boolean);
}
function splitLines(text) {
  return (text || "").replace(/\r/g, "").split("\n").map(item => item.trim()).filter(Boolean);
}
function capitalizeWords(text) {
  return (text || "").split(" ").map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(" ");
}

function buildCaptureSummary(text) {
  if (!text) return "等待输入...";
  const sentences = splitSentences(text);
  return sentences.length >= 2 ? `${sentences[0]} ${sentences[1]}` : sentences[0];
}

// 【修复】去掉了 slice(0,3) 截断，现在你输入多少，它就解析出多少！
function buildCaptureExtraction(text) {
  if (!text) return ["等待输入以提取核心知识点..."];
  const lines = splitLines(text);
  if (lines.length > 2) return lines; 
  return splitSentences(text); 
}

function buildCaptureBulletPoints(text) {
  if (!text) return ["等待输入..."];
  const sentences = splitSentences(text);
  // 本地智能挑选包含系统、气候、热量等关键词的句子作为重点
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
  return links.length > 0 ? links : ["无法提取逻辑关系。"];
}

// 【彻底修复】将你最爱的 Grasshopper 本地逻辑树完整加回来了！
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

// 错题区本地逻辑
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
  return correctLines.length > 0 ? correctLines.map(l => l.replace(/^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i, '').trim()) : ["本地引擎未检测到 Correct 关键词，请手动修改或使用 AI。"];
}
function buildWrongQuestionTrapPoint(text) {
  const incorrectLines = splitLines(text).filter(l => /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i.test(l.trim()));
  return incorrectLines.length > 0 ? incorrectLines.map(l => l.replace(/^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i, '').trim()) : ["本地引擎未检测到 Incorrect 关键词。"];
}

// --- 组件与状态 ---
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

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [selectedRoom, setSelectedRoom] = useState("Site");
  const [captureDraft, setCaptureDraft] = useState("");
  const [debouncedCaptureDraft, setDebouncedCaptureDraft] = useState("");
  const [savedNotesByTopic, setSavedNotesByTopic] = useState(() => { try { return JSON.parse(localStorage.getItem("savedNotesByTopic")) || {}; } catch { return {}; } });
  const [captureStatus, setCaptureStatus] = useState("Ready.");
  const [captureAiResult, setCaptureAiResult] = useState(null);
  const [isCaptureAnalyzing, setIsCaptureAnalyzing] = useState(false);
  const [wrongQuestionImageFile, setWrongQuestionImageFile] = useState(null);
  const [wrongQuestionImagePreview, setWrongQuestionImagePreview] = useState("");
  const [wrongQuestionOcrText, setWrongQuestionOcrText] = useState("");
  const [wrongQuestionDraftText, setWrongQuestionDraftText] = useState("");
  const [wrongQuestionStatus, setWrongQuestionStatus] = useState("Ready.");
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [wrongQuestionFlashcards, setWrongQuestionFlashcards] = useState(() => { try { return JSON.parse(localStorage.getItem("wrongQuestionFlashcards")) || []; } catch { return []; } });
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [expandedImage, setExpandedImage] = useState("");
  const [aiAnalysisResult, setAiAnalysisResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const currentTopicKey = useMemo(() => `${selectedDivision}::${selectedRoom}`, [selectedDivision, selectedRoom]);
  const savedNotesForTopic = useMemo(() => savedNotesByTopic[currentTopicKey] || [], [savedNotesByTopic, currentTopicKey]);

  useEffect(() => { const timer = setTimeout(() => setDebouncedCaptureDraft(captureDraft), 800); return () => clearTimeout(timer); }, [captureDraft]);
  useEffect(() => { setCaptureAiResult(null); }, [debouncedCaptureDraft]);
  useEffect(() => { setAiAnalysisResult(null); }, [wrongQuestionDraftText]);
  useEffect(() => { localStorage.setItem("savedNotesByTopic", JSON.stringify(savedNotesByTopic)); }, [savedNotesByTopic]);
  useEffect(() => { localStorage.setItem("wrongQuestionFlashcards", JSON.stringify(wrongQuestionFlashcards)); }, [wrongQuestionFlashcards]);

  const effectiveCaptureText = useMemo(() => {
    const saved = savedNotesForTopic.map(item => item.text).join("\n\n").trim();
    const draft = debouncedCaptureDraft.trim();
    return saved && draft ? `${saved}\n\n${draft}` : saved || draft || "";
  }, [savedNotesForTopic, debouncedCaptureDraft]);

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

  const handleSaveNote = () => {
    if (!captureDraft.trim()) { setCaptureStatus("Editor is empty."); return; }
    const newNote = { id: Date.now(), text: captureDraft.trim(), savedAt: new Date().toISOString() };
    setSavedNotesByTopic(prev => ({ ...prev, [currentTopicKey]: [...(prev[currentTopicKey] || []), newNote] }));
    setCaptureDraft(""); setCaptureStatus("Saved locally.");
  };

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

  // 极其稳固的滚动条样式
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
          <div className="room-list">{ROOMS_BY_DIVISION[selectedDivision].map(room => <button key={room} className={`room-pill ${selectedRoom === room ? "active" : ""}`} onClick={() => setSelectedRoom(room)}>{room}</button>)}</div>
        </div>
      </aside>

      <main className="main-workspace">
        <section className="workspace-card capture-workspace">
          <div className="workspace-header"><h2>Capture Notes</h2></div>
          <div className="panel"><textarea className="panel-textarea" value={captureDraft} onChange={e => setCaptureDraft(e.target.value)} placeholder="粘贴长笔记..." /></div>
          <div className="panel capture-controls">
            <div className="button-row"><button onClick={handleSaveNote}>Save Note</button><button onClick={() => setCaptureDraft("")}>Clear</button></div>
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
              <h3>Live Logic Image <span style={{fontSize:'12px', background: captureAiResult?'#dbeafe':'#f1f5f9', padding:'4px 8px', borderRadius:'12px'}}>{captureAiResult?"✨ AI Active":"⚙️ Local Active"}</span></h3>
              <div style={{ maxHeight: '600px', overflowY: 'auto', background: '#f8fafc', padding: '10px', borderRadius: '8px' }}>
                {captureLogicForest.length === 0 ? <div style={{color:'#64748b'}}>输入内容生成导图...</div> : <div className="logic-forest">{captureLogicForest.map((tree, i) => <div key={i} className="logic-tree-card"><LogicTreeNode tree={tree} /></div>)}</div>}
              </div>
            </div>
          </div>
        </section>

        {/* 错题区保持精简一致的结构 */}
        <section className="workspace-card wrong-question-workspace">
          <div className="workspace-header"><h2>Wrong Question Workspace</h2></div>
          <div className="workspace-grid">
            <div className="panel">
               <textarea className="panel-textarea wrong-question-textarea" value={wrongQuestionDraftText} onChange={e => setWrongQuestionDraftText(e.target.value)} placeholder="粘贴错题..." style={{minHeight: '200px'}}/>
            </div>
            <div className="panel wrong-question-analysis-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <h3 style={{margin:0}}>Analysis <span style={{fontSize:'12px', background: aiAnalysisResult?'#dbeafe':'#f1f5f9', padding:'4px 8px', borderRadius:'12px'}}>{aiAnalysisResult?"✨ AI Active":"⚙️ Local Active"}</span></h3>
                <button onClick={handleWrongQuestionRunAI} disabled={isAnalyzing} style={{ background: '#2563eb', color: 'white', padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}>{isAnalyzing ? "Thinking..." : "✨ Ask AI"}</button>
              </div>
              <div className="analysis-mini-grid">
                <div className="subcard"><div className="subcard-title">Summary</div><div style={scrollableStyle}>{wrongQuestionAnalysis.summary}</div></div>
                <div className="subcard"><div className="subcard-title">Answer Extraction</div><div style={scrollableStyle}><ul>{wrongQuestionAnalysis.answerExtraction.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div>
                <div className="subcard"><div className="subcard-title">Trap Point</div><div style={scrollableStyle}><ul>{wrongQuestionAnalysis.trapPoint.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div>
              </div>
              <div style={{color: '#10b981', marginTop: '10px'}}>{wrongQuestionStatus}</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
