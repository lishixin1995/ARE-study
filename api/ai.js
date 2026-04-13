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
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // 强制 AI 输出标准 JSON 格式，绝不废话！
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    let prompt = "";

    if (type === 'capture') {
      prompt = `
      You are an expert Architecture Registration Examination (ARE) tutor.
      Analyze the user's notes and output ONLY a valid JSON object.
      IMPORTANT: Respond in the EXACT SAME LANGUAGE as the user's notes (e.g., if the user writes in Chinese, your analysis MUST be in Chinese).
      Do not summarize too briefly. Extract the core architectural logic, trade-offs, and rules of thumb.
      
      Required JSON Format:
      {
        "summary": "1-3 sentence detailed summary of the core concept and trade-offs.",
        "extraction": ["Detailed fact 1", "Detailed fact 2", "Detailed fact 3", "Detailed fact 4"],
        "bulletPoints": ["Key action or rule 1", "Key action or rule 2", "Key action or rule 3"],
        "logicLinks": ["Condition A -> Strategy B", "Problem X -> Solution Y"],
        "logicForest": [
          {
            "label": "Main Category (e.g., Daylighting)",
            "relation": "category",
            "children": [
              { "label": "Sub Concept 1", "relation": "strategy" },
              { "label": "Sub Concept 2", "relation": "trade-off" }
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
    const responseText = result.response.text();
    const analysis = JSON.parse(responseText);

    return response.status(200).json({ analysis });

  } catch (error) {
    console.error("AI Error:", error);
    return response.status(500).json({ error: 'Failed to connect to AI or parse JSON' });
  }
}
