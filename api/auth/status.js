import { isPasscodeConfigured, verifyAuthSession } from "../_auth.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  return response.status(200).json({
    authenticated: verifyAuthSession(request),
    configured: isPasscodeConfigured()
  });
}
