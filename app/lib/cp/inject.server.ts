// app/lib/cp/inject.server.ts
// Build Standard/index.html as EJS template (rendered per request by ProcessUi.js).
// SECURITY: every "<%" from partner HTML becomes "<%%" BEFORE our own tags are added.
//
// mf-runtime.js: copy it UNCHANGED into app/lib/cp/mf-runtime.js (from app/DynamicCPUI/).
import RUNTIME_RAW from './mf-runtime.js?raw';
import type { PackageFile } from './s3.server';

const escapeEjs = (s: string) => String(s || '').replace(/<%/g, '<%%');

const APP_JS_TAG = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*scripts\/app\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi;
const stripAppJs = (html: string) => String(html || '').replace(APP_JS_TAG, '');

function prepare(rawHtml: string, folder: string) {
  const assetBase = `/cp-assets/${folder}/`;
  let html = stripAppJs(escapeEjs(rawHtml));

  // compliance page: no partner forms
  html = html.replace(/<form\b[^>]*>/gi, '<div>').replace(/<\/form>/gi, '</div>');

  // relative src/href/poster -> absolute (skip {{TAGS}})
  html = html.replace(
    /(\s(?:src|href|poster)\s*=\s*)(["'])(?![a-z][a-z0-9+.-]*:|\/|#|\{\{)([^"']+)\2/gi,
    (_m, pre: string, q: string, url: string) => `${pre}${q}${assetBase}${url}${q}`,
  );

  // {{KEY}} -> <%= cp.KEY %>
  html = html.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (_m, key: string) => `<%= cp.${key} %>`);
  return { html, assetBase };
}

function injectHeadBody(html: string, assetBase: string, headInject: string, bodyInject: string) {
  const baseTag = `<base href="${assetBase}">`;
  if (/<head(\s[^>]*)?>/i.test(html)) {
    html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + baseTag);
    html = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, () => headInject + '</head>')
      : html.replace(baseTag, () => baseTag + headInject);
  } else {
    html = baseTag + headInject + html;
  }
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => bodyInject + '</body>')
    : html + bodyInject;
}

export function buildStandardHtml(rawHtml: string, folder: string) {
  const RUNTIME = escapeEjs(RUNTIME_RAW);
  const { html, assetBase } = prepare(rawHtml, folder);

  const headInject = `
<script src="https://static.mfilterit.org/global/session-recording-cdn.js" data-id1="<%= mfId %>" data-pgid="sid-he"></script>
<script src="<%= bundleUrl %>"></script>
<% if (scriptTags && scriptTags !== 'NA' && String(scriptTags).trim() !== '') { %><%- scriptTags %><% } %>
`;

  const bodyInject = `
<% if (testing) { %><div id="mfid" style="background:#fff;padding:10px;font-size:large;text-align:center"><%= mfId %></div><% } else { %><div id="mfid" style="display:none;"><%= mfId %></div><% } %>
<button id="subscribeBtN" style="display:none">mfid</button>
<div id="mf-overlay" style="position:fixed;inset:0;background:#0b3d2e;z-index:99999;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#e7f3ea;font-size:14px"><div style="width:34px;height:34px;border:3px solid rgba(255,255,255,.25);border-top-color:#f2b632;border-radius:50%;animation:mfspin .9s linear infinite"></div>Loading...</div><style>@keyframes mfspin{to{transform:rotate(360deg)}}</style>
<form id="verificationForm" action="/sid-he/he" method="POST" style="display:none">
  <input type="hidden" name="context" value="<%= encryptedContext %>">
  <input type="hidden" name="mfId" value="<%= mfId %>">
  <input type="hidden" name="pageId" value="<%= pageId %>">
  <input type="hidden" name="serviceId" value="<%= serviceId %>">
  <input type="hidden" name="cjs" id="cjsInput">
  <input type="hidden" name="fpData" id="fpData">
  <input type="hidden" name="variation" id="variation">
  <input type="hidden" name="fpDataError" id="fpDataError">
  <input type="hidden" name="clickData" id="clickData" value="false">
  <input type="hidden" name="test" id="test" value="false">
  <input type="hidden" name="trust" id="trust" value="false">
  <input type="hidden" name="sed" id="sed" value="xor|0|<%= Date.now() %>">
</form>
<script type="application/json" id="mf-products"><%- safeJson(products) %></script>
<script type="application/json" id="mf-meta"><%- safeJson(meta) %></script>
<script>${RUNTIME}</script>
`;

  return injectHeadBody(html, assetBase, headInject, bodyInject);
}

export function buildStandardPages(files: PackageFile[], folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  const idx = files.find((f) => f.relPath === 'index.html');
  if (idx) out['index.html'] = buildStandardHtml(idx.buffer.toString('utf8'), folder);
  return out;
}
