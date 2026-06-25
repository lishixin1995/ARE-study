import { ensureTables, pool } from "./_db.js";
import { requireAuthSession } from "./_auth.js";

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

function normalizeAttachments(value) {
  return Array.isArray(value) ? value.filter(item => item?.dataUrl && item?.name) : [];
}

function cardSelectSql() {
  return `
    id,
    title,
    edited_text AS "text",
    question_text AS "questionText",
    image_preview AS "imagePreview",
    attachments,
    saved_at AS "savedAt"
  `;
}

function normalizeCard(card = {}) {
  const text = normalizeString(card.text || card.questionText || "");
  const title = normalizeString(card.title) || text.split(/\r?\n/).find(Boolean) || "Untitled Wrong Question";
  const attachments = normalizeAttachments(card.attachments);
  if (card.imagePreview && !attachments.some(item => item.dataUrl === card.imagePreview)) {
    attachments.push({
      id: `${card.id || "legacy"}-image-preview`,
      name: "Legacy wrong question image",
      type: "image/png",
      size: 0,
      kind: "image",
      dataUrl: card.imagePreview
    });
  }

  return {
    id: card.id,
    title,
    text,
    questionText: card.questionText || text,
    attachments,
    savedAt: card.savedAt
  };
}

export default async function handler(request, response) {
  try {
    if (!requireAuthSession(request, response)) return;
    await ensureTables();

    if (request.method === "GET") {
      const result = await pool.query(`
        SELECT ${cardSelectSql()}
        FROM wrong_question_flashcards
        ORDER BY saved_at DESC
      `);

      return response.status(200).json({ flashcards: result.rows.map(normalizeCard) });
    }

    if (request.method === "POST" || request.method === "PUT") {
      const body = readJsonBody(request);
      const id = normalizeString(body.id);
      const text = normalizeString(body.text || body.wrongQuestionText || body.editedText || body.questionText);
      const title = normalizeString(body.title) || text.split(/\r?\n/).find(Boolean) || "Untitled Wrong Question";
      const attachments = normalizeAttachments(body.attachments);
      const savedAt = body.savedAt || new Date().toISOString();

      if (!id || (!text && !attachments.length)) {
        return response.status(400).json({ error: "Missing required wrong question fields." });
      }

      const result = await pool.query(
        `
        INSERT INTO wrong_question_flashcards (
          id, title, edited_text, question_text, attachments, saved_at,
          topic_path, image_preview, ocr_text, notes_text, analysis_source_text,
          summary, correct_answer, answer_extraction, bullet_points, trap_point, memory_hook
        )
        VALUES (
          $1,$2,$3,$4,$5::jsonb,$6,
          '', '', '', '', '',
          '', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ''
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          edited_text = EXCLUDED.edited_text,
          question_text = EXCLUDED.question_text,
          attachments = EXCLUDED.attachments,
          saved_at = EXCLUDED.saved_at
        RETURNING ${cardSelectSql()}
        `,
        [id, title, text, text, JSON.stringify(attachments), savedAt]
      );

      return response.status(200).json({ flashcard: normalizeCard(result.rows[0]) });
    }

    if (request.method === "DELETE") {
      const id = normalizeString(request.query?.id || readJsonBody(request)?.id);
      if (!id) return response.status(400).json({ error: "Missing wrong question id." });

      const result = await pool.query("DELETE FROM wrong_question_flashcards WHERE id = $1 RETURNING id", [id]);
      if (!result.rowCount) return response.status(404).json({ error: "Wrong question not found." });

      return response.status(200).json({ success: true, id });
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({ error: error?.message || "Wrong questions API error" });
  }
}
