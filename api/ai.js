import { GoogleGenerativeAI } from "@google/generative-ai";

const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite"
)
  .split(",")
  .map(item => item.trim())
  .filter(Boolean);

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
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
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
  return JSON.parse(extractJsonBlock(text));
}

function ensureString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function ensureStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map(item => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
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
1. Actually summarize the whole note. Do not copy only the last sentence.
2. Keep bullet points. They must capture the key ideas, not fragments.
3. Build layered logic links, not flat copying.
4. Build logicForest from logicLinks so the tree can be rendered correctly.

Rules:
- summary: 2 to 4 concise but complete sentences.
- bulletPoints: 4 to 8 bullet points.
- logicLinks: each item must use this exact format: "[A] ➔ relation ➔ [B]".
- logicForest must be an array of root nodes.
- Remove filler, repeated wording, and broken fragments.
- Keep the user's meaning accurate.

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("503") ||
    message.includes("service unavailable") ||
    message.includes("overloaded") ||
    message.includes("high demand") ||
    message.includes("500") ||
    message.includes("internal") ||
    message.includes("429") ||
    message.includes("resource exhausted")
  );
}

async function generateWithModel(genAI, modelName, prompt) {
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      topK: 32,
      maxOutputTokens: 2048,
      responseMimeType: "application/json"
    }
  });

  const result = await model.generateContent(prompt);
  const rawText = result?.response?.text?.() || "";
  return safeJsonParse(rawText);
}

async function generateWithRetryAndFallback(genAI, prompt) {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastError = null;

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const parsed = await generateWithModel(genAI, modelName, prompt);
        return { parsed, modelName };
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error)) {
          break;
        }

        if (attempt < 3) {
          await sleep(800 * attempt);
          continue;
        }
      }
    }
  }

  throw lastError;
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
    return response.status(500).json({
      error: "Missing GEMINI_API_KEY in Vercel environment variables."
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const language = detectLanguage(text);
    const prompt =
      type === "wrong_question"
        ? buildWrongQuestionPrompt(text, language)
        : buildCapturePrompt(text, language);

    const { parsed, modelName } = await generateWithRetryAndFallback(genAI, prompt);

    const analysis =
      type === "wrong_question"
        ? sanitizeWrongQuestionPayload(parsed)
        : sanitizeCapturePayload(parsed);

    return response.status(200).json({ analysis, model: modelName });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "AI API Error"
    });
  }
}
