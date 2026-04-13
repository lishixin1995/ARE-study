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
// ------------------------------------------------------------------
// 🌟 修复部分开始：全新的正则解析函数 🌟
// ------------------------------------------------------------------

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
  // 匹配 "Question:" 或 "Q:" 后面的内容
  const match = (text || "").match(/(?:Question|Q)[\s]*[:：]\s*([\s\S]*?)(?=(?:\n(?:Correct Answer|Summary|Trap Point|Memory Hook|Extraction)[\s]*[:：])|$)/i);
  if (match && match[1].trim()) return match[1].trim();

  // 如果没有标签，默认抓取前几行
  const lines = splitLines(text).filter(line => !/^(correct answer|summary|trap point|memory hook|extraction|question)[\s]*[:\-：]/i.test(line));
  if (!lines.length) return "No question text yet. (Tip: Type 'Question: ...')";
  return lines.slice(0, 5).join(" ");
}

function buildWrongQuestionSummary(text) {
@@ -343,79 +326,27 @@
}

function buildWrongQuestionCorrectAnswer(text) {
  const parsed = parseCorrectAnswer(text);
  if (parsed) return parsed;
  return "Not detected yet. Add a line like: Correct Answer: ...";
  const match = (text || "").match(/(?:Correct Answer|Answer)[\s]*[:：]\s*(.+)/i);
  if (match && match[1].trim()) return match[1].trim();
  return "Not detected. (Tip: Type 'Correct Answer: ...')";
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
  const match = (text || "").match(/(?:Extraction|Answer Extraction)[\s]*[:：]\s*([\s\S]*?)(?=(?:\n(?:Question|Correct Answer|Summary|Trap Point|Memory Hook)[\s]*[:：])|$)/i);
  if (match && match[1].trim()) return splitLines(match[1]);
  return ["Not detected. (Tip: Type 'Extraction: ...')"];
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
  const match = (text || "").match(/Trap Point[\s]*[:：]\s*([\s\S]*?)(?=(?:\n(?:Question|Correct Answer|Summary|Memory Hook|Extraction)[\s]*[:：])|$)/i);
  if (match && match[1].trim()) return splitLines(match[1]);
  return ["Not detected. (Tip: Type 'Trap Point: ...')"];
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
  const match = (text || "").match(/Memory Hook[\s]*[:：]\s*(.+)/i);
  if (match && match[1].trim()) return match[1].trim();
  return "Not detected. (Tip: Type 'Memory Hook: ...')";
}

function buildWrongQuestionAnalysis(text) {
@@ -429,6 +360,10 @@
  };
}

// ------------------------------------------------------------------
// 🌟 修复部分结束 🌟
// ------------------------------------------------------------------

function readSavedNotesByTopic() {
  try {
    const raw = localStorage.getItem("savedNotesByTopic");
@@ -731,6 +666,19 @@
    );
  };

  // 🌟 新增的删除错题卡片功能 🌟
  const handleDeleteFlashcard = (idToDelete) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this flashcard?");
    if (!confirmDelete) return;

    setWrongQuestionFlashcards((prev) => {
      return prev.filter(card => card.id !== idToDelete);
    });
    
    setFlashcardIndex((prev) => (prev > 0 ? prev - 1 : 0));
    setWrongQuestionStatus("Flashcard successfully deleted.");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
@@ -920,7 +868,7 @@
                  className="panel-textarea wrong-question-textarea"
                  value={wrongQuestionDraftText}
                  onChange={(e) => setWrongQuestionDraftText(e.target.value)}
                  placeholder="这里输入错题内容，或者让 OCR 结果填进来。"
                  placeholder="你可以直接输入：&#10;Question: [题目内容]&#10;Correct Answer: [正确答案]&#10;Extraction: [知识点提取]&#10;Trap Point: [陷阱分析]&#10;Memory Hook: [记忆点]"
                />
              </div>
            </div>
@@ -1010,85 +958,105 @@

                {currentFlashcard ? (
                  <div className="flashcard-slide">
                    
                    {/* 🌟 修改了这里的布局，加入了删除按钮 🌟 */}
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
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
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
                        
                        <button
                          onClick={() => handleDeleteFlashcard(currentFlashcard.id)}
                          style={{
                            background: '#fff0f0',
                            color: '#dc2626',
                            border: '1px solid #fecaca',
                            borderRadius: '8px',
                            padding: '6px 12px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '13px'
                          }}
                        >
                          Delete
                        </button>
                      </div>
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
