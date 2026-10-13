// app/routes/api.cps.option-b.approve.tsx   ->  POST /api/cps/option-b/approve
// Upload Raw + Standard to S3, save Dynamo row.
import type { ActionFunctionArgs } from '@remix-run/node';
import { guard, ok, fail, errMsg } from '~/lib/cp/http.server';
import * as dynamo from '~/lib/cp/dynamo.server';
import { uploadPackage, deleteFolder, BUCKET } from '~/lib/cp/s3.server';
import { getPreview, deletePreview } from '~/lib/cp/preview-store.server';

export async function action({ request }: ActionFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  if (request.method !== 'POST') return fail(405, 'Method not allowed');

  const body = (await request.json().catch(() => ({}))) as { previewId?: string };
  const p = getPreview(String(body.previewId || ''));
  if (!p) return fail(404, 'Preview expired - upload the ZIP again');

  try {
    await deleteFolder(p.folder); // re-upload replaces old Raw + Standard
    const uploaded = await uploadPackage(p.folder, p.files, p.standardPages);
    console.log('[cp approve] raw:', uploaded.rawIndexKey, 'standard:', uploaded.standardKeys);

    const existing = await dynamo.getCp(p.folder);
    const now = Date.now();
    const item = await dynamo.putCp({
      ...(existing || {}), // keep price/period/etc. from earlier saves
      id: p.folder,
      cpId: p.folder,
      serviceId: p.serviceId,
      cpName: p.cpName,
      serviceName: p.serviceName,
      method: 'B',
      status: existing?.status || 'draft',
      folder: p.folder,
      pages: p.pages,
      s3Prefix: `${BUCKET}/cp-packages/${p.folder}/`,
      rawIndexKey: uploaded.rawIndexKey,
      standardIndexKey: uploaded.standardIndexKey,
      standardKeys: uploaded.standardKeys,
      warnings: p.warnings,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    deletePreview(p.id);
    return ok({ item, rawIndexKey: uploaded.rawIndexKey, standardKeys: uploaded.standardKeys });
  } catch (e) {
    console.error('[cp approve] error', e);
    return fail(500, errMsg(e));
  }
}