// app/routes/api.cps.$cpId.tsx   ->  GET | PATCH | DELETE /api/cps/:cpId
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { guard, ok, fail, errMsg } from '~/lib/cp/http.server';
import * as dynamo from '~/lib/cp/dynamo.server';
import { deleteFolder } from '~/lib/cp/s3.server';

const ALLOWED = [
  'status', 'cpName', 'serviceName', 'serviceText', 'price', 'period',
  'trial', 'banner', 'support', 'shortcode', 'consent', 'method', 'folder',
] as const;
const STATUSES = new Set(['draft', 'uat', 'live']);
const METHODS = new Set(['A', 'B']);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const item = await dynamo.getCp(params.cpId!);
    return item ? ok({ item }) : fail(404, 'Not found');
  } catch (e) {
    console.error('[cp] get failed', e);
    return fail(500, `Could not fetch content provider: ${errMsg(e)}`);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  const id = params.cpId!;

  try {
    const existing = await dynamo.getCp(id);
    if (!existing) return fail(404, 'Not found');

    /* ---------- PATCH ---------- */
    if (request.method === 'PATCH') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      ALLOWED.forEach((k) => {
        if (body[k] !== undefined) patch[k] = body[k];
      });
      if (patch.status !== undefined && !STATUSES.has(String(patch.status))) return fail(400, 'Invalid status');
      if (patch.method !== undefined && !METHODS.has(String(patch.method))) return fail(400, 'Invalid method');
      if (patch.folder !== undefined) patch.folder = String(patch.folder).replace(/[^a-zA-Z0-9-_]/g, '');
      patch.updatedAt = Date.now();

      // B -> A switch: drop old uploaded package from S3
      if (existing.method === 'B' && patch.method === 'A' && existing.folder && existing.folder !== patch.folder) {
        await deleteFolder(existing.folder).catch((e) => console.warn('[cp] s3 cleanup failed', errMsg(e)));
        patch.s3Prefix = null;
      }

      const item = await dynamo.updateCp(id, patch);
      return ok({ item });
    }

    /* ---------- DELETE ---------- */
    if (request.method === 'DELETE') {
      if (existing.method === 'B' && existing.folder) {
        await deleteFolder(existing.folder).catch((e) => console.warn('[cp] s3 cleanup failed', errMsg(e)));
      }
      await dynamo.deleteCp(id);
      return ok();
    }

    return fail(405, 'Method not allowed');
  } catch (e) {
    console.error('[cp] mutate failed', e);
    return fail(500, errMsg(e));
  }
}
