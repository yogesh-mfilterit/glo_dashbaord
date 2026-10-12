// app/lib/cp/zip.server.ts
// Validate + extract partner ZIP in memory. Missing placeholders/markers = ERROR.
import AdmZip from 'adm-zip';
import path from 'node:path';
import type { PackageFile } from './s3.server';

export const ALLOWED_EXT = new Set([
  '.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf',
]);
export const REQUIRED_DIRS = ['styles/', 'scripts/', 'assets/'];
const MAX_FILES = 300;
export const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

export const REQUIRED_PLACEHOLDERS: Record<string, string[]> = {
  'index.html': ['SERVICE_NAME', 'SERVICE_TEXT', 'BANNER_URL', 'PRODUCT_ID', 'PRICE_AMOUNT', 'PERIOD', 'PRICE', 'CONSENT_TEXT'],
};

export const REQUIRED_MARKERS: Record<string, { re: RegExp; msg: string }[]> = {
  'index.html': [
    { re: /data-mf-cta/i, msg: 'Subscribe button must have the attribute data-mf-cta' },
    {
      re: /data-mf-product\s*=\s*["']\s*\{\{\s*PRODUCT_ID\s*\}\}\s*["']/i,
      msg: 'Plan element must have data-mf-product="{{PRODUCT_ID}}"',
    },
  ],
};

export const stripComments = (html: string) => String(html || '').replace(/<!--[\s\S]*?-->/g, '');
export const findPlaceholders = (html: string) =>
  new Set([...String(html).matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((m) => m[1]));

export function validatePage(page: string, html: string): string[] {
  const errors: string[] = [];
  const clean = stripComments(html);
  const found = findPlaceholders(clean);

  const missing = (REQUIRED_PLACEHOLDERS[page] || []).filter((k) => !found.has(k));
  if (missing.length) errors.push(`${page}: missing required placeholder(s): ${missing.map((k) => `{{${k}}}`).join(', ')}`);

  (REQUIRED_MARKERS[page] || []).forEach((m) => {
    if (!m.re.test(clean)) errors.push(`${page}: ${m.msg}`);
  });
  return errors;
}

export type ZipResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  files: PackageFile[];
  indexHtml: string;
};

export function validateAndExtract(zipBuffer: Buffer): ZipResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    return { ok: false, errors: ['Could not open ZIP — file may be corrupt'], warnings, files: [], indexHtml: '' };
  }

  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && !e.entryName.startsWith('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(e.entryName));
  if (!entries.length) errors.push('ZIP is empty');
  if (entries.length > MAX_FILES) errors.push(`Too many files (${entries.length}, max ${MAX_FILES})`);

  const declared = entries.reduce((s, e) => s + e.header.size, 0);
  if (declared > MAX_TOTAL_BYTES) errors.push('Package exceeds 30MB uncompressed');
  if (errors.length) return { ok: false, errors, warnings, files: [], indexHtml: '' };

  // strip single top-level wrapper folder
  const names = entries.map((e) => e.entryName.replace(/\\/g, '/'));
  const firstSeg = names[0] ? names[0].split('/')[0] : '';
  const allShareWrapper = !!firstSeg && names.every((n) => n.startsWith(firstSeg + '/'));
  const stripPrefix = allShareWrapper ? firstSeg + '/' : '';

  const files: PackageFile[] = [];
  let indexHtml = '';
  let actualBytes = 0;

  for (const entry of entries) {
    const rel = entry.entryName.replace(/\\/g, '/').slice(stripPrefix.length);
    if (!rel) continue;

    const resolved = path.posix.normalize(rel);
    if (resolved.startsWith('..') || path.posix.isAbsolute(resolved)) {
      errors.push(`Unsafe path in package: ${rel}`);
      continue;
    }

    const ext = '.' + (rel.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      errors.push(`File type not allowed: ${rel}`);
      continue;
    }

    const buffer = entry.getData();
    actualBytes += buffer.length;
    if (actualBytes > MAX_TOTAL_BYTES) {
      errors.push('Package exceeds 30MB uncompressed');
      break;
    }
    files.push({ relPath: resolved, buffer });
    if (resolved === 'index.html') indexHtml = buffer.toString('utf8');
  }

  if (!indexHtml) errors.push('index.html missing at package root');
  else errors.push(...validatePage('index.html', indexHtml));

  REQUIRED_DIRS.forEach((dir) => {
    if (!files.some((f) => f.relPath.startsWith(dir))) warnings.push(`No ${dir} folder found (not fatal, but recommended)`);
  });

  return { ok: errors.length === 0, errors, warnings, files, indexHtml };
}
