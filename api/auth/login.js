import { createAuthSessionCookie, isPasscodeConfigured, isPasscodeValid } from "../_auth.js";

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
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!isPasscodeConfigured()) {
    return response.status(500).json({ error: "SITE_PASSCODE is not configured." });
  }

  const { passcode = "" } = readJsonBody(request);
  if (!isPasscodeValid(passcode)) {
    return response.status(401).json({ error: "Invalid passcode." });
  }

  response.setHeader("Set-Cookie", createAuthSessionCookie());
  return response.status(200).json({ authenticated: true });
}
