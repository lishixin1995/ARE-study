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
  return (text || "")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(text) {
  return (text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function capitalizeWords(text) {
  return (text || "")
    .split(" ")
    .map((word) =>
      word ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ");
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
  const lower = (text || "").toLowerCase();
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

  if (lower.includes("envelope")) {
    points.push("Envelope design must coordinate water, air, vapor, and thermal control.");
  }

  if (lower.includes("documentation")) {
    points.push("Documentation should coordinate dimensions, assemblies, and specifications clearly.");
  }

  if (points.length) return points;

  const extraction = buildCaptureExtraction(text);
  return extraction.slice(0, 3);
}

function buildCaptureLogicLinks(text) {
  const lower = (text || "").toLowerCase();
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

  if (lower.includes("envelope detailing")) {
    links.push("Envelope Detailing → controls → Water / Air / Vapor / Thermal Transfer");
  }

  if (lower.includes("material selection")) {
    links.push("Material Selection → affects → Durability / Constructability / Maintenance");
  }

  if (lower.includes("documentation")) {
    links.push("Documentation → coordinates → Assemblies / Dimensions / Specifications");
  }

  if (!links.length) {
    links.push("Start typing or save notes to generate logic links.");
  }

  return links;
}

function node(label, relation = null, children = []) {
  return { label, relation, children };
}

function buildCaptureLogicForest(text) {
  const lower = (text || "").toLowerCase();
  const trees = [];

  const systemsChildren = [];

  if (lower.includes("active system") || lower.includes("mechanical equipment")) {
    const activeChildren = [];

    if (lower.includes("mechanical equipment")) {
      activeChildren.push(node("Mechanical Equipment", "relies on"));
    }

    if (lower.includes("more energy") || lower.includes("energy")) {
      activeChildren.push(node("Higher Energy Use", "effect"));
    }

    systemsChildren.push(node("Active System", "category", activeChildren));
  }

  if (
    lower.includes("passive system") ||
    lower.includes("sun") ||
    lower.includes("air") ||
    lower.includes("wind")
  ) {
    const passiveChildren = [];

    if (lower.includes("sun")) passiveChildren.push(node("Sun", "depends on"));
    if (lower.includes("air")) passiveChildren.push(node("Air", "depends on"));
    if (lower.includes("wind")) passiveChildren.push(node("Wind", "depends on"));

    systemsChildren.push(node("Passive System", "category", passiveChildren));
  }

  if (systemsChildren.length) {
    trees.push(node("Building Systems", null, systemsChildren));
  }

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

  if (climateChildren.length) {
    trees.push(node("Climate Strategy", null, climateChildren));
  }

  const exampleChildren = [];

  if (lower.includes("trombe wall")) {
    const trombeChildren = [];
    if (lower.includes("stabilize temperature")) {
      trombeChildren.push(node("Stabilize Temperature", "effect"));
    }
    if (lower.includes("more space") || lower.includes("takes more space")) {
      trombeChildren.push(node("Takes More Space", "tradeoff"));
    }
    exampleChildren.push(node("Trombe Wall", "example", trombeChildren));
  }

  if (exampleChildren.length) {
    trees.push(node("Examples / Tradeoffs", null, exampleChildren));
  }

  const envelopeChildren = [];

  if (lower.includes("envelope detailing")) {
    const detailChildren = [];
    if (lower.includes("water")) detailChildren.push(node("Water", "controls"));
    if (lower.includes("air")) detailChildren.push(node("Air", "controls"));
    if (lower.includes("vapor")) detailChildren.push(node("Vapor", "controls"));
    if (lower.includes("thermal transfer")) {
      detailChildren.push(node("Thermal Transfer", "controls"));
    }
    envelopeChildren.push(node("Envelope Detailing", "category", detailChildren));
  }

  if (lower.includes("material selection")) {
    const materialChildren = [];
    if (lower.includes("durability")) materialChildren.push(node("Durability", "affects"));
    if (lower.includes("constructability")) {
      materialChildren.push(node("Constructability", "affects"));
    }
    if (lower.includes("maintenance")) materialChildren.push(node("Maintenance", "affects"));
    envelopeChildren.push(node("Material Selection", "category", materialChildren));
  }

  if (lower.includes("documentation")) {
    const documentationChildren = [];
    if (lower.includes("assemblies")) documentationChildren.push(node("Assemblies", "coordinates"));
    if (lower.includes("dimensions")) documentationChildren.push(node("Dimensions", "coordinates"));
    if (lower.includes("specifications")) {
      documentationChildren.push(node("Specifications", "coordinates"));
    }
    envelopeChildren.push(node("Documentation", "category", documentationChildren));
  }

  if (envelopeChildren.length) {
    trees.push(node("Envelope / Documentation", null, envelopeChildren));
  }

  if (!trees.length) {
    const fallbackLines = buildCaptureExtraction(text).slice(0, 3);
    trees.push(
      node(
        "Key Concepts",
        null,
        fallbackLines.map((line) => node(line, "note"))
      )
    );
  }

  return trees;
}

function parseCorrectAnswer(text) {
  const match = (text || "").match(/correct answer\s*[:\-]\s*(.+)/i);
  if (!match) return null;

  const raw = match[1].trim();
  if (!raw) return null;

  if (raw.includes("/") || raw.includes(",")) {
    return raw
      .split(/[\/,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return raw;
}

function buildWrongQuestionQuestionText(text) {
  const lines = splitLines(text).filter(
    (line) =>
      !/^correct answer[:\-]/i.test(line) &&
      !/^summary[:\-]/i.test(line) &&
      !/^trap point[:\-]/i.test(line) &&
      !/^memory hook[:\-]/i.test(line) &&
      !/^reference[:\-]/i.test(line)
  );

  if (!lines.length) return "No question text yet.";

  return lines.slice(0, 6).join(" ");
}

function buildWrongQuestionSummary(text) {
  const sentences = splitSentences(text);
  if (sentences.length >= 2) return `${sentences[0]} ${sentences[1]}`;
  if (sentences.length === 1) return sentences[0];
  return "No wrong-question content yet.";
}

function buildWrongQuestionCorrectAnswer(text) {
  const parsed = parseCorrectAnswer(text);
  if (parsed) return parsed;
  return "Not detected yet. Add a line like: Correct Answer: ...";
}

function buildWrongQuestionAnswerExtraction(text) {
  const lower = (text || "").toLowerCase();

  if (lower.includes("concrete") && lower.includes("cement") && lower.includes("sand")) {
    return [
      "Concrete is the final composite material.",
      "Cement acts as the binder in the mix.",
      "Sand is the fine aggregate used in the mixture."
    ];
  }

  if (lower.includes("fabrication")) {
    return [
      "The question is asking about manufacturing a component.",
      "Fabrication happens before delivery and installation on site.",
      "This is about production, not on-site placement."
    ];
  }

  const lines = splitLines(text).filter(
    (item) =>
      !/^question[:\-]/i.test(item) &&
      !/^correct answer[:\-]/i.test(item)
  );

  if (lines.length >= 3) return lines.slice(0, 3);

  const sentences = splitSentences(text);
  if (sentences.length >= 3) return sentences.slice(0, 3);

  return ["Add more wrong-question notes to generate answer extraction."];
}

function buildWrongQuestionTrapPoint(text) {
  const lower = (text || "").toLowerCase();

  if (lower.includes("concrete") && lower.includes("cement") && lower.includes("sand")) {
    return [
      "Mortar is tempting because it also contains cement and sand, but it is not the same as concrete.",
      "Grout is wrong because it has a different purpose and composition."
    ];
  }

  if (lower.includes("fabrication")) {
    return [
      "Installation is wrong because it refers to placing a finished component on site.",
      "Assembly is tempting, but it refers to joining parts rather than manufacturing the component itself."
    ];
  }

  return [
    "Watch for answer choices that sound related but describe a different stage, material, or concept.",
    "If two terms look similar, compare their exact role instead of choosing the more familiar word."
  ];
}

function buildWrongQuestionMemoryHook(text) {
  const lower = (text || "").toLowerCase();

  if (lower.includes("concrete") && lower.includes("cement") && lower.includes("sand")) {
    return "When material terms look similar, separate the binder, aggregate, and final composite first.";
  }

  if (lower.includes("fabrication")) {
    return "Do not confuse making a component with installing it.";
  }

  return "Before choosing, ask what the question is really testing: material, process, system, or code idea.";
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

function readSavedNotesByTopic() {
  try {
    const raw = localStorage.getItem("savedNotesByTopic");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function readWrongQuestionFlashcards() {
  try {
    const raw = localStorage.getItem("wrongQuestionFlashcards");
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function formatSavedAt(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString()}`;
}

function LogicTreeNode({ tree, depth = 0 }) {
  return (
    <div className={`logic-tree-level depth-${depth}`}>
      <div className="logic-tree-row">
        {tree.relation ? (
          <span className={`logic-relation-pill relation-${tree.relation.replace(/\s+/g, "-")}`}>
            {capitalizeWords(tree.relation)}
          </span>
        ) : null}

        <div className={`logic-node-card ${depth === 0 ? "root" : ""}`}>
          {tree.label}
        </div>
      </div>

      {tree.children?.length ? (
        <div className="logic-children">
          {tree.children.map((child, index) => (
            <LogicTreeNode key={`${child.label}-${index}`} tree={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
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

  const [wrongQuestionImageFile, setWrongQuestionImageFile] = useState(null);
  const [wrongQuestionImagePreview, setWrongQuestionImagePreview] = useState("");
  const [wrongQuestionOcrText, setWrongQuestionOcrText] = useState("");
  const [wrongQuestionDraftText, setWrongQuestionDraftText] = useState("");
  const [wrongQuestionStatus, setWrongQuestionStatus] = useState("Ready.");
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [wrongQuestionFlashcards, setWrongQuestionFlashcards] = useState(() =>
    readWrongQuestionFlashcards()
  );
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [expandedImage, setExpandedImage] = useState("");

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

  useEffect(() => {
    localStorage.setItem(
      "wrongQuestionFlashcards",
      JSON.stringify(wrongQuestionFlashcards)
    );
  }, [wrongQuestionFlashcards]);

  useEffect(() => {
    if (flashcardIndex > wrongQuestionFlashcards.length - 1) {
      setFlashcardIndex(Math.max(0, wrongQuestionFlashcards.length - 1));
    }
  }, [wrongQuestionFlashcards, flashcardIndex]);

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

  const captureLogicForest = useMemo(() => {
    return buildCaptureLogicForest(effectiveCaptureText);
  }, [effectiveCaptureText]);

  const wrongQuestionAnalysis = useMemo(() => {
    return buildWrongQuestionAnalysis(wrongQuestionDraftText);
  }, [wrongQuestionDraftText]);

  const currentFlashcard = wrongQuestionFlashcards[flashcardIndex] || null;

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

  const handleWrongQuestionImageChange = (event) => {
    const file = event.target.files?.[0] || null;

    if (!file) {
      setWrongQuestionImageFile(null);
      setWrongQuestionImagePreview("");
      setWrongQuestionStatus("No image selected.");
      return;
    }

    setWrongQuestionImageFile(file);
    setWrongQuestionStatus(`Selected image: ${file.name}`);

    const reader = new FileReader();
    reader.onloadend = () => {
      setWrongQuestionImagePreview(
        typeof reader.result === "string" ? reader.result : ""
      );
    };
    reader.readAsDataURL(file);
  };

  const handleRunOcr = async () => {
    if (!wrongQuestionImageFile) {
      setWrongQuestionStatus("Please select an image first.");
      return;
    }

    try {
      setIsRunningOcr(true);
      setWrongQuestionStatus("Reading image text...");

      const result = await Tesseract.recognize(wrongQuestionImageFile, "eng");
      const extractedText = result?.data?.text?.trim() || "";

      if (!extractedText) {
        setWrongQuestionStatus("No text detected from this image.");
        return;
      }

      setWrongQuestionOcrText(extractedText);
      setWrongQuestionDraftText(extractedText);
      setWrongQuestionStatus("OCR completed. Text has been added to Wrong Question Text.");
    } catch (error) {
      console.error(error);
      setWrongQuestionStatus("OCR failed. Try another image.");
    } finally {
      setIsRunningOcr(false);
    }
  };

  const handleSaveWrongQuestion = () => {
    const trimmed = wrongQuestionDraftText.trim();

    if (!trimmed) {
      setWrongQuestionStatus("Wrong Question Text is empty.");
      return;
    }

    const newCard = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      topicKey: currentTopicKey,
      imagePreview: wrongQuestionImagePreview,
      ocrText: wrongQuestionOcrText,
      editedText: trimmed,
      questionText: wrongQuestionAnalysis.questionText,
      summary: wrongQuestionAnalysis.summary,
      correctAnswer: wrongQuestionAnalysis.correctAnswer,
      answerExtraction: wrongQuestionAnalysis.answerExtraction,
      trapPoint: wrongQuestionAnalysis.trapPoint,
      memoryHook: wrongQuestionAnalysis.memoryHook,
      savedAt: new Date().toISOString()
    };

    setWrongQuestionFlashcards((prev) => [newCard, ...prev]);
    setFlashcardIndex(0);
    setWrongQuestionStatus("Wrong question saved as flashcard.");
  };

  const handleLoadSavedFlashcards = () => {
    const loaded = readWrongQuestionFlashcards();
    setWrongQuestionFlashcards(loaded);
    setFlashcardIndex(0);
    setWrongQuestionStatus(`Loaded ${loaded.length} saved flashcards.`);
  };

  const handleClearWrongQuestion = () => {
    setWrongQuestionImageFile(null);
    setWrongQuestionImagePreview("");
    setWrongQuestionOcrText("");
    setWrongQuestionDraftText("");
    setWrongQuestionStatus("Wrong question workspace cleared.");
  };

  const handlePrevFlashcard = () => {
    setFlashcardIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextFlashcard = () => {
    setFlashcardIndex((prev) =>
      Math.min(wrongQuestionFlashcards.length - 1, prev + 1)
    );
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

              <div className="subcard compact-subcard">
                <div className="subcard-title">Summary</div>
                <p>{captureSummary}</p>
              </div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Extraction</div>
                <ul>
                  {captureExtraction.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Bullet Points</div>
                <ul>
                  {captureBulletPoints.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="subcard compact-subcard">
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

              {captureLogicForest.length === 0 ? (
                <div className="logic-graph-placeholder">
                  Start typing or save notes in this topic to generate the logic graph.
                </div>
              ) : (
                <div className="logic-forest">
                  {captureLogicForest.map((tree, index) => (
                    <div key={`${tree.label}-${index}`} className="logic-tree-card">
                      <LogicTreeNode tree={tree} />
                    </div>
                  ))}
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
              <span>{currentTopicKey}</span>
              <span>Flashcards: {wrongQuestionFlashcards.length}</span>
            </div>
          </div>

          <div className="workspace-grid">
            <div className="panel wrong-question-input-panel">
              <div className="panel-title">Wrong Question Input</div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Image Upload</div>
                {wrongQuestionImagePreview ? (
                  <img
                    src={wrongQuestionImagePreview}
                    alt="Wrong question preview"
                    className="image-preview"
                  />
                ) : (
                  <div className="image-placeholder">Image Preview</div>
                )}

                <div className="button-row wrongq-button-row" style={{ marginTop: 12 }}>
                  <label className="nav-pill upload-nav-pill">
                    Upload Image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleWrongQuestionImageChange}
                      hidden
                    />
                  </label>

                  <button
                    className="nav-pill nav-action-pill"
                    onClick={handleRunOcr}
                    disabled={isRunningOcr}
                    type="button"
                  >
                    {isRunningOcr ? "Running OCR..." : "Run OCR"}
                  </button>
                </div>
              </div>

              <div className="subcard compact-subcard">
                <div className="subcard-title">Wrong Question Text</div>
                <textarea
                  className="panel-textarea wrong-question-textarea"
                  value={wrongQuestionDraftText}
                  onChange={(e) => setWrongQuestionDraftText(e.target.value)}
                  placeholder="这里输入错题内容，或者让 OCR 结果填进来。"
                />
              </div>
            </div>

            <div className="panel wrong-question-analysis-panel">
              <div className="panel-title">Wrong Question Analysis</div>

              <div className="analysis-mini-grid">
                <div className="subcard compact-subcard">
                  <div className="subcard-title">Summary</div>
                  <p>{wrongQuestionAnalysis.summary}</p>
                </div>

                <div className="subcard compact-subcard">
                  <div className="subcard-title">Correct Answer</div>
                  {Array.isArray(wrongQuestionAnalysis.correctAnswer) ? (
                    <p>{wrongQuestionAnalysis.correctAnswer.join(" / ")}</p>
                  ) : (
                    <p>{wrongQuestionAnalysis.correctAnswer}</p>
                  )}
                </div>

                <div className="subcard compact-subcard analysis-span-2">
                  <div className="subcard-title">Answer Extraction</div>
                  <ul>
                    {wrongQuestionAnalysis.answerExtraction.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="subcard compact-subcard">
                  <div className="subcard-title">Trap Point</div>
                  <ul>
                    {wrongQuestionAnalysis.trapPoint.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="subcard compact-subcard">
                  <div className="subcard-title">Memory Hook</div>
                  <p>{wrongQuestionAnalysis.memoryHook}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="panel wrong-question-controls">
            <div className="panel-title">Wrong Question Controls</div>
            <div className="button-row">
              <button onClick={handleSaveWrongQuestion}>Save Wrong Question</button>
              <button onClick={handleLoadSavedFlashcards}>Load Saved Flashcards</button>
              <button onClick={handleClearWrongQuestion}>Clear Wrong Question</button>
            </div>
            <div style={{ marginTop: 12 }}>{wrongQuestionStatus}</div>
          </div>

          <div className="panel flashcard-panel">
            <div className="panel-title">Wrong Question Flashcards</div>

            {wrongQuestionFlashcards.length === 0 ? (
              <div className="flashcard-placeholder">
                No saved flashcards yet.
              </div>
            ) : (
              <div className="flashcard-carousel">
                <div className="flashcard-carousel-header">
                  <button
                    onClick={handlePrevFlashcard}
                    disabled={flashcardIndex === 0}
                  >
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
                  <div className="flashcard-slide">
                    <div className="flashcard-slide-top">
                      <div className="flashcard-meta">
                        {currentFlashcard.topicKey} · {formatSavedAt(currentFlashcard.savedAt)}
                      </div>

                      {currentFlashcard.imagePreview ? (
                        <div className="flashcard-thumb-wrap">
                          <img
                            src={currentFlashcard.imagePreview}
                            alt="Wrong question thumbnail"
                            className="flashcard-thumb"
                            onClick={() => setExpandedImage(currentFlashcard.imagePreview)}
                          />
                          <button
                            className="tiny-link-btn"
                            onClick={() => setExpandedImage(currentFlashcard.imagePreview)}
                          >
                            View Image
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="flashcard-question">
                      <div className="subcard-title">Question</div>
                      <p>{currentFlashcard.questionText}</p>
                    </div>

                    <div className="flashcard-detail-grid">
                      <div className="subcard compact-subcard">
                        <div className="subcard-title">Correct Answer</div>
                        {Array.isArray(currentFlashcard.correctAnswer) ? (
                          <p>{currentFlashcard.correctAnswer.join(" / ")}</p>
                        ) : (
                          <p>{currentFlashcard.correctAnswer}</p>
                        )}
                      </div>

                      <div className="subcard compact-subcard">
                        <div className="subcard-title">Memory Hook</div>
                        <p>{currentFlashcard.memoryHook}</p>
                      </div>

                      <div className="subcard compact-subcard analysis-span-2">
                        <div className="subcard-title">Answer Extraction</div>
                        <ul>
                          {currentFlashcard.answerExtraction.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="subcard compact-subcard analysis-span-2">
                        <div className="subcard-title">Trap Point</div>
                        <ul>
                          {currentFlashcard.trapPoint.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
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
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setExpandedImage("")}>
              ×
            </button>
            <img src={expandedImage} alt="Expanded wrong question" className="image-modal-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
