// app/routes/api.cps.option-b.preview.tsx   ->  POST /api/cps/option-b/preview
// Validate ZIP, build Standard EJS pages, keep IN MEMORY (nothing saved yet).
import type { ActionFunctionArgs } from '@remix-run/node';
import { guard, ok, fail, errMsg } from '~/lib/cp/http.server';
import * as dynamo from '~/lib/cp/dynamo.server';
import { validateAndExtract, MAX_TOTAL_BYTES } from '~/lib/cp/zip.server';
import { buildStandardPages } from '~/lib/cp/inject.server';
import { createPreview, compileCheck, folderFromZipName, sanitizeFolder } from '~/lib/cp/preview-store.server';

const MAX_ZIP_BYTES = MAX_TOTAL_BYTES;

export async function action({ request }: ActionFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  if (request.method !== 'POST') return fail(405, 'Method not allowed');

  try {
    const form = await request.formData();
    const file = form.get('package');
    if (!file || typeof file === 'string') return fail(400, "ZIP file missing (field 'package')");
    if (file.size > MAX_ZIP_BYTES) return fail(413, 'ZIP larger than 30MB');

    // serviceId fallback keeps the old /service-zip page working
    const serviceName = String(form.get('serviceName') || form.get('serviceId') || '').trim();
    const cpName = String(form.get('cpName') || serviceName).trim();
    if (!cpName || !serviceName) return fail(400, 'cpName and serviceName are required');

    const result = validateAndExtract(Buffer.from(await file.arrayBuffer()));
    if (!result.ok) {
      return fail(400, result.errors.join('; '), { errors: result.errors, warnings: result.warnings });
    }

    // update flow: keep existing Option-B folder if it really exists
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

    const p = createPreview({ folder, cpName, serviceName, pages, files: result.files, standardPages, warnings: result.warnings });
    console.log('[cp preview] created', p.id, 'folder:', folder, 'pages:', pages.join(', '));

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
