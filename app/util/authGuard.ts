import { getSession } from "~/lib/session.server";

export async function authGuard(request: Request) {
    const session = await getSession(request);
    if (session.has("email")) {
      return true;
    } else {
      return false;
  }
}

export async function fullAuthGuard(request: Request) {
  const session = await getSession(request);
  
  // Check basic authentication
  if (!session.has("email")) {
    return false;
  }

  // Check MFA flags
  const login = session.get("login");
  const otp = session.get("otp");
  const loginTimestamp = session.get("login_timestamp");

  // Both flags must be true
  if (login !== true || otp !== true) {
    return false;
  }

  // Check 24hr expiry
  if (loginTimestamp) {
    const now = Date.now();
    const elapsed = now - loginTimestamp;
    const sessionExpire = 30 * 60 * 1000; // 30 minutes in milliseconds

    if (elapsed > sessionExpire) {
      // Expired - session will need to reset on next auth check
      return false;
    }
  }

  return true;
}