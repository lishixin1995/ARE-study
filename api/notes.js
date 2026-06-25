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

function noteSelectSql() {
  return `
    id,
    division,
    room_id AS "roomId",
    room_name AS "roomName",
    subroom_id AS "subroomId",
    subroom_name AS "subroomName",
    note_text AS "text",
    saved_at AS "savedAt"
  `;
}

export default async function handler(request, response) {
  try {
    if (!requireAuthSession(request, response)) return;
    await ensureTables();

    if (request.method === "GET") {
      const { division, roomId = "", subroomId = "" } = request.query || {};
      if (!division) return response.status(400).json({ error: "Missing division." });

      const params = [division];
      let whereSql = "WHERE division = $1";

      if (String(roomId).trim()) {
        params.push(roomId);
        whereSql += ` AND room_id = $${params.length}`;
      }

      if (String(subroomId).trim()) {
        params.push(subroomId);
        whereSql += ` AND COALESCE(subroom_id, '') = $${params.length}`;
      }

      const result = await pool.query(
        `SELECT ${noteSelectSql()} FROM study_notes ${whereSql} ORDER BY saved_at DESC`,
        params
      );

      return response.status(200).json({ notes: result.rows });
    }

    if (request.method === "POST" || request.method === "PUT") {
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
        ON CONFLICT (id) DO UPDATE SET
          division = EXCLUDED.division,
          room_id = EXCLUDED.room_id,
          room_name = EXCLUDED.room_name,
          subroom_id = EXCLUDED.subroom_id,
          subroom_name = EXCLUDED.subroom_name,
          note_text = EXCLUDED.note_text,
          saved_at = EXCLUDED.saved_at
        RETURNING ${noteSelectSql()}
        `,
        [id, division, roomId, roomName, subroomId || "", subroomName || "", text, savedAt || new Date().toISOString()]
      );

      return response.status(200).json({ note: result.rows[0] });
    }

    if (request.method === "DELETE") {
      const id = request.query?.id || readJsonBody(request)?.id || "";
      if (!String(id).trim()) return response.status(400).json({ error: "Missing note id." });

      const result = await pool.query("DELETE FROM study_notes WHERE id = $1 RETURNING id", [id]);
      if (!result.rowCount) return response.status(404).json({ error: "Note not found." });
      return response.status(200).json({ success: true, id });
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({ error: error?.message || "Notes API error" });
  }
}
