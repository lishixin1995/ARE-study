import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  try {
    const { text = "", type = "capture" } =
      typeof request.body === "object" ? request.body : JSON.parse(request.body || "{}");

    if (!text.trim()) {
      return response.status(400).json({ error: "Empty text" });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite"
    });

    const prompt =
      type === "wrong_question"
        ? `Analyze this wrong-question text and return strict JSON only:
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
${text}`
        : `Analyze these study notes and return strict JSON only:
{
  "summary": "",
  "bulletPoints": [""],
  "logicLinks": [""],
  "logicForest": []
}

Text:
${text}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().replace(/```json/gi, "").replace(/```/g, "").trim();

    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch {
      return response.status(500).json({
        error: `Model returned invalid JSON: ${raw.slice(0, 500)}`
      });
    }

    return response.status(200).json({ analysis });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "AI API Error"
    });
  }
}
