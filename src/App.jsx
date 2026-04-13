import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const { text, type } = request.body;
  if (!text) {
    return response.status(400).json({ error: 'Empty text' });
  }

  try {
    // 1. 检查有没有拿到钥匙
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Vercel 后台没找到 GEMINI_API_KEY，请检查环境变量是否填写正确！");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    let prompt = "";

    if (type === 'capture') {
      prompt = `
      You are an expert Architecture Registration Examination (ARE) tutor.
      Analyze the user's notes and output ONLY a valid JSON object.
      IMPORTANT: Respond in the EXACT SAME LANGUAGE as the user's notes.
      
      Required JSON Format:
      {
        "summary": "1-3 sentence detailed summary.",
        "extraction": ["Detailed fact 1", "Detailed fact 2", "Detailed fact 3"],
        "bulletPoints": ["Key rule 1", "Key rule 2"],
        "logicLinks": ["Condition A -> Strategy B", "Problem X -> Solution Y"],
        "logicForest": [
          {
            "label": "Main Category",
            "relation": "category",
            "children": [
              { "label": "Sub Concept 1", "relation": "strategy" }
            ]
          }
        ] 
      }

      User Notes to analyze:
      ${text}
      `;
    } 
    else if (type === 'wrong_question') {
      prompt = `
      You are an expert Architecture Registration Examination (ARE) tutor.
      Analyze the OCR text from a wrong question and output ONLY a valid JSON object.
      IMPORTANT: Respond in the EXACT SAME LANGUAGE as the user's notes.
      
      Required JSON Format:
      {
        "questionText": "Extract the pure question text.",
        "summary": "1 sentence summarizing what concept this tests.",
        "correctAnswer": "Extract the correct answer option.",
        "answerExtraction": ["Why is it correct? Reason 1", "Reason 2"],
        "trapPoint": ["Why are other options wrong? Trap 1", "Trap 2"],
        "memoryHook": "A catchy mnemonic or rule of thumb."
      }

      Text to analyze:
      ${text}
      `;
    }

    const result = await model.generateContent(prompt);
    let responseText = result.response.text();
    
    // 2. 暴力清理 AI 可能带的 Markdown 废话
    responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    // 3. 尝试解析 JSON
    let analysis;
    try {
      analysis = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error("AI 返回格式错误无法解析: " + responseText.substring(0, 40) + "...");
    }

    return response.status(200).json({ analysis });

  } catch (error) {
    console.error("AI Error:", error);
    // 4. 把【真正的报错信息】发送回前端网页！
    return response.status(500).json({ error: error.message || 'Unknown AI Error' });
  }
}
