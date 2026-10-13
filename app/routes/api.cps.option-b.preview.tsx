// app/routes/api.cps.option-b.preview.tsx   ->  POST /api/cps/option-b/preview
// Validate ZIP, build Standard EJS pages, keep IN MEMORY (nothing saved yet).
import type { ActionFunctionArgs } from '@remix-run/node';
import { guard, ok, fail, errMsg } from '~/lib/cp/http.server';
import * as dynamo from '~/lib/cp/dynamo.server';
import { validateAndExtract, MAX_TOTAL_BYTES } from '~/lib/cp/zip.server';
import { buildStandardPages } from '~/lib/cp/inject.server';
import { listServiceIds, SERVICE_ID_TABLE } from '~/lib/cp/serviceids.server';
import { createPreview, compileCheck, folderFromZipName, sanitizeFolder } from '~/lib/cp/preview-store.server';

export async function action({ request }: ActionFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  if (request.method !== 'POST') return fail(405, 'Method not allowed');

  try {
    const form = await request.formData();
    const file = form.get('package');
    if (!file || typeof file === 'string') return fail(400, "ZIP file missing (field 'package')");
    if (file.size > MAX_TOTAL_BYTES) return fail(413, 'ZIP larger than 30MB');

    // Service ID must exist in the serviceId-details table
    const serviceId = String(form.get('serviceId') || '').trim();
    if (!serviceId) return fail(400, 'Service ID is required');
    const match = (await listServiceIds()).find((o) => o.serviceId === serviceId);
    if (!match) return fail(400, `Service ID "${serviceId}" was not found in ${SERVICE_ID_TABLE}`);

    const serviceName = match.serviceName || serviceId;
    const cpName = match.cpName || serviceName;

    const result = validateAndExtract(Buffer.from(await file.arrayBuffer()));
    if (!result.ok) {
      return fail(400, result.errors.join('; '), { errors: result.errors, warnings: result.warnings });
    }

    // re-upload flow: keep existing Option-B folder if it really exists
    let folder = folderFromZipName(file.name);
    const requested = sanitizeFolder(String(form.get('folder') || ''));
    if (requested) {
      const cur = await dynamo.getCp(requested);
      if (cur && cur.method === 'B') folder = requested;
    }

    const standardPages = buildStandardPages(result.files, folder);
    const compileErr = compileCheck(standardPages);
    if (compileErr) return fail(400, compileErr);

    const pages = result.files
      .map((f) => f.relPath)
      .filter((r) => /^[^/]+\.html$/i.test(r))
      .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));

    const p = createPreview({
      serviceId, folder, cpName, serviceName, pages,
      files: result.files, standardPages, warnings: result.warnings,
    });
    console.log('[cp preview] created', p.id, 'service:', serviceId, 'folder:', folder);

    return ok({
      previewId: p.id,
      folder,
      pages,
      previewBaseUrl: `/api/cps/preview/${p.id}/files/`,
      previewUrl: `/api/cps/preview/${p.id}/files/index.html`,
      warnings: result.warnings,
      fileCount: result.files.length,
    });
  } catch (e) {
    console.error('[cp preview] error', e);
    return fail(500, errMsg(e));
  }
}