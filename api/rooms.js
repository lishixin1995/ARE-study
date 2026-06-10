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
      } = typeof request.body === "object" ? request.body : JSON.parse(request.body || "{}");

      if (!id || !division || !name || !roomType) {
        return response.status(400).json({ error: "Missing required room fields." });
      }

      if (!["room", "subroom"].includes(roomType)) {
        return response.status(400).json({ error: "Invalid roomType." });
      }

      await pool.query(
        `
        INSERT INTO study_rooms (id, division, parent_id, room_name, room_type, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [id, division, parentId, name, roomType, sortOrder]
      );

      return response.status(200).json({ success: true });
    }

    if (request.method === "DELETE") {
      const { id } = request.query || {};

      if (!id) {
        return response.status(400).json({ error: "Missing room id." });
      }

      await pool.query(`DELETE FROM study_rooms WHERE parent_id = $1`, [id]);
      await pool.query(`DELETE FROM study_rooms WHERE id = $1`, [id]);

      return response.status(200).json({ success: true });
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "Rooms API error"
    });
  }
}
