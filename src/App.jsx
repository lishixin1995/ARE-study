import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import "./App.css";

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

const sampleReview = {
  questionType: "multiple_choice",
  correctAnswer: ["concrete", "cement", "sand"],
  answerExtraction: [
    "Concrete is the final composite material.",
    "Cement is the binder in the mix.",
    "Sand is the fine aggregate used in the mixture."
  ],
  trapPoints: [
    "Mortar is tempting because it also contains cement and sand, but it is not the same as concrete.",
    "Grout is wrong because it has a different purpose and composition."
  ],
  memoryHook:
    "When material terms look similar, separate binder, aggregate, and final composite first.",
  keywords: [
    "concrete",
    "cement",
    "sand",
    "mortar",
    "grout",
    "binder",
    "aggregate",
    "final composite"
  ],
  emphasisMode: "bold"
};

export default function App() {
  const [review, setReview] = useState(sampleReview);

  const formattedCorrectAnswer = useMemo(() => {
    if (!review?.correctAnswer) return "";

    if (Array.isArray(review.correctAnswer)) {
      return review.correctAnswer.join(" / ");
    }

    return review.correctAnswer;
  }, [review]);

  const emphasizedCorrectAnswer = useMemo(() => {
    return emphasizeKeywords(
      formattedCorrectAnswer,
      review?.keywords || [],
      review?.emphasisMode || "bold"
    );
  }, [formattedCorrectAnswer, review]);

  const loadSingleChoiceDemo = () => {
    setReview({
      questionType: "single_choice",
      correctAnswer: "fabrication",
      answerExtraction: [
        "The question is asking about the manufacturing of a component.",
        "Fabrication happens before delivery and installation on site.",
        "This is about production, not on-site placement."
      ],
      trapPoints: [
        "Installation is wrong because it refers to placing a finished component on site.",
        "Assembly is tempting, but it means joining parts rather than manufacturing the component itself."
      ],
      memoryHook:
        "Do not confuse making a component with installing it.",
      keywords: [
        "fabrication",
        "manufacturing",
        "delivery",
        "installation",
        "production",
        "assembly",
        "making",
        "installing"
      ],
      emphasisMode: "bold"
    });
  };

  const loadMultipleChoiceDemo = () => {
    setReview({
      questionType: "multiple_choice",
      correctAnswer: ["concrete", "cement", "sand"],
      answerExtraction: [
        "Concrete is the final composite material.",
        "Cement is the binder in the mix.",
        "Sand is the fine aggregate used in the mixture."
      ],
      trapPoints: [
        "Mortar is tempting because it also contains cement and sand, but it is not the same as concrete.",
        "Grout is wrong because it has a different purpose and composition."
      ],
      memoryHook:
        "When material terms look similar, separate binder, aggregate, and final composite first.",
      keywords: [
        "concrete",
        "cement",
        "sand",
        "mortar",
        "grout",
        "binder",
        "aggregate",
        "final composite"
      ],
      emphasisMode: "bold"
    });
  };

  const switchToBold = () => {
    setReview((prev) => ({
      ...prev,
      emphasisMode: "bold"
    }));
  };

  const switchToUnderline = () => {
    setReview((prev) => ({
      ...prev,
      emphasisMode: "underline"
    }));
  };

  return (
    <div className="app-shell">
      <div className="page-header">
        <h1>ARE Study Review Blocks Demo</h1>
        <p>
          This is a demo version showing the four blocks:
          Correct Answer, Answer Extraction, Trap Point, and Memory Hook.
        </p>
      </div>

      <div className="toolbar">
        <button onClick={loadSingleChoiceDemo}>Load Single Choice Demo</button>
        <button onClick={loadMultipleChoiceDemo}>Load Multiple Choice Demo</button>
        <button onClick={switchToBold}>Bold Keywords</button>
        <button onClick={switchToUnderline}>Underline Keywords</button>
      </div>

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
            <ol>
              {review.answerExtraction.map((item, index) => (
                <li key={index}>
                  <MarkdownText
                    text={emphasizeKeywords(
                      item,
                      review.keywords,
                      review.emphasisMode
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
            <ul>
              {review.trapPoints.map((item, index) => (
                <li key={index}>
                  <MarkdownText
                    text={emphasizeKeywords(
                      item,
                      review.keywords,
                      review.emphasisMode
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
                review.memoryHook,
                review.keywords,
                review.emphasisMode
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
