import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
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

const DEFAULT_NOTES = `Building system: 
1. Active system relies on mechanical equipment and uses more energy.
2. Passive system depends on sun, air, and wind flow. It has less direct control, but can improve sustainability.

In cold climates, reduce heat loss, block cold wind, and gain more solar energy.
In hot climates, control heat gain, provide shading, and improve natural ventilation.

Passive solar heating can use direct gain, thermal mass, and shading control at night.
Concrete and stone can store heat.
Trombe walls provide stable indoor temperature, but take up more space.`;

const QUESTION_SAMPLE = `Question:
Which material term should be identified as the final composite material in a basic concrete mixture?

Correct Answer: concrete / cement / sand

Notes:
Concrete is the final composite material.
Cement is the binder in the mix.
Sand is the fine aggregate.
Mortar is similar in ingredients, but it is not the same as concrete.
Grout has a different purpose and composition.`;

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emphasizeKeywords(text, keywords = [], mode = "bold") {
  if (!text) return "";

  let output = text;
  const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);

  sortedKeywords.forEach((keyword) => {
    if (!keyword || !keyword.trim()) return;

    const pattern = new RegExp(`\\b(${escapeRegExp(keyword)})\\b`, "gi");

    output = output.replace(pattern, (match) => {
      if (mode === "underline") {
        return `<u>${match}</u>`;
      }
      return `**${match}**`;
    });
  });

  return output;
}

function MarkdownText({ text }) {
  return (
    <ReactMarkdown rehypePlugins={[rehypeRaw]}>
      {text}
    </ReactMarkdown>
  );
}

function cleanText(text) {
  return text.replace(/\r/g, "").trim();
}

function splitSentences(text) {
  return cleanText(text)
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(text) {
  return cleanText(text)
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function detectKeywords(text) {
  const bank = [
    "active system",
    "passive system",
    "mechanical equipment",
    "energy",
    "solar",
    "sun",
    "wind",
    "air",
    "natural ventilation",
    "daylight",
    "shading",
    "heat loss",
    "heat gain",
    "thermal mass",
    "concrete",
    "cement",
    "sand",
    "mortar",
    "grout",
    "binder",
    "aggregate",
    "final composite",
    "fabrication",
    "installation",
    "assembly",
    "production",
    "trombe wall",
    "stone",
    "curtain wall",
    "code minimum",
    "best practice"
  ];

  const lower = text.toLowerCase();

  return bank.filter((item) => lower.includes(item.toLowerCase()));
}

function parseCorrectAnswer(text) {
  const match = text.match(/correct answer\s*[:\-]\s*(.+)/i);
  if (!match) return null;

  const raw = match[1].trim();

  if (raw.includes("/") || raw.includes(",")) {
    return raw
      .split(/[\/,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return raw;
}

function buildAnswerExtraction(text) {
  const sentences = splitSentences(text);

  if (sentences.length >= 3) {
    return sentences.slice(0, 3);
  }

  const lines = splitLines(text);
  if (lines.length >= 3) {
    return lines.slice(0, 3);
  }

  if (lines.length > 0) return lines;

  return [
    "Identify the core concept first.",
    "Separate similar-looking technical terms.",
    "Use the wording in the prompt to eliminate close distractors."
  ];
}

function buildTrapPoints(text) {
  const lower = text.toLowerCase();

  if (
    lower.includes("concrete") &&
    lower.includes("cement") &&
    lower.includes("sand")
  ) {
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

  if (lower.includes("active system") || lower.includes("passive system")) {
    return [
      "Do not confuse passive strategies with mechanical control systems.",
      "A term can sound energy-related and still belong to a different system category."
    ];
  }

  return [
    "Watch for answer choices that sound related but happen at a different stage.",
    "Eliminate options that describe a similar process rather than the exact concept asked in the prompt."
  ];
}

function buildMemoryHook(text) {
  const lower = text.toLowerCase();

  if (
    lower.includes("concrete") &&
    lower.includes("cement") &&
    lower.includes("sand")
  ) {
    return "When material terms look similar, separate the binder, aggregate, and final composite first.";
  }

  if (lower.includes("fabrication")) {
    return "Do not confuse making a component with installing it.";
  }

  if (lower.includes("active system") || lower.includes("passive system")) {
    return "When systems are easy to mix up, first ask whether the strategy depends on equipment or climate.";
  }

  if (lower.includes("code minimum") || lower.includes("best practice")) {
    return "For code questions, separate minimum requirement from best-practice language first.";
  }

  return "Start by identifying the exact concept the prompt is testing before comparing similar terms.";
}

function buildLogicLinks(text) {
  const lower = text.toLowerCase();
  const links = [];

  if (
    lower.includes("active system") ||
    lower.includes("mechanical equipment")
  ) {
    links.push("Active system depends on mechanical equipment and usually uses more energy.");
  }

  if (
    lower.includes("passive system") ||
    lower.includes("sun") ||
    lower.includes("wind") ||
    lower.includes("natural ventilation")
  ) {
    links.push("Passive strategy depends on sun, air, wind, shading, or building form rather than heavy equipment.");
  }

  if (lower.includes("concrete") || lower.includes("stone") || lower.includes("thermal mass")) {
    links.push("Concrete, stone, and thermal mass connect to heat storage and delayed temperature change.");
  }

  if (lower.includes("heat gain") || lower.includes("shading")) {
    links.push("Heat gain control and shading usually work together in hot-climate strategies.");
  }

  if (lower.includes("heat loss") || lower.includes("cold")) {
    links.push("Cold-climate design usually prioritizes reducing heat loss before adding more systems.");
  }

  if (links.length === 0) {
    links.push("Ask what the system relies on first: equipment, climate, material behavior, or code logic.");
  }

  return links;
}

function buildSummary(text) {
  const sentences = splitSentences(text);

  if (sentences.length >= 2) {
    return `${sentences[0]} ${sentences[1]}`;
  }

  if (sentences.length === 1) {
    return sentences[0];
  }

  return "Add notes or paste a question to generate a summary.";
}

function buildKeyPoints(text) {
  const lines = splitLines(text);

  const filtered = lines.filter(
    (item) =>
      !/^question[:\-]/i.test(item) &&
      !/^correct answer[:\-]/i.test(item) &&
      !/^notes[:\-]/i.test(item)
  );

  if (filtered.length >= 4) {
    return filtered.slice(0, 4);
  }

  const sentences = splitSentences(text);
  if (sentences.length >= 4) {
    return sentences.slice(0, 4);
  }

  return filtered.length ? filtered : ["Add more study notes to generate key points."];
}

function buildSystemCards(text) {
  const lower = text.toLowerCase();
  let activeSystem =
    "Mechanical equipment, direct control, and higher energy use usually indicate an active system.";
  let passiveSystem =
    "Sun, wind, daylight, shading, airflow, and thermal mass usually indicate a passive system.";

  const sentences = splitSentences(text);

  const activeMatch = sentences.find(
    (item) =>
      item.toLowerCase().includes("active system") ||
      item.toLowerCase().includes("mechanical")
  );

  const passiveMatch = sentences.find(
    (item) =>
      item.toLowerCase().includes("passive system") ||
      item.toLowerCase().includes("ventilation") ||
      item.toLowerCase().includes("shading") ||
      item.toLowerCase().includes("solar")
  );

  if (activeMatch) activeSystem = activeMatch;
  if (passiveMatch) passiveSystem = passiveMatch;

  if (!lower.includes("active") && !lower.includes("passive")) {
    activeSystem =
      "Use this card for equipment-driven concepts such as HVAC, fans, pumps, and controlled mechanical systems.";
    passiveSystem =
      "Use this card for climate-responsive concepts such as orientation, shading, ventilation, and thermal mass.";
  }

  return { activeSystem, passiveSystem };
}

function buildReview(text) {
  const correctAnswer = parseCorrectAnswer(text);
  const answerExtraction = buildAnswerExtraction(text);
  const trapPoints = buildTrapPoints(text);
  const memoryHook = buildMemoryHook(text);
  const keywords = detectKeywords(text);

  return {
    correctAnswer:
      correctAnswer ||
      "No direct question detected yet. Paste a question with “Correct Answer:” to fill this block cleanly.",
    answerExtraction,
    trapPoints,
    memoryHook,
    keywords
  };
}

function buildStudyData(text) {
  const summary = buildSummary(text);
  const keyPoints = buildKeyPoints(text);
  const { activeSystem, passiveSystem } = buildSystemCards(text);
  const logicLinks = buildLogicLinks(text);
  const review = buildReview(text);

  return {
    summary,
    keyPoints,
    activeSystem,
    passiveSystem,
    logicLinks,
    review
  };
}

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [selectedRoom, setSelectedRoom] = useState("Site");
  const [captureText, setCaptureText] = useState(DEFAULT_NOTES);
  const [savedNote, setSavedNote] = useState("");
  const [statusMessage, setStatusMessage] = useState("Ready.");
  const [emphasisMode, setEmphasisMode] = useState("bold");
  const [imageFile, setImageFile] = useState(null);
  const [isScanning, setIsScanning] = useState(false);

  const rooms = ROOMS_BY_DIVISION[selectedDivision] || [];

  const studyData = useMemo(() => buildStudyData(captureText), [captureText]);

  const correctAnswerDisplay = useMemo(() => {
    const value = studyData.review.correctAnswer;

    if (Array.isArray(value)) {
      return value.join(" / ");
    }

    return value;
  }, [studyData]);

  const emphasizedSummary = emphasizeKeywords(
    studyData.summary,
    studyData.review.keywords,
    emphasisMode
  );

  const emphasizedCorrectAnswer = emphasizeKeywords(
    correctAnswerDisplay,
    studyData.review.keywords,
    emphasisMode
  );

  const saveNote = () => {
    localStorage.setItem("are-study-note", captureText);
    setSavedNote(captureText);
    setStatusMessage("Note saved in browser.");
  };

  const loadSavedNote = () => {
    const note = localStorage.getItem("are-study-note");
    if (!note) {
      setStatusMessage("No saved note found yet.");
      return;
    }
    setCaptureText(note);
    setSavedNote(note);
    setStatusMessage("Saved note loaded.");
  };

  const loadStudySample = () => {
    setCaptureText(DEFAULT_NOTES);
    setStatusMessage("PPD study sample loaded.");
  };

  const loadQuestionSample = () => {
    setCaptureText(QUESTION_SAMPLE);
    setStatusMessage("Question sample loaded.");
  };

  const clearAll = () => {
    setCaptureText("");
    setStatusMessage("Capture cleared.");
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0] || null;
    setImageFile(file);
    if (file) {
      setStatusMessage(`Selected image: ${file.name}`);
    }
  };

  const runOCR = async () => {
    if (!imageFile) {
      setStatusMessage("Select an image first.");
      return;
    }

    try {
      setIsScanning(true);
      setStatusMessage("Reading image text...");
      const result = await Tesseract.recognize(imageFile, "eng");
      const extracted = result?.data?.text || "";

      setCaptureText((prev) => {
        const base = prev.trim();
        const next = extracted.trim();
        if (!base) return next;
        return `${base}\n\n${next}`;
      });

      setStatusMessage("Image text added to capture.");
    } catch (error) {
      console.error(error);
      setStatusMessage("OCR failed. Try another image.");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-title">ARE Study Vault</div>
          <div className="brand-subtitle">Spatial learning + chunked review</div>
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

        <div className="sidebar-section small-note">
          <div className="sidebar-label">Status</div>
          <div className="status-box">{statusMessage}</div>
        </div>
      </aside>

      <main className="main-panel">
        <section className="capture-card">
          <div className="capture-header">
            <div>
              <div className="card-title">Capture</div>
              <div className="card-subtitle">
                Paste notes, question explanations, or OCR text here.
              </div>
            </div>

            <div className="emphasis-switch">
              <button
                className={emphasisMode === "bold" ? "active" : ""}
                onClick={() => setEmphasisMode("bold")}
              >
                Bold
              </button>
              <button
                className={emphasisMode === "underline" ? "active" : ""}
                onClick={() => setEmphasisMode("underline")}
              >
                Underline
              </button>
            </div>
          </div>

          <div className="capture-tools">
            <label className="file-pill">
              Select Image
              <input type="file" accept="image/*" onChange={handleImageChange} />
            </label>

            <button onClick={runOCR} disabled={isScanning}>
              {isScanning ? "Reading..." : "Run OCR"}
            </button>

            <button onClick={saveNote}>Save Note</button>
            <button onClick={loadSavedNote}>Load Saved</button>
            <button onClick={loadStudySample}>Load PPD Sample</button>
            <button onClick={loadQuestionSample}>Load Question Sample</button>
            <button onClick={clearAll}>Clear</button>
          </div>

          <textarea
            className="capture-textarea"
            value={captureText}
            onChange={(e) => setCaptureText(e.target.value)}
            placeholder="Paste your notes, OCR result, or a question explanation here..."
          />
        </section>

        <section className="content-grid">
          <div className="left-column">
            <div className="info-card">
              <div className="card-title">Extraction</div>

              <div className="mini-grid">
                <div className="mini-card wide">
                  <div className="mini-title">Summary</div>
                  <MarkdownText text={emphasizedSummary} />
                </div>

                <div className="mini-card wide">
                  <div className="mini-title">Key Points</div>
                  <ol className="plain-list numbered">
                    {studyData.keyPoints.map((item, index) => (
                      <li key={index}>
                        <MarkdownText
                          text={emphasizeKeywords(
                            item,
                            studyData.review.keywords,
                            emphasisMode
                          )}
                        />
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="mini-card">
                  <div className="mini-title">Active System</div>
                  <MarkdownText
                    text={emphasizeKeywords(
                      studyData.activeSystem,
                      studyData.review.keywords,
                      emphasisMode
                    )}
                  />
                </div>

                <div className="mini-card">
                  <div className="mini-title">Passive System</div>
                  <MarkdownText
                    text={emphasizeKeywords(
                      studyData.passiveSystem,
                      studyData.review.keywords,
                      emphasisMode
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="info-card">
              <div className="card-title">Logic Links</div>
              <ul className="plain-list">
                {studyData.logicLinks.map((item, index) => (
                  <li key={index}>
                    <MarkdownText
                      text={emphasizeKeywords(
                        item,
                        studyData.review.keywords,
                        emphasisMode
                      )}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="right-column">
            <div className="review-grid">
              <div className="review-card">
                <div className="review-card-title">Correct Answer</div>
                <div className="review-card-content">
                  <MarkdownText text={emphasizedCorrectAnswer} />
                </div>
              </div>

              <div className="review-card">
                <div className="review-card-title">Answer Extraction</div>
                <div className="review-card-content">
                  <ol className="plain-list numbered">
                    {studyData.review.answerExtraction.map((item, index) => (
                      <li key={index}>
                        <MarkdownText
                          text={emphasizeKeywords(
                            item,
                            studyData.review.keywords,
                            emphasisMode
                          )}
                        />
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <div className="review-card">
                <div className="review-card-title">Trap Point</div>
                <div className="review-card-content">
                  <ul className="plain-list">
                    {studyData.review.trapPoints.map((item, index) => (
                      <li key={index}>
                        <MarkdownText
                          text={emphasizeKeywords(
                            item,
                            studyData.review.keywords,
                            emphasisMode
                          )}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="review-card">
                <div className="review-card-title">Memory Hook</div>
                <div className="review-card-content">
                  <MarkdownText
                    text={emphasizeKeywords(
                      studyData.review.memoryHook,
                      studyData.review.keywords,
                      emphasisMode
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
