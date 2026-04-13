import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });
  const { text, type } = request.body;
  if (!text) return response.status(400).json({ error: 'Empty text' });

  try {
    if (!process.env.GEMINI_API_KEY) throw new Error("Vercel 未配置 GEMINI_API_KEY");

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
        // `gemini-pro` 已下线，改为当前可用的 1.5 系列模型，避免 404。
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    let prompt = "";
    if (type === 'capture') {
      prompt = `You are an expert Architecture Registration Examination (ARE) tutor. Analyze notes and output ONLY JSON. Respond in the SAME LANGUAGE as the user.
      Remove filler/intro/example-only phrases and keep only high-value ideas (definitions, constraints, comparisons, cause-effect).
      summary must be 2-4 concise sentences and should focus on core concepts, not repeated examples.
      bulletPoints must be 4-8 clean points with no duplicated fragments.
      logicLinks must be explicit links like "[A] ➔ relation ➔ [B]". Build logic links from core reasoning.
      logicForest must be derived from logicLinks (not from summary text).
      Format: {"summary":"...","bulletPoints":["..."],"logicLinks":["..."],"logicForest":[{"label":"...","relation":"...","children":[]}]}`;
    } else if (type === 'wrong_question') {
      prompt = `You are an expert Architecture Registration Examination (ARE) tutor. Analyze OCR text and output ONLY JSON. Respond in the SAME LANGUAGE.
      Format: {"questionText":"...","summary":"...","correctAnswer":"...","answerExtraction":["..."],"trapPoint":["..."],"memoryHook":"..."}`;
    }

    const result = await model.generateContent(prompt + "\nText: " + text);
    let responseText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
    
    return response.status(200).json({ analysis: JSON.parse(responseText) });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'AI API Error' });
  }
}
