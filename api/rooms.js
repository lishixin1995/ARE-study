import { ensureTables, pool } from "./_db.js";
import { requireAuthSession } from "./_auth.js";

const DEFAULT_ROOM_NAMES = {
  PA: ["Site", "Zoning", "Code", "Programming"],
  PPD: ["Site Planning", "Climate", "Structure", "Systems"],
  PDD: ["Envelope", "Detailing", "Materials", "Documentation"],
  PCM: ["Practice", "Risk", "Contracts", "Finance"],
  PJM: ["Team", "Schedule", "CA", "Delivery"],
  CE: ["Site Visit", "Submittals", "RFI", "Punch List"]
};

function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

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

async function seedDefaultRoomsIfNeeded(division) {
  const existing = await pool.query(
    `SELECT COUNT(*)::int AS count FROM study_rooms WHERE division = $1`,
    [division]
  );

  if (existing.rows[0]?.count > 0) return;

  const defaults = DEFAULT_ROOM_NAMES[division] || [];

  for (let i = 0; i < defaults.length; i += 1) {
    const name = defaults[i];
    await pool.query(
      `
      INSERT INTO study_rooms (id, division, parent_id, room_name, room_type, sort_order)
      VALUES ($1, $2, NULL, $3, 'room', $4)
      ON CONFLICT (id) DO NOTHING
      `,
      [`${division}-${slugify(name)}`, division, name, i]
    );
  }
}

function buildTree(rows = []) {
  const rooms = rows
    .filter(row => row.roomType === "room")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
    .map(row => ({
      id: row.id,
      name: row.name,
      children: rows
        .filter(child => child.roomType === "subroom" && child.parentId === row.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
        .map(child => ({
          id: child.id,
          name: child.name
        }))
    }));

  return rooms;
}

export default async function handler(request, response) {
  try {
    if (!requireAuthSession(request, response)) {
      return;
    }

    await ensureTables();

    if (request.method === "GET") {
      const { division } = request.query || {};

      if (!division) {
        return response.status(400).json({ error: "Missing division." });
      }

      await seedDefaultRoomsIfNeeded(division);

      const result = await pool.query(
        `
        SELECT
          id,
          division,
          parent_id AS "parentId",
          room_name AS "name",
          room_type AS "roomType",
          sort_order AS "sortOrder",
          created_at AS "createdAt"
        FROM study_rooms
        WHERE division = $1
        ORDER BY sort_order ASC, created_at ASC
        `,
        [division]
      );

      return response.status(200).json({ rooms: buildTree(result.rows) });
    }

    if (request.method === "POST") {
      const {
        id,
        division,
        parentId = null,
        name,
        roomType,
        sortOrder = 0
      } = readJsonBody(request);

      if (!id || !division || !name || !roomType) {
        return response.status(400).json({ error: "Missing required room fields." });
      }

      if (!["room", "subroom"].includes(roomType)) {
        return response.status(400).json({ error: "Invalid roomType." });
      }

      const result = await pool.query(
        `
        INSERT INTO study_rooms (id, division, parent_id, room_name, room_type, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, room_name AS "name"
        `,
        [id, division, parentId, name, roomType, sortOrder]
      );

      return response.status(200).json({ success: true, room: result.rows[0] });
    }

    if (request.method === "PUT") {
      const body = readJsonBody(request);
      const id = normalizeString(body.id);
      const division = normalizeString(body.division);
      const parentId = normalizeString(body.parentId);
      const name = normalizeString(body.name);

      if (!id || !division || !parentId || !name) {
        return response.status(400).json({ error: "Missing required sub-room fields." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `
          SELECT id, room_name AS "name", room_type AS "roomType"
          FROM study_rooms
          WHERE id = $1 AND division = $2 AND parent_id = $3
          FOR UPDATE
          `,
          [id, division, parentId]
        );

        if (!existing.rowCount) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Sub-room not found." });
        }

        if (existing.rows[0].roomType !== "subroom") {
          await client.query("ROLLBACK");
          return response.status(400).json({ error: "Only sub-rooms can be renamed here." });
        }

        const updated = await client.query(
          `
          UPDATE study_rooms
          SET room_name = $4
          WHERE id = $1 AND division = $2 AND parent_id = $3 AND room_type = 'subroom'
          RETURNING id, room_name AS "name"
          `,
          [id, division, parentId, name]
        );

        await client.query(
          `
          UPDATE study_notes
          SET subroom_name = $4
          WHERE division = $1 AND room_id = $2 AND subroom_id = $3
          `,
          [division, parentId, id, name]
        );

        await client.query(
          `
          UPDATE wrong_question_flashcards
          SET subroom_name = $4,
              topic_path = CONCAT_WS(' / ', NULLIF(division, ''), NULLIF(room_name, ''), $4)
          WHERE division = $1 AND room_id = $2 AND subroom_id = $3
          `,
          [division, parentId, id, name]
        );

        await client.query("COMMIT");
        return response.status(200).json({ success: true, room: updated.rows[0] });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    if (request.method === "DELETE") {
      const id = normalizeString(request.query?.id);
      const division = normalizeString(request.query?.division);
      const parentId = normalizeString(request.query?.parentId);

      if (!id || !division || !parentId) {
        return response.status(400).json({ error: "Missing sub-room delete fields." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `
          SELECT id, room_name AS "name", room_type AS "roomType"
          FROM study_rooms
          WHERE id = $1 AND division = $2 AND parent_id = $3
          FOR UPDATE
          `,
          [id, division, parentId]
        );

        if (!existing.rowCount) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Sub-room not found." });
        }

        if (existing.rows[0].roomType !== "subroom") {
          await client.query("ROLLBACK");
          return response.status(400).json({ error: "Only sub-rooms can be deleted here." });
        }

        const deletedNotes = await client.query(
          "DELETE FROM study_notes WHERE division = $1 AND room_id = $2 AND subroom_id = $3 RETURNING id",
          [division, parentId, id]
        );
        const deletedWrongQuestions = await client.query(
          "DELETE FROM wrong_question_flashcards WHERE division = $1 AND room_id = $2 AND subroom_id = $3 RETURNING id",
          [division, parentId, id]
        );
        await client.query(
          "DELETE FROM study_rooms WHERE id = $1 AND division = $2 AND parent_id = $3 AND room_type = 'subroom'",
          [id, division, parentId]
        );

        await client.query("COMMIT");
        return response.status(200).json({
          success: true,
          id,
          deleted: {
            notes: deletedNotes.rowCount,
            wrongQuestions: deletedWrongQuestions.rowCount
          }
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "Rooms API error"
    });
  }
}
