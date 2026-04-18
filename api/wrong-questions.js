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

function normalizeString(value) {
  return String(value || "").trim();
}

function parseTopicPath(topicPath = "") {
  const parts = String(topicPath || "")
    .split("/")
    .map(part => part.trim())
    .filter(Boolean);

  return {
    division: parts[0] || "",
    roomName: parts[1] || "",
    subroomName: parts[2] || ""
  };
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

      const flashcards = result.rows.map(card => {
        const parsed = parseTopicPath(card.topicPath);

        return {
          ...card,
          division: parsed.division,
          roomName: parsed.roomName,
          subroomName: parsed.subroomName,
          roomId: "",
          subroomId: "",
          notesText: "",
          analysisSourceText: ""
        };
      });

      return response.status(200).json({ flashcards });
    }

    if (request.method === "POST") {
      const body = readJsonBody(request);

      const {
        id,
        division = "",
        roomId = "",
        roomName = "",
        subroomId = "",
        subroomName = "",
        topicPath = "",
        imagePreview = "",
        ocrText = "",
        editedText = "",
        notesText = "",
        analysisSourceText = "",
        questionText = "",
        summary = "",
        correctAnswer = [],
        answerExtraction = [],
        bulletPoints = [],
        trapPoint = [],
        memoryHook = "",
        savedAt
      } = body;

      const hasAnyContent =
        normalizeString(editedText) ||
        normalizeString(notesText) ||
        normalizeString(ocrText) ||
        normalizeString(questionText) ||
        normalizeString(summary) ||
        normalizeString(imagePreview) ||
        (Array.isArray(correctAnswer) && correctAnswer.length) ||
        (Array.isArray(answerExtraction) && answerExtraction.length) ||
        (Array.isArray(bulletPoints) && bulletPoints.length) ||
        (Array.isArray(trapPoint) && trapPoint.length) ||
        normalizeString(memoryHook);

      if (!id || !hasAnyContent) {
        return response.status(400).json({ error: "Missing required flashcard fields." });
      }

      const finalTopicPath =
        normalizeString(topicPath) ||
        [division, roomName, subroomName].filter(Boolean).join(" / ");

      const finalEditedText = normalizeString(editedText);
      const finalQuestionText =
        normalizeString(questionText) ||
        finalEditedText ||
        normalizeString(ocrText);

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
          finalTopicPath,
          imagePreview || "",
          ocrText || "",
          finalEditedText,
          finalQuestionText,
          summary || "",
          JSON.stringify(correctAnswer || []),
          JSON.stringify(answerExtraction || []),
          JSON.stringify(bulletPoints || []),
          JSON.stringify(trapPoint || []),
          memoryHook || "",
          savedAt || new Date().toISOString()
        ]
      );

      const flashcard = {
        ...result.rows[0],
        division,
        roomId,
        roomName,
        subroomId,
        subroomName,
        notesText: notesText || "",
        analysisSourceText: analysisSourceText || ""
      };

      return response.status(200).json({ flashcard });
    }

    if (request.method === "DELETE") {
      const id =
        request.query?.id ||
        readJsonBody(request)?.id ||
        "";

      if (!String(id).trim()) {
        return response.status(400).json({ error: "Missing flashcard id." });
      }

      const result = await pool.query(
        `DELETE FROM wrong_question_flashcards WHERE id = $1 RETURNING id`,
        [id]
      );

      if (!result.rowCount) {
        return response.status(404).json({ error: "Flashcard not found." });
      }

      return response.status(200).json({ success: true, id });
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "Wrong questions API error"
    });
  }
}
