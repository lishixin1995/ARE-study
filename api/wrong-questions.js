import { ensureTables, pool } from "./_db.js";

function readJsonBody(request) {
  if (!request?.body) return {};
  if (typeof request.body === "object") return request.body;

  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

export default async function handler(request, response) {
  try {
    await ensureTables();

    if (request.method === "GET") {
      const result = await pool.query(`
        SELECT
          id,
          topic_path AS "topicPath",
          image_preview AS "imagePreview",
          ocr_text AS "ocrText",
          edited_text AS "editedText",
          question_text AS "questionText",
          summary,
          correct_answer AS "correctAnswer",
          answer_extraction AS "answerExtraction",
          bullet_points AS "bulletPoints",
          trap_point AS "trapPoint",
          memory_hook AS "memoryHook",
          saved_at AS "savedAt"
        FROM wrong_question_flashcards
        ORDER BY saved_at DESC
      `);

      return response.status(200).json({ flashcards: result.rows });
    }

    if (request.method === "POST") {
      const body = readJsonBody(request);

      const {
        id,
        topicPath = "",
        imagePreview = "",
        ocrText = "",
        editedText = "",
        questionText = "",
        summary = "",
        correctAnswer = "",
        answerExtraction = [],
        bulletPoints = [],
        trapPoint = [],
        memoryHook = "",
        savedAt
      } = body;

      if (!id || !String(editedText).trim()) {
        return response.status(400).json({ error: "Missing required flashcard fields." });
      }

      const result = await pool.query(
        `
        INSERT INTO wrong_question_flashcards (
          id, topic_path, image_preview, ocr_text, edited_text, question_text, summary,
          correct_answer, answer_extraction, bullet_points, trap_point, memory_hook, saved_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)
        RETURNING
          id,
          topic_path AS "topicPath",
          image_preview AS "imagePreview",
          ocr_text AS "ocrText",
          edited_text AS "editedText",
          question_text AS "questionText",
          summary,
          correct_answer AS "correctAnswer",
          answer_extraction AS "answerExtraction",
          bullet_points AS "bulletPoints",
          trap_point AS "trapPoint",
          memory_hook AS "memoryHook",
          saved_at AS "savedAt"
        `,
        [
          id,
          topicPath,
          imagePreview,
          ocrText,
          editedText,
          questionText,
          summary,
          JSON.stringify(correctAnswer),
          JSON.stringify(answerExtraction || []),
          JSON.stringify(bulletPoints || []),
          JSON.stringify(trapPoint || []),
          memoryHook,
          savedAt || new Date().toISOString()
        ]
      );

      return response.status(200).json({ flashcard: result.rows[0] });
    }

    if (request.method === "DELETE") {
      const { id } = request.query || {};

      if (!id) {
        return response.status(400).json({ error: "Missing flashcard id." });
      }

      await pool.query(`DELETE FROM wrong_question_flashcards WHERE id = $1`, [id]);

      return response.status(200).json({ success: true });
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "Wrong questions API error"
    });
  }
}
