const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptRecord {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

const store = new Map<string, AttemptRecord>();

export function checkRateLimit(ip: string): { blocked: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const record = store.get(ip);

  if (record?.lockedUntil) {
    if (now < record.lockedUntil) {
      return { blocked: true, retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000) };
    }
    store.delete(ip);
  }

  return { blocked: false };
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = store.get(ip);

  if (!record || now - record.firstAttempt > WINDOW_MS) {
    store.set(ip, { count: 1, firstAttempt: now });
    return;
  }

  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
  }
}

export function resetAttempts(ip: string): void {
  store.delete(ip);
}
