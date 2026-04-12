import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import Tesseract from "tesseract.js";
import "./App.css";

const DIVISIONS = ["PA", "PPD", "PDD", "PCM", "PJM", "CE"];

const ROOMS_BY_DIVISION = {
  PA: ["Site", "Zoning", "Code", "Programming"],
  PPD: ["Site", "Climate", "Structure", "Mechanical", "Envelope", "Codes"],
  PDD: ["Envelope", "Detailing", "Materials", "Documentation"],
  PCM: ["Practice", "Risk", "Contracts", "Finance"],
  PJM: ["Team", "Schedule", "CA", "Delivery"],
  CE: ["Site Visit", "Submittals", "RFI", "Punch List"]
};

const DEFAULT_NOTES =
  "Building system: active system relies on mechanical equipment and uses more energy. Passive system relies on sun, air, and wind flow. In cold climate, reduce heat loss and gain solar heat. In hot climate, control heat gain and optimize natural ventilation. Trombe wall helps stabilize temperature but takes more space.";

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

function buildSummary(text) {
  const sentences = splitSentences(text);
  if (sentences.length >= 2) return `${sentences[0]} ${sentences[1]}`;
  if (sentences.length === 1) return sentences[0];
  return "当前还没有足够内容生成 summary。";
}

function buildKeyPoints(text) {
  const lines = splitLines(text);
  const filtered = lines.filter(
    (item) =>
      !/^question[:\-]/i.test(item) &&
      !/^correct answer[:\-]/i.test(item) &&
      !/^notes[:\-]/i.test(item)
  );

  if (filtered.length >= 4) return filtered.slice(0, 4);

  const sentences = splitSentences(text);
  if (sentences.length >= 4) return sentences.slice(0, 4);

  return ["继续补充内容后，这里会自动提取关键点。"];
}

function buildSystemCards(text) {
  const lower = text.toLowerCase();

  let activeSystem = "依赖机械设备、控制更强，但通常能耗更高。";
  let passiveSystem = "依赖太阳、空气和风等自然条件，通常更节能。";
  let climateCompare = "寒冷气候强调减少热损失，炎热气候强调控制热增益与通风。";
  let trombeWall = "一种被动式采暖策略，可稳定温度，但占空间。";

  if (lower.includes("active system")) {
    activeSystem = "Active system relies on mechanical equipment and usually uses more energy.";
  }

  if (lower.includes("passive system")) {
    passiveSystem = "Passive system depends on sun, air, and wind flow rather than heavy equipment.";
  }

  if (lower.includes("cold climate") || lower.includes("hot climate")) {
    climateCompare =
      "Cold climate design usually reduces heat loss first, while hot climate design controls heat gain and improves ventilation.";
  }

  if (lower.includes("trombe wall")) {
    trombeWall =
      "Trombe wall is a passive thermal strategy that stabilizes indoor temperature, but it needs more space.";
  }

  return { activeSystem, passiveSystem, climateCompare, trombeWall };
}

function buildLogicLinks(text) {
  const lower = text.toLowerCase();
  const links = [];

  if (lower.includes("passive system") || lower.includes("sun") || lower.includes("wind")) {
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
    links.push("先判断概念依赖什么：设备、气候、材料，还是 code 逻辑。");
  }

  return links;
}

function buildSuggestedPlacement(selectedDivision) {
  return [
    `${selectedDivision} → Site`,
    `${selectedDivision} → Core Concepts`,
    `${selectedDivision} → Review`
  ];
}

function buildAnswerExtraction(text) {
  const lower = text.toLowerCase();

  if (lower.includes("concrete") && lower.includes("cement") && lower.includes("sand")) {
    return [
      "Concrete is the final composite material.",
      "Cement is the binder in the mix.",
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

  const sentences = splitSentences(text);
  if (sentences.length >= 3) return sentences.slice(0, 3);

  const lines = splitLines(text);
  if (lines.length >= 3) return lines.slice(0, 3);

  return [
    "先抓题干真正问的概念。",
    "再把相近术语分开。",
    "最后用关键词排除干扰项。"
  ];
}

function buildTrapPoints(text) {
  const lower = text.toLowerCase();

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
    "注意那些看起来相关、但其实属于不同阶段的选项。",
    "先排除描述相似过程、而不是题目真正概念的答案。"
  ];
}

function buildMemoryHook(text) {
  const lower = text.toLowerCase();

  if (lower.includes("concrete") && lower.includes("cement") && lower.includes("sand")) {
    return "When material terms look similar, separate the binder, aggregate, and final composite first.";
  }

  if (lower.includes("fabrication")) {
    return "Do not confuse making a component with installing it.";
  }

  if (lower.includes("active system") || lower.includes("passive system")) {
    return "When systems are easy to mix up, first ask whether the strategy depends on equipment or climate.";
  }

  return "先确认题目真正考的是哪一个核心概念，再比较相似术语。";
}

function buildReview(text) {
  const correctAnswer = parseCorrectAnswer(text);
  const keywords = detectKeywords(text);

  return {
    correctAnswer:
      correctAnswer ||
      "还没有识别到明确的 Correct Answer。可以直接 paste 一道题和标准答案。",
    answerExtraction: buildAnswerExtraction(text),
    trapPoints: buildTrapPoints(text),
    memoryHook: buildMemoryHook(text),
    keywords
  };
}

function buildStudyData(text, selectedDivision) {
  const summary = buildSummary(text);
  const keyPoints = buildKeyPoints(text);
  const systems = buildSystemCards(text);
  const logicLinks = buildLogicLinks(text);
  const suggestedPlacement = buildSuggestedPlacement(selectedDivision);
  const review = buildReview(text);

  return {
    summary,
    keyPoints,
    ...systems,
    logicLinks,
    suggestedPlacement,
    review
  };
}

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState("PPD");
  const [selectedRoom, setSelectedRoom] = useState("Site");
  const [captureText, setCaptureText] = useState(DEFAULT_NOTES);
  const [savedAt, setSavedAt] = useState("");
  const [statusMessage, setStatusMessage] = useState("现在这版已经支持本地保存。刷新页面后，当前浏览器里的内容会自动恢复。");
  const [emphasisMode, setEmphasisMode] = useState("bold");

  const [imageFile, setImageFile] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("");
  const [ocrPreviewName, setOcrPreviewName] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [wrongQuestionSavedAt, setWrongQuestionSavedAt] = useState("");
  
  const rooms = ROOMS_BY_DIVISION[selectedDivision] || [];

  const studyData = useMemo(() => {
    return buildStudyData(captureText, selectedDivision);
  }, [captureText, selectedDivision]);
  const reviewSourceText = useMemo(() => {
  return ocrText?.trim() ? ocrText : captureText;
}, [ocrText, captureText]);

const reviewData = useMemo(() => {
  return buildReview(reviewSourceText);
}, [reviewSourceText]);

const reviewCorrectAnswerDisplay = useMemo(() => {
  const value = reviewData.correctAnswer;
  return Array.isArray(value) ? value.join(" / ") : value;
}, [reviewData]);

  const correctAnswerDisplay = useMemo(() => {
    const value = studyData.review.correctAnswer;
    return Array.isArray(value) ? value.join(" / ") : value;
  }, [studyData]);

  const saveNote = () => {
    localStorage.setItem("are-study-note", captureText);
    const now = new Date();
    const stamp = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.toLocaleTimeString()}`;
    setSavedAt(stamp);
    setStatusMessage("现在这版已经支持本地保存。刷新页面后，当前浏览器里的内容会自动恢复。");
  };

  const loadSavedNote = () => {
    const saved = localStorage.getItem("are-study-note");
    if (!saved) {
      setStatusMessage("还没有找到已保存内容。");
      return;
    }
    setCaptureText(saved);
    setStatusMessage("已加载本地保存内容。");
  };

  const loadPPDSample = () => {
    setCaptureText(DEFAULT_NOTES);
    setStatusMessage("已加载 PPD 示例内容。");
  };

  const loadQuestionSample = () => {
    setCaptureText(QUESTION_SAMPLE);
    setStatusMessage("已加载题目示例内容。");
  };

  const clearAll = () => {
  setCaptureText("");
  setStatusMessage("已清空 Capture。");
};

const handleImageChange = (event) => {
  const file = event.target.files?.[0] || null;

  if (!file) {
    setImageFile(null);
    setImagePreview("");
    setOcrPreviewName("");
    setOcrStatus("No image selected.");
    return;
  }

  setImageFile(file);
  setOcrPreviewName(file.name);
  setOcrStatus(`Selected image: ${file.name}`);

  const reader = new FileReader();
  reader.onloadend = () => {
    setImagePreview(typeof reader.result === "string" ? reader.result : "");
  };
  reader.readAsDataURL(file);
};

const runOCR = async () => {
  if (!imageFile) {
    setOcrStatus("Please select an image first.");
    return;
  }

  try {
    setIsScanning(true);
    setOcrStatus("Reading image text...");

    const result = await Tesseract.recognize(imageFile, "eng");
    const extractedText = result?.data?.text?.trim() || "";

    if (!extractedText) {
      setOcrStatus("No text detected from this image.");
      return;
    }

    setOcrText(extractedText);
    setOcrStatus("OCR completed. Text is ready for analysis.");
    setStatusMessage("OCR 完成，右侧错题分析 block 已更新。");
  } catch (error) {
    console.error(error);
    setOcrStatus("OCR failed. Try another image.");
    setStatusMessage("OCR 失败，请换一张更清晰的图片。");
  } finally {
    setIsScanning(false);
  }
};

const saveWrongQuestion = () => {
  const payload = {
    imagePreview,
    imageName: ocrPreviewName,
    ocrText,
    savedAt: new Date().toISOString()
  };

  localStorage.setItem("are-wrong-question", JSON.stringify(payload));

  const now = new Date();
  const stamp = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.toLocaleTimeString()}`;
  setWrongQuestionSavedAt(stamp);
  setOcrStatus("Wrong-question block saved.");
};

const loadWrongQuestion = () => {
  const raw = localStorage.getItem("are-wrong-question");

  if (!raw) {
    setOcrStatus("No saved wrong-question block found.");
    return;
  }

  try {
    const data = JSON.parse(raw);
    setImagePreview(data.imagePreview || "");
    setOcrPreviewName(data.imageName || "");
    setOcrText(data.ocrText || "");
    setWrongQuestionSavedAt(data.savedAt || "");
    setOcrStatus("Saved wrong-question block loaded.");
  } catch (error) {
    console.error(error);
    setOcrStatus("Failed to load saved wrong-question block.");
  }
};

const clearWrongQuestion = () => {
  setImageFile(null);
  setImagePreview("");
  setOcrPreviewName("");
  setOcrText("");
  setOcrStatus("");
  setWrongQuestionSavedAt("");
};

  const handleImageChange = (event) => {
    const file = event.target.files?.[0] || null;

    if (!file) {
      setImageFile(null);
      setOcrPreviewName("");
      setOcrStatus("No image selected.");
      return;
    }

    setImageFile(file);
    setOcrPreviewName(file.name);
    setOcrStatus(`Selected image: ${file.name}`);
  };

  const runOCR = async () => {
    if (!imageFile) {
      setOcrStatus("Please select an image first.");
      return;
    }

    try {
      setIsScanning(true);
      setOcrStatus("Reading image text...");

      const result = await Tesseract.recognize(imageFile, "eng");
      const extractedText = result?.data?.text?.trim() || "";

      if (!extractedText) {
        setOcrStatus("No text detected from this image.");
        return;
      }

      setCaptureText((prev) => {
        const oldText = prev?.trim() || "";
        if (!oldText) return extractedText;
        return `${oldText}\n\n${extractedText}`;
      });

      setOcrStatus("Image text added to Capture.");
      setStatusMessage("OCR 完成，文字已加入 Capture。");
    } catch (error) {
      console.error(error);
      setOcrStatus("OCR failed. Try another image.");
      setStatusMessage("OCR 失败，请换一张更清晰的图片。");
    } finally {
      setIsScanning(false);
    }
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

      <main className="main-panel">
        <section className="capture-card">
          <div className="capture-header">
            <div>
              <div className="card-title">Capture</div>
              <div className="card-subtitle">把你的视频笔记、聊天整理、手写转录内容先丢进来。</div>
            </div>
          </div>

          <div className="capture-meta">
            <span className="meta-pill">Division: {selectedDivision}</span>
            <span className="meta-pill">Room: {selectedRoom}</span>
            {savedAt ? <span className="meta-pill">Saved: {savedAt}</span> : null}
          </div>

          <textarea
            className="capture-textarea"
            value={captureText}
            onChange={(e) => setCaptureText(e.target.value)}
          />

          <div className="capture-tools">
            <label className="file-upload-pill">
              Upload Image
              <input type="file" accept="image/*" onChange={handleImageChange} />
            </label>

            <button onClick={runOCR} disabled={isScanning}>
              {isScanning ? "Reading..." : "Run OCR"}
            </button>

            <button onClick={saveNote}>Save Note</button>
            <button onClick={loadSavedNote}>Load Saved</button>
            <button onClick={loadPPDSample}>Load PPD Sample</button>
            <button onClick={loadQuestionSample}>Load Question Sample</button>
            <button onClick={clearAll}>Clear</button>

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

          {ocrPreviewName ? (
            <div className="ocr-file-name">Selected: {ocrPreviewName}</div>
          ) : null}

          {ocrStatus ? (
            <div className="ocr-status">{ocrStatus}</div>
          ) : null}

          <div className="status-box">{statusMessage}</div>
        </section>

        <section className="content-grid">
          <div className="left-column">
            <div className="info-card">
              <div className="card-title">Extraction</div>

              <div className="mini-grid">
                <div className="mini-card wide">
                  <div className="mini-title">Summary</div>
                  <MarkdownText
                    text={emphasizeKeywords(
                      studyData.summary,
                      studyData.review.keywords,
                      emphasisMode
                    )}
                  />
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

                <div className="mini-card">
                  <div className="mini-title">Cold Climate vs Hot Climate</div>
                  <MarkdownText
                    text={emphasizeKeywords(
                      studyData.climateCompare,
                      studyData.review.keywords,
                      emphasisMode
                    )}
                  />
                </div>

                <div className="mini-card">
                  <div className="mini-title">Trombe Wall</div>
                  <MarkdownText
                    text={emphasizeKeywords(
                      studyData.trombeWall,
                      studyData.review.keywords,
                      emphasisMode
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="info-card">
              <div className="card-title">Suggested Placement</div>
              <ul className="plain-list">
                {studyData.suggestedPlacement.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

         <div className="right-column">
  <div className="wrong-question-card">
    <div className="card-title">Wrong Question OCR</div>
    <div className="card-subtitle">
      图片和 OCR 单独放在这里，专门给错题分析使用。
    </div>

    <div className="wrong-question-grid">
      <div className="image-block">
        <div className="mini-title">Image</div>

        <div className="image-preview-box">
          {imagePreview ? (
            <img src={imagePreview} alt="Selected question" className="image-preview" />
          ) : (
            <div className="image-placeholder">No image selected</div>
          )}
        </div>

        {ocrPreviewName ? (
          <div className="ocr-file-name">Selected: {ocrPreviewName}</div>
        ) : null}
      </div>

      <div className="ocr-block">
        <div className="mini-title">OCR Text</div>

        <textarea
          className="ocr-textarea"
          value={ocrText}
          onChange={(e) => setOcrText(e.target.value)}
          placeholder="OCR result will appear here. You can also edit it manually."
        />

        <div className="ocr-actions">
          <label className="file-upload-pill action-btn secondary">
            Select Image
            <input type="file" accept="image/*" onChange={handleImageChange} />
          </label>

          <button
            className="action-btn primary"
            onClick={runOCR}
            disabled={isScanning}
          >
            {isScanning ? "Reading..." : "Run OCR"}
          </button>

          <button className="action-btn secondary" onClick={saveWrongQuestion}>
            Save Wrong Q
          </button>

          <button className="action-btn secondary" onClick={loadWrongQuestion}>
            Load Saved Q
          </button>

          <button className="action-btn ghost" onClick={clearWrongQuestion}>
            Clear OCR
          </button>
        </div>

        {wrongQuestionSavedAt ? (
          <div className="ocr-meta">Saved: {wrongQuestionSavedAt}</div>
        ) : null}

        {ocrStatus ? <div className="ocr-status">{ocrStatus}</div> : null}
      </div>
    </div>
  </div>

  <div className="review-grid">
    <div className="review-card">
      <div className="review-card-title">Correct Answer</div>
      <div className="review-card-content">
        <MarkdownText
          text={emphasizeKeywords(
            reviewCorrectAnswerDisplay,
            reviewData.keywords,
            emphasisMode
          )}
        />
      </div>
    </div>

    <div className="review-card">
      <div className="review-card-title">Answer Extraction</div>
      <div className="review-card-content">
        <ol className="plain-list numbered">
          {reviewData.answerExtraction.map((item, index) => (
            <li key={index}>
              <MarkdownText
                text={emphasizeKeywords(
                  item,
                  reviewData.keywords,
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
          {reviewData.trapPoints.map((item, index) => (
            <li key={index}>
              <MarkdownText
                text={emphasizeKeywords(
                  item,
                  reviewData.keywords,
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
            reviewData.memoryHook,
            reviewData.keywords,
            emphasisMode
          )}
        />
      </div>
    </div>
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
