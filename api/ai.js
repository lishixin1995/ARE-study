import { GoogleGenerativeAI } from "@google/generative-ai";

function safeParseBody(request) {
  if (!request?.body) return {};
  if (typeof request.body === "object") return request.body;

  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

function extractJsonText(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return "";

  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // keep trying
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1).trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // keep trying
    }
  }

  return cleaned;
}

function asCleanString(value) {
  return String(value || "").trim();
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeLogicNode(node) {
  if (!isPlainObject(node)) return null;

  const allowedTypes = new Set([
    "topic",
    "concept",
    "rule",
    "strategy",
    "goal",
    "point",
    "trap",
    "example"
  ]);

  const label = asCleanString(node.label);
  if (!label) return null;

  const rawType = asCleanString(node.type).toLowerCase();
  const type = allowedTypes.has(rawType) ? rawType : "point";

  const rawChildren = Array.isArray(node.children) ? node.children : [];
  const children = rawChildren
    .map(child => normalizeLogicNode(child))
    .filter(Boolean);

  return {
    label,
    type,
    children
  };
}

function normalizeLogicForest(value, fallbackSummary = "", fallbackBullets = []) {
  if (Array.isArray(value)) {
    const nodes = value.map(node => normalizeLogicNode(node)).filter(Boolean);
    if (nodes.length) return nodes;
  }

  if (isPlainObject(value)) {
    if (isPlainObject(value.root)) {
      const rootNode = normalizeLogicNode(value.root);
      if (rootNode) return [rootNode];
    }

    const directNode = normalizeLogicNode(value);
    if (directNode) return [directNode];
  }

  const fallbackChildren = fallbackBullets.slice(0, 6).map(item => ({
    label: item,
    type: "point",
    children: []
  }));

  return [
    {
      label: fallbackSummary || "Study Notes",
      type: "topic",
      children: fallbackChildren
    }
  ];
}

function normalizeCaptureAnalysis(raw) {
  const summary = asCleanString(raw?.summary);
  const bulletPoints = asStringArray(raw?.bulletPoints);
  const logicLinks = asStringArray(raw?.logicLinks);
  const logicForest = normalizeLogicForest(
    raw?.logicForest,
    summary || "Study Notes",
    bulletPoints
  );

  return {
    summary,
    bulletPoints,
    logicLinks,
    logicForest
  };
}

function normalizeWrongQuestionAnalysis(raw) {
  const questionText = asCleanString(raw?.questionText);
  const summary = asCleanString(raw?.summary);
  const correctAnswer =
    typeof raw?.correctAnswer === "string"
      ? asCleanString(raw.correctAnswer)
      : asStringArray(raw?.correctAnswer);

  return {
    questionText,
    summary,
    correctAnswer,
    answerExtraction: asStringArray(raw?.answerExtraction),
    bulletPoints: asStringArray(raw?.bulletPoints),
    trapPoint: asStringArray(raw?.trapPoint),
    memoryHook: asCleanString(raw?.memoryHook)
  };
}

const CAPTURE_PROMPT = `
You are an ARE study assistant.

Your job is to analyze the user's study notes and return compact review-ready JSON only.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanation.
Do not include commentary.
Do not wrap in triple backticks.

Use exactly this output shape:
{
  "summary": "",
  "bulletPoints": [""],
  "logicLinks": [""],
  "logicForest": [
    {
      "label": "",
      "type": "topic",
      "children": [
        {
          "label": "",
          "type": "concept",
          "children": [
            {
              "label": "",
              "type": "rule",
              "children": [
                {
                  "label": "",
                  "type": "point",
                  "children": []
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Rules:
1. Infer the topic from the user's actual notes.
2. Do NOT hardcode domain words.
3. The output must work for any ARE topic.
4. Keep "summary" concise but useful for review.
5. "bulletPoints" should be short review bullets.
6. "logicLinks" should be short relationship statements, such as cause/effect, compare/contrast, or rule/strategy links.
7. Every node in "logicForest" must contain exactly:
   - "label"
   - "type"
   - "children"
8. "children" must always be an array, even if empty.
9. Keep node labels short:
   - ideally 2 to 8 words
   - never long sentences
10. Build a real logic tree, not a paragraph split into boxes.
11. Merge repetitive ideas instead of duplicating sibling nodes.
12. Maximum depth: 4 levels including root.
13. Allowed node types only:
   - "topic"
   - "concept"
   - "rule"
   - "strategy"
   - "goal"
   - "point"
   - "trap"
   - "example"
14. Prefer review structure over completeness.
15. Do not leave placeholder labels in the final output.

Text:
`;

const WRONG_QUESTION_PROMPT = `
You are an ARE wrong-question study assistant.

Your job is to analyze the user's wrong-question content and return strict JSON only.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanation.
Do not include commentary.
Do not wrap in triple backticks.

Use exactly this output shape:
{
  "questionText": "",
  "summary": "",
  "correctAnswer": "",
  "answerExtraction": [""],
  "bulletPoints": [""],
  "trapPoint": [""],
  "memoryHook": ""
}

Rules:
1. "questionText" should restate the question clearly if possible.
2. "summary" should explain the key learning point.
3. "correctAnswer" should be concise and direct.
4. "answerExtraction" should pull the core reasons or clues that support the answer.
5. "bulletPoints" should be short review bullets.
6. "trapPoint" should explain why the wrong path is tempting or incorrect.
7. "memoryHook" should be a short memorable reminder.
8. If the input is messy, infer the most likely study meaning from the content.
9. Keep everything concise and useful for future review.

Text:
`;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  try {
    const body = safeParseBody(request);
    const { text = "", type = "capture" } = body;

    if (!String(text || "").trim()) {
      return response.status(400).json({ error: "Empty text" });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite"
    });

    const prompt =
      type === "wrong_question"
        ? `${WRONG_QUESTION_PROMPT}\n${text}`
        : `${CAPTURE_PROMPT}\n${text}`;

    const result = await model.generateContent(prompt);
    const rawText = result?.response?.text?.() || "";
    const jsonText = extractJsonText(rawText);

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return response.status(500).json({
        error: `Model returned invalid JSON: ${jsonText.slice(0, 800)}`
      });
    }

    const analysis =
      type === "wrong_question"
        ? normalizeWrongQuestionAnalysis(parsed)
        : normalizeCaptureAnalysis(parsed);

    return response.status(200).json({ analysis });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "AI API Error"
    });
  }
}
