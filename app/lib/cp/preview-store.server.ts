// app/lib/cp/preview-store.server.ts
// In-memory Option-B previews (30 min) + preview rendering.
// NOTE: memory is per-process. Run ONE instance (pm2 instances:1) or previews 404 randomly.
import path from 'node:path';
import crypto from 'node:crypto';
import ejs from 'ejs';
import type { PackageFile } from './s3.server';

const TTL = 30 * 60 * 1000;

export type Preview = {
  id: string;
  folder: string;
  cpName: string;
  serviceName: string;
  pages: string[];
  files: PackageFile[];
  standardPages: Record<string, string>;
  warnings: string[];
  createdAt: number;
};

// survive Vite HMR / module reloads
const g = globalThis as unknown as { __cpPreviews?: Map<string, Preview> };
const previews = (g.__cpPreviews ||= new Map<string, Preview>());

function purge() {
  const now = Date.now();
  for (const [id, p] of previews) if (now - p.createdAt > TTL) previews.delete(id);
}

export function createPreview(data: Omit<Preview, 'id' | 'createdAt'>): Preview {
  purge();
  const p: Preview = { ...data, id: crypto.randomBytes(16).toString('hex'), createdAt: Date.now() };
  previews.set(p.id, p);
  return p;
}
export function getPreview(id: string) {
  purge();
  return previews.get(id) || null;
}
export function deletePreview(id: string) {
  previews.delete(id);
}

/* ---------------- rendering ---------------- */
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const safeJson = (o: unknown) => JSON.stringify(o ?? null).replace(/</g, '\\u003c');
const APP_JS_TAG = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*scripts\/app\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi;
const stripAppJs = (html: string) => String(html || '').replace(APP_JS_TAG, '');
const safeCp = (v: Record<string, unknown>) =>
  new Proxy(v, { get: (t, k) => (typeof k === 'string' ? (k in t ? t[k] : '') : undefined) });

export const previewBase = (p: Preview) => `/api/cps/preview/${p.id}/files/`;

function sampleValues(p: Preview) {
  const base = previewBase(p);
  return {
    CP_NAME: p.cpName,
    SERVICE_NAME: p.serviceName,
    SERVICE_TEXT: 'Service description (comes from Dynamo at runtime)',
    BANNER_URL: `${base}assets/banner.jpg`,
    PRICE: '\u20A6100 / Day',
    PRICE_AMOUNT: '\u20A6100',
    PERIOD: 'Day',
    PLAN_LABEL: 'Daily',
    PRODUCT_ID: 'PREVIEW_PRODUCT',
    TRIAL_DAYS: 0,
    SHORT_CODE: '00000',
    SUPPORT_EMAIL: 'support@example.com',
    CONSENT_TEXT:
      'By subscribing to this service, customers on DND will be placed on Partial DND. DND Communication/Broadcasting/Entertainment/IT',
    YEAR: new Date().getFullYear(),
    ASSET_BASE: base.slice(0, -1),
  } as Record<string, unknown>;
}

function toPreviewAssets(html: string, p: Preview) {
  const base = previewBase(p);
  html = stripAppJs(html);
  html = html.split(`/cp-assets/${p.folder}/`).join(base);
  html = html.split(`/cp-assets/${p.folder}`).join(base.slice(0, -1));
  return html
    .replace(/<script[^>]*session-recording-cdn\.js[^>]*><\/script>/gi, '')
    .replace(/<script src="\/js\/zerorated\.js"><\/script>/gi, '')
    .replace(/<script src=""><\/script>/gi, '');
}

export function renderPreviewIndex(p: Preview) {
  const sampleProduct = {
    subscriptionId_subscriptionDescription: 'PREVIEW_PRODUCT',
    subscriptionDescription: 'PREVIEW',
    price: 100,
    currency: 'NGN',
    subscriptionValidityUnit: 'Day',
    subscriptionValidityDuration: 1,
  };
  let html = ejs.render(p.standardPages['index.html'], {
    cp: safeCp(sampleValues(p)),
    mfId: 'PREVIEW',
    encryptedContext: '',
    pageId: 'sid',
    serviceId: '',
    bundleUrl: '',
    scriptTags: '',
    testing: false,
    products: [sampleProduct],
    meta: { testId: 'PREVIEW', randomBtnNumber: 0, labels: { PREVIEW_PRODUCT: { plan: 'DAILY', price: '\u20A6100' } } },
    safeJson,
  });
  html = toPreviewAssets(html, p);
  // no fingerprint bundle in preview -> unlock overlay + CTA
  const unlock = '<script>document.dispatchEvent(new CustomEvent("mfilter:fpNotCollected",{detail:{preview:true}}));</script>';
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => unlock + '</body>') : html + unlock;
}

export function renderPreviewOther(p: Preview, rel: string) {
  const f = p.files.find((x) => x.relPath === rel);
  if (!f) return null;
  const base = previewBase(p);
  const v = sampleValues(p);
  let html = f.buffer.toString('utf8').replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (m, k: string) => (k in v ? esc(v[k]) : m));
  html = stripAppJs(html);
  html = html.replace(
    /(\s(?:src|href|poster)\s*=\s*)(["'])(?![a-z][a-z0-9+.-]*:|\/|#|\{\{)([^"']+)\2/gi,
    (_m, pre: string, q: string, url: string) => `${pre}${q}${base}${url}${q}`,
  );
  const baseTag = `<base href="${base}">`;
  return /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (m) => m + baseTag) : baseTag + html;
}

/** compile all Standard templates now so broken ones fail at upload, not in prod */
export function compileCheck(standardPages: Record<string, string>): string | null {
  for (const [page, tpl] of Object.entries(standardPages)) {
    try {
      ejs.compile(tpl);
    } catch (e) {
      return `Standard ${page} does not compile: ${(e as Error).message}`;
    }
  }
  return null;
}

export const folderFromZipName = (name: string) =>
  path.basename(name, path.extname(name)).toLowerCase().replace(/[^a-z0-9-_]/g, '-');

export const sanitizeFolder = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 80);
