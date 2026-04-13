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
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    let prompt = "";

    if (type === 'capture') {
      prompt = `
      You are an expert Architecture Registration Examination (ARE) tutor.
      Analyze the following student notes and output ONLY a valid JSON object containing your analysis. 
      Do not use markdown formatting like \`\`\`json. Just output the raw JSON.
      
      Required JSON Format:
      {
        "summary": "1-2 sentence summary of the core concept.",
        "extraction": ["key fact 1", "key fact 2", "key fact 3"],
        "bulletPoints": ["important bullet 1", "important bullet 2"],
        "logicLinks": ["Concept A -> leads to -> Concept B"],
        "logicForest": [] 
      }

      Notes to analyze:
      ${text}
      `;
    } 
    else if (type === 'wrong_question') {
      prompt = `
      You are an expert Architecture Registration Examination (ARE) tutor.
      Analyze the following OCR text from a wrong question and output ONLY a valid JSON object.
      Do not use markdown formatting like \`\`\`json. Just output the raw JSON.

      Required JSON Format:
      {
        "questionText": "Extract the pure question text here.",
        "summary": "1 sentence summarizing what concept this question tests.",
        "correctAnswer": "Extract the correct answer option.",
        "answerExtraction": ["Why is it correct? Reason 1", "Reason 2"],
        "trapPoint": ["Why are other options wrong? Trap 1", "Trap 2"],
        "memoryHook": "A short, catchy mnemonic or rule of thumb to remember this."
      }

      Text to analyze:
      ${text}
      `;
    }

    const result = await model.generateContent(prompt);
    let responseText = result.response.text();
    
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const analysis = JSON.parse(responseText);

    return response.status(200).json({ analysis });

  } catch (error) {
    console.error("AI Error:", error);
    return response.status(500).json({ error: 'Failed to connect to AI' });
  }
}
