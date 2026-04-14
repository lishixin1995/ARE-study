import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function readJsonBody(request) {
  if (!request?.body) return {};
  if (typeof request.body === "object") return request.body;

  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

function detectLanguage(text = "") {
  return /[\u4e00-\u9fff]/.test(text) ? "Chinese" : "English";
}

function stripCodeFence(text = "") {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractJsonBlock(text = "") {
  const cleaned = stripCodeFence(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }

  return cleaned;
}

function safeJsonParse(text = "") {
  const candidate = extractJsonBlock(text);
  return JSON.parse(candidate);
}

function ensureString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function ensureStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeForestNode(node) {
  if (!node || typeof node !== "object") return null;

  const label = ensureString(node.label);
  if (!label) return null;

  const relation = typeof node.relation === "string" ? node.relation.trim() : null;
  const children = Array.isArray(node.children)
    ? node.children.map(normalizeForestNode).filter(Boolean)
    : [];

  return { label, relation, children };
}

function ensureForest(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeForestNode).filter(Boolean);
}

function sanitizeCapturePayload(payload) {
  return {
    summary: ensureString(payload?.summary),
    bulletPoints: ensureStringArray(payload?.bulletPoints),
    logicLinks: ensureStringArray(payload?.logicLinks),
    logicForest: ensureForest(payload?.logicForest)
  };
}

function sanitizeWrongQuestionPayload(payload) {
  const correctAnswer = Array.isArray(payload?.correctAnswer)
    ? ensureStringArray(payload?.correctAnswer)
    : ensureString(payload?.correctAnswer);

  return {
    questionText: ensureString(payload?.questionText),
    summary: ensureString(payload?.summary),
    correctAnswer,
    answerExtraction: ensureStringArray(payload?.answerExtraction),
    bulletPoints: ensureStringArray(payload?.bulletPoints),
    trapPoint: ensureStringArray(payload?.trapPoint),
    memoryHook: ensureString(payload?.memoryHook)
  };
}

function buildCapturePrompt(text, language) {
  return `
You are an expert Architecture Registration Examination (ARE) tutor.
Analyze the note text and return ONLY valid JSON.
Write the output in ${language}.

Your job:
1. Actually summarize the whole note. Do not copy the last sentence.
2. Keep bullet points. They must capture the key ideas, not fragments.
3. Build layered logic links, not flat copying.
4. Build logicForest from logicLinks, so the tree can be rendered correctly.

Rules:
- summary: 2 to 4 concise but complete sentences.
- bulletPoints: 4 to 8 bullet points.
- logicLinks: each item must use this exact format: "[A] ➔ relation ➔ [B]".
- logicLinks must show hierarchy such as parent concept -> subtype/strategy -> effect/tradeoff.
- logicForest must be an array of root nodes.
- Remove filler, repeated wording, and broken fragments.
- Keep the user's meaning accurate.

If the text includes content like:
"Building system: active system relies on mechanical equipment and uses more energy. Passive system relies on sun, air, and wind flow. In cold climate, reduce heat loss and gain solar heat. In hot climate, control heat gain and optimize natural ventilation. Trombe wall helps stabilize temperature but takes more space."
then a good result would separate:
- building systems into active vs passive,
- climate response into cold vs hot climate,
- Trombe wall into benefit vs tradeoff.

Return ONLY JSON using this schema:
{
  "summary": "",
  "bulletPoints": [""],
  "logicLinks": ["[A] ➔ relation ➔ [B]"],
  "logicForest": [
    {
      "label": "",
      "relation": null,
      "children": [
        {
          "label": "",
          "relation": "",
          "children": []
        }
      ]
    }
  ]
}

Text:
${text}
`.trim();
}

function buildWrongQuestionPrompt(text, language) {
  return `
You are an expert Architecture Registration Examination (ARE) tutor.
Analyze the wrong-question text and return ONLY valid JSON.
Write the output in ${language}.

Rules:
- questionText: restate the question briefly and clearly.
- summary: explain the real tested concept and why the correct direction works.
- correctAnswer: keep it as a string unless there are multiple correct answers.
- answerExtraction: 2 to 6 short key takeaways from the correct answer.
- bulletPoints: 3 to 6 study bullets.
- trapPoint: 1 to 4 common traps or why wrong choices fail.
- memoryHook: one short memorable reminder.
- Remove OCR junk and duplicate fragments.

Return ONLY JSON using this schema:
{
  "questionText": "",
  "summary": "",
  "correctAnswer": "",
  "answerExtraction": [""],
  "bulletPoints": [""],
  "trapPoint": [""],
  "memoryHook": ""
}

Text:
${text}
`.trim();
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const { text = "", type = "capture" } = readJsonBody(request);

  if (!text || !text.trim()) {
    return response.status(400).json({ error: "Empty text" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ error: "Missing GEMINI_API_KEY in Vercel environment variables." });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.25,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 2048,
        responseMimeType: "application/json"
      }
    });

    const language = detectLanguage(text);
    const prompt =
      type === "wrong_question"
        ? buildWrongQuestionPrompt(text, language)
        : buildCapturePrompt(text, language);

    const result = await model.generateContent(prompt);
    const rawText = result?.response?.text?.() || "";
    const parsed = safeJsonParse(rawText);

    const analysis =
      type === "wrong_question"
        ? sanitizeWrongQuestionPayload(parsed)
        : sanitizeCapturePayload(parsed);

    return response.status(200).json({ analysis });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "AI API Error"
    });
  }
}
