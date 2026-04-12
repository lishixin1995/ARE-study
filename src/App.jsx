import { useEffect, useMemo, useState } from "react";
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
  return text
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

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
  const lower = text.toLowerCase();
  const points = [];

  if (lower.includes("active system")) {
    points.push("Active systems usually depend on equipment and direct control.");
  }

  if (lower.includes("passive system")) {
    points.push("Passive systems usually depend on climate, orientation, air, or sun.");
  }

  if (lower.includes("cold climate") || lower.includes("heat loss")) {
    points.push("Cold-climate strategies often start with reducing heat loss.");
  }

  if (lower.includes("hot climate") || lower.includes("heat gain")) {
    points.push("Hot-climate strategies often focus on controlling heat gain and ventilation.");
  }

  if (lower.includes("trombe wall")) {
    points.push("Trombe wall is a passive thermal strategy and needs space.");
  }

  if (points.length) return points;

  const extraction = buildCaptureExtraction(text);
  return extraction.slice(0, 3);
}

function buildCaptureLogicLinks(text) {
  const lower = text.toLowerCase();
  const links = [];

  if (
    lower.includes("passive system") ||
    lower.includes("sun") ||
    lower.includes("air") ||
    lower.includes("wind")
  ) {
    links.push("Passive System → depends on → Sun / Air / Wind");
  }

  if (lower.includes("active system") || lower.includes("mechanical equipment")) {
    links.push("Active System → relies on → Mechanical Equipment");
  }

  if (lower.includes("cold climate") || lower.includes("heat loss")) {
    links.push("Cold Climate → goal → Reduce Heat Loss");
  }

  if (lower.includes("hot climate") || lower.includes("heat gain")) {
    links.push("Hot Climate → goal → Control Heat Gain");
  }

  if (lower.includes("cold climate") && lower.includes("hot climate")) {
    links.push("Cold Climate ↔ contrasts with ↔ Hot Climate");
  }

  if (lower.includes("trombe wall")) {
    links.push("Trombe Wall → example of → Passive Strategy");
  }

  if (!links.length) {
    links.push("Start typing or save notes to generate logic links.");
  }

  return links;
}

function buildCaptureLogicGraph(text) {
  const lower = text.toLowerCase();
  const nodes = [];
  const edges = [];

  const addNode = (id, label) => {
    if (!nodes.find((node) => node.id === id)) {
      nodes.push({ id, label });
    }
  };

  const addEdge = (from, to, label) => {
    if (!edges.find((edge) => edge.from === from && edge.to === to && edge.label === label)) {
      edges.push({ from, to, label });
    }
  };

  if (lower.includes("passive system")) {
    addNode("passive", "Passive System");
  }

  if (lower.includes("sun")) {
    addNode("sun", "Sun");
    addNode("passive", "Passive System");
    addEdge("passive", "sun", "depends on");
  }

  if (lower.includes("air")) {
    addNode("air", "Air");
    addNode("passive", "Passive System");
    addEdge("passive", "air", "depends on");
  }

  if (lower.includes("wind")) {
    addNode("wind", "Wind");
    addNode("passive", "Passive System");
    addEdge("passive", "wind", "depends on");
  }

  if (lower.includes("active system") || lower.includes("mechanical equipment")) {
    addNode("active", "Active System");
    addNode("mechanical", "Mechanical Equipment");
    addEdge("active", "mechanical", "relies on");
  }

  if (lower.includes("cold climate") || lower.includes("heat loss")) {
    addNode("cold", "Cold Climate");
    addNode("heatloss", "Reduce Heat Loss");
    addEdge("cold", "heatloss", "goal");
  }

  if (lower.includes("hot climate") || lower.includes("heat gain")) {
    addNode("hot", "Hot Climate");
    addNode("heatgain", "Control Heat Gain");
    addEdge("hot", "heatgain", "goal");
  }

  if (lower.includes("trombe wall")) {
    addNode("trombe", "Trombe Wall");
    addNode("passiveStrategy", "Passive Strategy");
    addEdge("trombe", "passiveStrategy", "example of");
  }

  return { nodes, edges };
}

function readSavedNotesByTopic() {
  try {
    const raw = localStorage.getItem("savedNotesByTopic");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [selectedRoom, setSelectedRoom] = useState("Site");

  const [captureDraft, setCaptureDraft] = useState("");
  const [debouncedCaptureDraft, setDebouncedCaptureDraft] = useState("");
  const [savedNotesByTopic, setSavedNotesByTopic] = useState(() => readSavedNotesByTopic());
  const [captureStatus, setCaptureStatus] = useState("Ready.");

  const currentTopicKey = useMemo(() => {
    return `${selectedDivision}::${selectedRoom}`;
  }, [selectedDivision, selectedRoom]);

  const rooms = ROOMS_BY_DIVISION[selectedDivision] || [];

  const savedNotesForTopic = useMemo(() => {
    return savedNotesByTopic[currentTopicKey] || [];
  }, [savedNotesByTopic, currentTopicKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCaptureDraft(captureDraft);
    }, 1200);

    return () => clearTimeout(timer);
  }, [captureDraft]);

  useEffect(() => {
    localStorage.setItem("savedNotesByTopic", JSON.stringify(savedNotesByTopic));
  }, [savedNotesByTopic]);

  const savedTopicText = useMemo(() => {
    return savedNotesForTopic.map((item) => item.text).join("\n\n");
  }, [savedNotesForTopic]);

  const effectiveCaptureText = useMemo(() => {
    const saved = savedTopicText.trim();
    const draft = debouncedCaptureDraft.trim();

    if (saved && draft) return `${saved}\n\n${draft}`;
    if (saved) return saved;
    if (draft) return draft;
    return "";
  }, [savedTopicText, debouncedCaptureDraft]);

  const captureSummary = useMemo(() => {
    return buildCaptureSummary(effectiveCaptureText);
  }, [effectiveCaptureText]);

  const captureExtraction = useMemo(() => {
    return buildCaptureExtraction(effectiveCaptureText);
  }, [effectiveCaptureText]);

  const captureBulletPoints = useMemo(() => {
    return buildCaptureBulletPoints(effectiveCaptureText);
  }, [effectiveCaptureText]);

  const captureLogicLinks = useMemo(() => {
    return buildCaptureLogicLinks(effectiveCaptureText);
  }, [effectiveCaptureText]);

  const captureLogicGraph = useMemo(() => {
    return buildCaptureLogicGraph(effectiveCaptureText);
  }, [effectiveCaptureText]);

  const handleSaveNote = () => {
    const trimmed = captureDraft.trim();
    if (!trimmed) {
      setCaptureStatus("Capture editor is empty.");
      return;
    }

    const newNote = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      savedAt: new Date().toISOString()
    };

    setSavedNotesByTopic((prev) => {
      const current = prev[currentTopicKey] || [];
      return {
        ...prev,
        [currentTopicKey]: [...current, newNote]
      };
    });

    setCaptureDraft("");
    setDebouncedCaptureDraft("");
    setCaptureStatus(`Saved 1 note to ${currentTopicKey}.`);
  };

  const handleLoadSavedNotes = () => {
    if (!savedNotesForTopic.length) {
      setCaptureStatus(`No saved notes found for ${currentTopicKey}.`);
      return;
    }

    setCaptureStatus(
      `${currentTopicKey} already has ${savedNotesForTopic.length} saved notes. Current analysis is already using them.`
    );
  };

  const handleLoadTopicSample = () => {
    const sample = SAMPLE_BY_DIVISION[selectedDivision] || "";
    setCaptureDraft(sample);
    setCaptureStatus(`Loaded ${selectedDivision} sample. Analysis will update in about 1 second.`);
  };

  const handleClearEditor = () => {
    setCaptureDraft("");
    setDebouncedCaptureDraft("");
    setCaptureStatus("Capture editor cleared.");
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
              <button
                key={division}
                className={`nav-pill ${selectedDivision === division ? "active" : ""}`}
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

      <main className="main-workspace">
        <section className="workspace-card capture-workspace">
          <div className="workspace-header">
            <h2>Capture Notes Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span>
              <span>{selectedRoom}</span>
              <span>{currentTopicKey}</span>
              <span>Saved Notes: {savedNotesForTopic.length}</span>
            </div>
          </div>

          <div className="panel capture-editor-panel">
            <div className="panel-title">Capture Editor</div>
            <textarea
              className="panel-textarea"
              value={captureDraft}
              onChange={(e) => setCaptureDraft(e.target.value)}
              placeholder="这里记录视频笔记、手写整理后的文字、和我讨论后的重点。"
            />
          </div>

          <div className="panel capture-controls">
            <div className="panel-title">Capture Controls</div>
            <div className="button-row">
              <button onClick={handleSaveNote}>Save Note</button>
              <button onClick={handleLoadSavedNotes}>Load Saved Notes</button>
              <button onClick={handleLoadTopicSample}>
                Load {selectedDivision} Sample
              </button>
              <button onClick={handleClearEditor}>Clear Editor</button>
            </div>
            <div style={{ marginTop: 12 }}>{captureStatus}</div>
          </div>

          <div className="workspace-grid">
            <div className="panel capture-analysis-panel">
              <div className="panel-title">Capture Analysis</div>

              <div className="subcard">
                <div className="subcard-title">Summary</div>
                <p>{captureSummary}</p>
              </div>

              <div className="subcard">
                <div className="subcard-title">Extraction</div>
                <ul>
                  {captureExtraction.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="subcard">
                <div className="subcard-title">Bullet Points</div>
                <ul>
                  {captureBulletPoints.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="subcard">
                <div className="subcard-title">Logic Links</div>
                <ul>
                  {captureLogicLinks.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="panel live-logic-graph-panel">
              <div className="panel-title">Live Logic Image</div>

              {captureLogicGraph.nodes.length === 0 ? (
                <div className="logic-graph-placeholder">
                  Start typing or save notes in this topic to generate the logic graph.
                </div>
              ) : (
                <div>
                  <div className="subcard">
                    <div className="subcard-title">Nodes</div>
                    <div className="button-row">
                      {captureLogicGraph.nodes.map((node) => (
                        <button key={node.id} type="button">
                          {node.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="subcard">
                    <div className="subcard-title">Edges</div>
                    <ul>
                      {captureLogicGraph.edges.map((edge, index) => (
                        <li key={`${edge.from}-${edge.to}-${index}`}>
                          {edge.from} → {edge.label} → {edge.to}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="workspace-card wrong-question-workspace">
          <div className="workspace-header">
            <h2>Wrong Question Workspace</h2>
            <div className="workspace-meta">
              <span>{selectedDivision}</span>
              <span>{selectedRoom}</span>
            </div>
          </div>

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

          <div className="panel wrong-question-controls">
            <div className="panel-title">Wrong Question Controls</div>
            <div className="button-row">
              <button>Save Wrong Question</button>
              <button>Load Saved Flashcards</button>
              <button>Clear Wrong Question</button>
            </div>
          </div>

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
