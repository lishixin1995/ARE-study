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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const initialized = await client.query(
      `
      INSERT INTO study_room_divisions (division)
      VALUES ($1)
      ON CONFLICT (division) DO NOTHING
      RETURNING division
      `,
      [division]
    );

    if (!initialized.rowCount) {
      await client.query("COMMIT");
      return;
    }

    const existing = await client.query(
      `SELECT COUNT(*)::int AS count FROM study_rooms WHERE division = $1`,
      [division]
    );
    const defaults = existing.rows[0]?.count > 0 ? [] : DEFAULT_ROOM_NAMES[division] || [];

    for (let i = 0; i < defaults.length; i += 1) {
      const name = defaults[i];
      await client.query(
        `
        INSERT INTO study_rooms (id, division, parent_id, room_name, room_type, sort_order)
        VALUES ($1, $2, NULL, $3, 'room', $4)
        ON CONFLICT (id) DO NOTHING
        `,
        [`${division}-${slugify(name)}`, division, name, i]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function markDivisionInitialized(division) {
  await pool.query(
    `
    INSERT INTO study_room_divisions (division)
    VALUES ($1)
    ON CONFLICT (division) DO NOTHING
    `,
    [division]
  );
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
      const body = readJsonBody(request);
      const id = normalizeString(body.id);
      const division = normalizeString(body.division);
      const parentId = normalizeString(body.parentId) || null;
      const name = normalizeString(body.name);
      const roomType = normalizeString(body.roomType);
      const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;

      if (!id || !division || !name || !roomType) {
        return response.status(400).json({ error: "Missing required room fields." });
      }

      if (!["room", "subroom"].includes(roomType)) {
        return response.status(400).json({ error: "Invalid roomType." });
      }

      if (roomType === "room" && parentId) {
        return response.status(400).json({ error: "Top-level rooms cannot have a parent." });
      }

      if (roomType === "subroom" && !parentId) {
        return response.status(400).json({ error: "Sub-rooms require a parent room." });
      }

      if (roomType === "subroom") {
        const parent = await pool.query(
          `SELECT id FROM study_rooms WHERE id = $1 AND division = $2 AND room_type = 'room'`,
          [parentId, division]
        );
        if (!parent.rowCount) {
          return response.status(404).json({ error: "Parent room not found." });
        }
      }

      await markDivisionInitialized(division);

      const result = await pool.query(
        `
        INSERT INTO study_rooms (id, division, parent_id, room_name, room_type, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, room_name AS "name", room_type AS "roomType"
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
      const requestedRoomType = normalizeString(body.roomType);

      if (!id || !division || !name) {
        return response.status(400).json({ error: "Missing required room fields." });
      }

      await markDivisionInitialized(division);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `
          SELECT id, parent_id AS "parentId", room_name AS "name", room_type AS "roomType"
          FROM study_rooms
          WHERE id = $1 AND division = $2
          FOR UPDATE
          `,
          [id, division]
        );

        if (!existing.rowCount) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Room not found." });
        }

        const current = existing.rows[0];
        if (requestedRoomType && requestedRoomType !== current.roomType) {
          await client.query("ROLLBACK");
          return response.status(400).json({ error: "Room type does not match the saved item." });
        }

        if (current.roomType === "subroom") {
          if (!parentId || parentId !== current.parentId) {
            await client.query("ROLLBACK");
            return response.status(400).json({ error: "Sub-room parent does not match." });
          }

          const updated = await client.query(
            `
            UPDATE study_rooms
            SET room_name = $4
            WHERE id = $1 AND division = $2 AND parent_id = $3 AND room_type = 'subroom'
            RETURNING id, room_name AS "name", room_type AS "roomType"
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
        }

        const updated = await client.query(
          `
          UPDATE study_rooms
          SET room_name = $3
          WHERE id = $1 AND division = $2 AND room_type = 'room'
          RETURNING id, room_name AS "name", room_type AS "roomType"
          `,
          [id, division, name]
        );

        await client.query(
          `UPDATE study_notes SET room_name = $3 WHERE division = $1 AND room_id = $2`,
          [division, id, name]
        );

        await client.query(
          `
          UPDATE wrong_question_flashcards
          SET room_name = $3,
              topic_path = CONCAT_WS(' / ', NULLIF(division, ''), $3, NULLIF(subroom_name, ''))
          WHERE division = $1 AND room_id = $2
          `,
          [division, id, name]
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

      if (!id || !division) {
        return response.status(400).json({ error: "Missing room delete fields." });
      }

      await markDivisionInitialized(division);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `
          SELECT id, parent_id AS "parentId", room_name AS "name", room_type AS "roomType"
          FROM study_rooms
          WHERE id = $1 AND division = $2
          FOR UPDATE
          `,
          [id, division]
        );

        if (!existing.rowCount) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Room not found." });
        }

        const current = existing.rows[0];
        if (current.roomType === "subroom") {
          if (!parentId || parentId !== current.parentId) {
            await client.query("ROLLBACK");
            return response.status(400).json({ error: "Sub-room parent does not match." });
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
            roomType: current.roomType,
            deleted: {
              subrooms: 0,
              notes: deletedNotes.rowCount,
              wrongQuestions: deletedWrongQuestions.rowCount
            }
          });
        }

        const deletedNotes = await client.query(
          "DELETE FROM study_notes WHERE division = $1 AND room_id = $2 RETURNING id",
          [division, id]
        );
        const deletedWrongQuestions = await client.query(
          "DELETE FROM wrong_question_flashcards WHERE division = $1 AND room_id = $2 RETURNING id",
          [division, id]
        );
        const deletedSubrooms = await client.query(
          "DELETE FROM study_rooms WHERE division = $1 AND parent_id = $2 AND room_type = 'subroom' RETURNING id",
          [division, id]
        );
        await client.query(
          "DELETE FROM study_rooms WHERE id = $1 AND division = $2 AND room_type = 'room'",
          [id, division]
        );

        await client.query("COMMIT");
        return response.status(200).json({
          success: true,
          id,
          roomType: current.roomType,
          deleted: {
            subrooms: deletedSubrooms.rowCount,
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
