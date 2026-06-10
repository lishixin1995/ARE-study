import { createHash, createHmac, timingSafeEqual } from "crypto";

const SESSION_COOKIE = "are_study_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getSitePasscode() {
  return String(process.env.SITE_PASSCODE || "");
}

function hashString(value = "") {
  return createHash("sha256").update(String(value)).digest();
}

function safeEqualString(left = "", right = "") {
  const leftHash = hashString(left);
  const rightHash = hashString(right);
  return timingSafeEqual(leftHash, rightHash);
}

function signSessionPayload(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function parseCookies(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function isPasscodeConfigured() {
  return Boolean(getSitePasscode());
}

export function isPasscodeValid(passcode = "") {
  const sitePasscode = getSitePasscode();
  return Boolean(sitePasscode) && safeEqualString(passcode, sitePasscode);
}

export function createAuthSessionCookie() {
  const sitePasscode = getSitePasscode();
  if (!sitePasscode) {
    throw new Error("SITE_PASSCODE is not configured.");
  }

  const payload = {
    v: 1,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signSessionPayload(encodedPayload, sitePasscode);

  return buildCookie(SESSION_COOKIE, `${encodedPayload}.${signature}`, {
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export function clearAuthSessionCookie() {
  return buildCookie(SESSION_COOKIE, "", {
    maxAge: 0,
    expires: new Date(0)
  });
}

export function verifyAuthSession(request) {
  const sitePasscode = getSitePasscode();
  if (!sitePasscode) return false;

  const cookies = parseCookies(request?.headers?.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token || !token.includes(".")) return false;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return false;

  const expectedSignature = signSessionPayload(encodedPayload, sitePasscode);
  if (!safeEqualString(signature, expectedSignature)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return payload?.v === 1 && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

export function requireAuthSession(request, response) {
  if (verifyAuthSession(request)) return true;

  response.status(401).json({ error: "Unauthorized" });
  return false;
}
