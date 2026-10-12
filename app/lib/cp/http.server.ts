// app/lib/cp/http.server.ts
import { json } from '@remix-run/node';
import { fullAuthGuard } from '~/util/authGuard';
import { SECURITY_HEADERS } from '~/lib/security-headers.server';

export const ok = (body: Record<string, unknown> = {}, status = 200) =>
  json({ ok: true, ...body }, { status, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' } });

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  json({ ok: false, error, ...extra }, { status, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' } });

/** returns a 401 Response when not logged in, else null */
export async function guard(request: Request) {
  const authed = await fullAuthGuard(request);
  return authed ? null : fail(401, 'Unauthorized');
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
