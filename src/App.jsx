import { useMemo, useState } from "react";
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

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [selectedRoom, setSelectedRoom] = useState("Site");

  const currentTopicKey = useMemo(() => {
    return `${selectedDivision}::${selectedRoom}`;
  }, [selectedDivision, selectedRoom]);

  const rooms = ROOMS_BY_DIVISION[selectedDivision] || [];

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-title">ARE Study Vault</div>
          <div className="brand-subtitle">空间结构 + 自动分块</div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Memory Palace</div>
          <div className="division-list">
            {DIVISIONS.map((division) => (
              <button
                key={division}
                className={`nav-pill ${
                  selectedDivision === division ? "active" : ""
                }`}
                onClick={() => {
                  setSelectedDivision(division);
                  setSelectedRoom(ROOMS_BY_DIVISION[division][0]);
                }}
              >
                {division}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">{selectedDivision} Rooms</div>
          <div className="room-list">
            {rooms.map((room) => (
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

      {/* Main Workspace */}
      <main className="main-workspace">
        {/* Capture Notes Workspace */}
        <section className="workspace-card capture-workspace">
          <div className="workspace-header">
            <h2>Capture Notes Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span>
              <span>{selectedRoom}</span>
              <span>{currentTopicKey}</span>
            </div>
          </div>

          {/* Capture Editor Panel */}
          <div className="panel capture-editor-panel">
            <div className="panel-title">Capture Editor</div>
            <textarea
              className="panel-textarea"
              placeholder="这里记录视频笔记、手写整理后的文字、和我讨论后的重点。"
            />
          </div>

          {/* Capture Controls */}
          <div className="panel capture-controls">
            <div className="panel-title">Capture Controls</div>
            <div className="button-row">
              <button>Save Note</button>
              <button>Load Saved Notes</button>
              <button>Load Topic Sample</button>
              <button>Clear Editor</button>
            </div>
          </div>

          {/* Capture Analysis */}
          <div className="workspace-grid">
            <div className="panel capture-analysis-panel">
              <div className="panel-title">Capture Analysis</div>

              <div className="subcard">
                <div className="subcard-title">Summary</div>
                <p>这里以后显示当前 topic 下全部已保存 notes 的 summary。</p>
              </div>

              <div className="subcard">
                <div className="subcard-title">Extraction</div>
                <p>这里以后显示 extraction。</p>
              </div>

              <div className="subcard">
                <div className="subcard-title">Bullet Points</div>
                <ul>
                  <li>这里以后显示 bullet points。</li>
                </ul>
              </div>

              <div className="subcard">
                <div className="subcard-title">Logic Links</div>
                <ul>
                  <li>这里以后显示逻辑关系。</li>
                </ul>
              </div>
            </div>

            {/* Live Logic Graph */}
            <div className="panel live-logic-graph-panel">
              <div className="panel-title">Live Logic Image</div>
              <div className="logic-graph-placeholder">
                这里以后放动态逻辑推导图
              </div>
            </div>
          </div>
        </section>

        {/* Wrong Question Workspace */}
        <section className="workspace-card wrong-question-workspace">
          <div className="workspace-header">
            <h2>Wrong Question Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span>
              <span>{selectedRoom}</span>
            </div>
          </div>

          {/* Wrong Question Input */}
          <div className="workspace-grid">
            <div className="panel wrong-question-input-panel">
              <div className="panel-title">Wrong Question Input</div>

              <div className="subcard">
                <div className="subcard-title">Image Upload</div>
                <div className="image-placeholder">Image Preview</div>
                <div className="button-row">
                  <button>Upload Image</button>
                  <button>Run OCR</button>
                </div>
              </div>

              <div className="subcard">
                <div className="subcard-title">Wrong Question Text</div>
                <textarea
                  className="panel-textarea"
                  placeholder="这里输入错题内容，或者让 OCR 结果填进来。"
                />
              </div>
            </div>

            {/* Wrong Question Analysis */}
            <div className="panel wrong-question-analysis-panel">
              <div className="panel-title">Wrong Question Analysis</div>

              <div className="subcard">
                <div className="subcard-title">Summary</div>
                <p>这里以后显示错题 summary。</p>
              </div>

              <div className="subcard">
                <div className="subcard-title">Correct Answer</div>
                <p>这里以后显示正确答案。</p>
              </div>

              <div className="subcard">
                <div className="subcard-title">Answer Extraction</div>
                <p>这里以后显示答案提取。</p>
              </div>

              <div className="subcard">
                <div className="subcard-title">Trap Point</div>
                <p>这里以后显示错因分析。</p>
              </div>

              <div className="subcard">
                <div className="subcard-title">Memory Hook</div>
                <p>这里以后显示记忆提醒。</p>
              </div>
            </div>
          </div>

          {/* Wrong Question Controls */}
          <div className="panel wrong-question-controls">
            <div className="panel-title">Wrong Question Controls</div>
            <div className="button-row">
              <button>Save Wrong Question</button>
              <button>Load Saved Flashcards</button>
              <button>Clear Wrong Question</button>
            </div>
          </div>

          {/* Flashcard Panel */}
          <div className="panel flashcard-panel">
            <div className="panel-title">Wrong Question Flashcards</div>
            <div className="flashcard-placeholder">
              这里以后显示保存后的错题 flashcards
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
