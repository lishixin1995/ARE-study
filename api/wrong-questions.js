import { ensureTables, pool } from "./_db.js";
import { requireAuthSession } from "./_auth.js";
import { MISS_REASONS, nextReviewState, normalizeReviewState } from "../src/lib/wrongReview.js";

// Placeholder hook the old flashcard version filled in when it had nothing better.
const LEGACY_DEFAULT_HOOK = "先抓题目核心目标，再选直接对应目标的答案。";
const MISS_REASON_KEYS = new Set(MISS_REASONS.map(([key]) => key));

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

function legacyText(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map(item => (typeof item === "string" ? item : item?.text || item?.label || item?.answer || ""))
    .map(item => String(item).trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeAttachments(value) {
  return Array.isArray(value) ? value.filter(item => item?.dataUrl && item?.name) : [];
}

function cardSelectSql() {
  return `
    id,
    division,
    division AS "divisionId",
    room_id AS "roomId",
    room_name AS "roomName",
    subroom_id AS "subroomId",
    subroom_name AS "subroomName",
    topic_path AS "topicPath",
    title,
    edited_text AS "text",
    question_text AS "questionText",
    image_preview AS "imagePreview",
    attachments,
    answer_text AS "answerText",
    explanation_text AS "explanationText",
    miss_reason AS "missReason",
    review_state AS "reviewState",
    correct_answer AS "legacyCorrectAnswer",
    trap_point AS "legacyTrapPoint",
    memory_hook AS "legacyMemoryHook",
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
    division: card.division || card.divisionId || "",
    divisionId: card.divisionId || card.division || "",
    roomId: card.roomId || "",
    roomName: card.roomName || "",
    subroomId: card.subroomId || "",
    subRoomId: card.subroomId || "",
    subroomName: card.subroomName || "",
    subRoomName: card.subroomName || "",
    topicPath: card.topicPath || "",
    title,
    text,
    questionText: card.questionText || text,
    attachments,
    // NULL means the new editor never saved this field, so show what the old
    // flashcard version stored; an empty string is a deliberate clear.
    answer: card.answerText != null ? normalizeString(card.answerText) : legacyText(card.legacyCorrectAnswer),
    explanation: card.explanationText != null ? normalizeString(card.explanationText) : [
      legacyText(card.legacyTrapPoint),
      normalizeString(card.legacyMemoryHook) === LEGACY_DEFAULT_HOOK ? "" : normalizeString(card.legacyMemoryHook)
    ].filter(Boolean).join("\n"),
    missReason: MISS_REASON_KEYS.has(card.missReason) ? card.missReason : "",
    reviewState: normalizeReviewState(card.reviewState),
    savedAt: card.savedAt
  };
}

export default async function handler(request, response) {
  try {
    if (!requireAuthSession(request, response)) return;
    await ensureTables();

    if (request.method === "GET") {
      const division = normalizeString(request.query?.division);
      const params = [];
      let whereSql = "";

      if (division) {
        params.push(division);
        whereSql = `WHERE division = $1 OR COALESCE(division, '') = ''`;
      }

      const result = await pool.query(`
        SELECT ${cardSelectSql()}
        FROM wrong_question_flashcards
        ${whereSql}
        ORDER BY saved_at DESC
      `, params);

      return response.status(200).json({ flashcards: result.rows.map(normalizeCard) });
    }

    if (request.method === "POST" || request.method === "PUT") {
      const body = readJsonBody(request);
      const id = normalizeString(body.id);
      const text = normalizeString(body.text || body.wrongQuestionText || body.editedText || body.questionText);
      const title = normalizeString(body.title) || text.split(/\r?\n/).find(Boolean) || "Untitled Wrong Question";
      const attachments = normalizeAttachments(body.attachments);
      const division = normalizeString(body.division || body.divisionId);
      const roomId = normalizeString(body.roomId);
      const roomName = normalizeString(body.roomName);
      const subroomId = normalizeString(body.subroomId || body.subRoomId);
      const subroomName = normalizeString(body.subroomName || body.subRoomName);
      const topicPath = normalizeString(body.topicPath) || [division, roomName, subroomName].filter(Boolean).join(" / ");
      const savedAt = body.savedAt || new Date().toISOString();
      // null = field not sent (e.g. a tab still running the old page), which
      // keeps the saved value instead of blanking it.
      const answer = "answer" in body ? normalizeString(body.answer) : null;
      const explanation = "explanation" in body ? normalizeString(body.explanation) : null;
      const missReason = "missReason" in body ? (MISS_REASON_KEYS.has(body.missReason) ? body.missReason : "") : null;

      if (!id || !division || !roomId || !subroomId || (!text && !attachments.length)) {
        return response.status(400).json({ error: "Missing required wrong question fields." });
      }

      const result = await pool.query(
        `
        INSERT INTO wrong_question_flashcards (
          id, division, room_id, room_name, subroom_id, subroom_name,
          title, edited_text, question_text, attachments, saved_at,
          topic_path, image_preview, ocr_text, notes_text, analysis_source_text,
          summary, correct_answer, answer_extraction, bullet_points, trap_point, memory_hook,
          answer_text, explanation_text, miss_reason
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10::jsonb,$11,
          $12, '', '', '', '',
          '', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '',
          $13, $14, $15
        )
        ON CONFLICT (id) DO UPDATE SET
          division = COALESCE(NULLIF(EXCLUDED.division, ''), wrong_question_flashcards.division),
          room_id = COALESCE(NULLIF(EXCLUDED.room_id, ''), wrong_question_flashcards.room_id),
          room_name = COALESCE(NULLIF(EXCLUDED.room_name, ''), wrong_question_flashcards.room_name),
          subroom_id = COALESCE(NULLIF(EXCLUDED.subroom_id, ''), wrong_question_flashcards.subroom_id),
          subroom_name = COALESCE(NULLIF(EXCLUDED.subroom_name, ''), wrong_question_flashcards.subroom_name),
          topic_path = COALESCE(NULLIF(EXCLUDED.topic_path, ''), wrong_question_flashcards.topic_path),
          title = EXCLUDED.title,
          edited_text = EXCLUDED.edited_text,
          question_text = EXCLUDED.question_text,
          attachments = EXCLUDED.attachments,
          answer_text = COALESCE(EXCLUDED.answer_text, wrong_question_flashcards.answer_text),
          explanation_text = COALESCE(EXCLUDED.explanation_text, wrong_question_flashcards.explanation_text),
          miss_reason = COALESCE(EXCLUDED.miss_reason, wrong_question_flashcards.miss_reason),
          saved_at = EXCLUDED.saved_at
        RETURNING ${cardSelectSql()}
        `,
        [id, division, roomId, roomName, subroomId, subroomName, title, text, text, JSON.stringify(attachments), savedAt, topicPath, answer, explanation, missReason]
      );

      return response.status(200).json({ flashcard: normalizeCard(result.rows[0]) });
    }

    // Record a review result. Only review_state changes, so saved_at and the
    // question content stay as the user wrote them.
    if (request.method === "PATCH") {
      const body = readJsonBody(request);
      const id = normalizeString(body.id);
      if (!id) return response.status(400).json({ error: "Missing wrong question id." });
      if (body.result !== "got" && body.result !== "missed") {
        return response.status(400).json({ error: 'Result must be "got" or "missed".' });
      }

      // Lock the row so simultaneous results for one question apply one after
      // another instead of overwriting each other.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT review_state FROM wrong_question_flashcards WHERE id = $1 FOR UPDATE", [id]);
        if (!current.rowCount) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Wrong question not found." });
        }
        const reviewState = nextReviewState(current.rows[0].review_state, body.result);
        const result = await client.query(
          `UPDATE wrong_question_flashcards SET review_state = $2::jsonb WHERE id = $1 RETURNING ${cardSelectSql()}`,
          [id, JSON.stringify(reviewState)]
        );
        await client.query("COMMIT");
        return response.status(200).json({ flashcard: normalizeCard(result.rows[0]) });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
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
