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

function cleanKey(value = "") {
  return String(value || "").trim();
}

export default async function handler(request, response) {
  try {
    if (!requireAuthSession(request, response)) {
      return;
    }

    await ensureTables();

    if (request.method === "GET") {
      const app = cleanKey(request.query?.app || "are-study");
      const key = cleanKey(request.query?.key);

      if (!app || !key) {
        return response.status(400).json({ error: "Missing cloud data key." });
      }

      const result = await pool.query(
        `
        SELECT
          app_key AS "app",
          data_key AS "key",
          data,
          updated_at AS "updatedAt"
        FROM app_cloud_data
        WHERE app_key = $1 AND data_key = $2
        `,
        [app, key]
      );

      return response.status(200).json({ item: result.rows[0] || null });
    }

    if (request.method === "POST") {
      const body = readJsonBody(request);
      const app = cleanKey(body.app || "are-study");
      const key = cleanKey(body.key);

      if (!app || !key) {
        return response.status(400).json({ error: "Missing cloud data key." });
      }

      const result = await pool.query(
        `
        INSERT INTO app_cloud_data (app_key, data_key, data, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (app_key, data_key)
        DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING
          app_key AS "app",
          data_key AS "key",
          data,
          updated_at AS "updatedAt"
        `,
        [app, key, JSON.stringify(body.data ?? null)]
      );

      return response.status(200).json({ item: result.rows[0] });
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "Cloud data API error"
    });
  }
}
