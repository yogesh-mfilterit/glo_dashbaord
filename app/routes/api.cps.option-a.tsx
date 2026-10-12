// app/routes/api.cps.option-a.tsx   ->  POST /api/cps/option-a  (mFilterIt-hosted page)
import crypto from 'node:crypto';
import type { ActionFunctionArgs } from '@remix-run/node';
import { guard, ok, fail, errMsg } from '~/lib/cp/http.server';
import * as dynamo from '~/lib/cp/dynamo.server';

const TEMPLATE_FOLDERS = new Set(['demo-cp', 'demo-cp2', 'demo-cp3', 'demo-cp4', 'demo-cp5']);

export async function action({ request }: ActionFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  if (request.method !== 'POST') return fail(405, 'Method not allowed');

  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, any>;
    if (!b.cpName || !b.serviceName) return fail(400, 'cpName and serviceName are required');

    const folder = TEMPLATE_FOLDERS.has(b.folder) ? b.folder : 'demo-cp';
    const cpId = `cpA-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const now = Date.now();

    const item = await dynamo.putCp({
      id: cpId,
      cpId,
      method: 'A',
      status: 'draft',
      cpName: String(b.cpName),
      serviceName: String(b.serviceName),
      serviceText: String(b.serviceText || ''),
      price: String(b.price || ''),
      period: String(b.period || 'Day'),
      trial: Number(b.trial || 0),
      banner: String(b.banner || ''),
      support: String(b.support || ''),
      shortcode: String(b.shortcode || ''),
      consent: String(b.consent || ''),
      folder,
      s3Prefix: null, // Option A: folder = shared template family
      createdAt: now,
      updatedAt: now,
    });
    return ok({ item });
  } catch (e) {
    console.error('[cp] create option-a failed', e);
    return fail(500, `Could not create content provider: ${errMsg(e)}`);
  }
}
