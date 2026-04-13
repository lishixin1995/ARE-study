import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });
  const { text, type } = request.body;
  if (!text) return response.status(400).json({ error: 'Empty text' });

  try {
    if (!process.env.GEMINI_API_KEY) throw new Error("Vercel 未配置 GEMINI_API_KEY");

    // 【致命修复】使用最兼容的 gemini-pro，完美适配你的 0.7.0 依赖包！
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    let prompt = "";
    if (type === 'capture') {
      prompt = `You are an ARE tutor. Analyze notes and output ONLY JSON. Respond in the SAME LANGUAGE as the user.
      Format: {"summary":"...","extraction":["..."],"bulletPoints":["..."],"logicLinks":["..."],"logicForest":[{"label":"...","relation":"...","children":[]}]}`;
    } else if (type === 'wrong_question') {
      prompt = `You are an ARE tutor. Analyze OCR text and output ONLY JSON. Respond in the SAME LANGUAGE.
      Format: {"questionText":"...","summary":"...","correctAnswer":"...","answerExtraction":["..."],"trapPoint":["..."],"memoryHook":"..."}`;
    }

    const result = await model.generateContent(prompt + "\nText: " + text);
    let responseText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
    
    return response.status(200).json({ analysis: JSON.parse(responseText) });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'AI API Error' });
  }
}
