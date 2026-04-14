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
      const { division, roomId, subroomId = "" } = request.query || {};

      if (!division || !roomId) {
        return response.status(400).json({ error: "Missing division or roomId." });
      }

      const result = await pool.query(
        `
        SELECT
          id,
          division,
          room_id AS "roomId",
          room_name AS "roomName",
          subroom_id AS "subroomId",
          subroom_name AS "subroomName",
          note_text AS "text",
          saved_at AS "savedAt"
        FROM study_notes
        WHERE division = $1
          AND room_id = $2
          AND COALESCE(subroom_id, '') = $3
        ORDER BY saved_at DESC
        `,
        [division, roomId, subroomId]
      );

      return response.status(200).json({ notes: result.rows });
    }

    if (request.method === "POST") {
      const body = readJsonBody(request);

      const {
        id,
        division,
        roomId,
        roomName = "",
        subroomId = "",
        subroomName = "",
        text = "",
        savedAt
      } = body;

      if (!id || !division || !roomId || !String(text).trim()) {
        return response.status(400).json({ error: "Missing required note fields." });
      }

      const result = await pool.query(
        `
        INSERT INTO study_notes (
          id, division, room_id, room_name, subroom_id, subroom_name, note_text, saved_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING
          id,
          division,
          room_id AS "roomId",
          room_name AS "roomName",
          subroom_id AS "subroomId",
          subroom_name AS "subroomName",
          note_text AS "text",
          saved_at AS "savedAt"
        `,
        [
          id,
          division,
          roomId,
          roomName,
          subroomId || "",
          subroomName || "",
          text,
          savedAt || new Date().toISOString()
        ]
      );

      return response.status(200).json({ note: result.rows[0] });
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "Notes API error"
    });
  }
}
