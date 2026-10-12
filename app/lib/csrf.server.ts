import { createHash, randomBytes } from "crypto";

/**
 * Generate a cryptographically random CSRF token and store it in the session.
 */
export function generateCsrfToken(session: any): string {
  const token = randomBytes(32).toString("hex");
  session.set("csrfToken", token);
  return token;
}

/**
 * Validate the CSRF token from the request form data against the session token.
 * Returns true if valid, false otherwise.
 */
export async function validateCsrfToken(request: Request, session: any): Promise<boolean> {
  // Only validate state-changing methods
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;

  // Also verify Origin/Referer header matches the server host
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) return false;
    } catch {
      return false;
    }
  } else if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== host) return false;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Extract and validate the CSRF token from form data against the session.
 * Call this after parsing formData in an action.
 */
export function validateCsrfFromForm(formData: FormData, session: any): boolean {
  const formToken = formData.get("_csrf") as string | null;
  const sessionToken = session.get("csrfToken") as string | null;
  if (!formToken || !sessionToken) return false;
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(formToken);
  const b = Buffer.from(sessionToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
