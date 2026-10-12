// app/routes/api.cps.preview.$id_.files.$.tsx   ->  GET /api/cps/preview/:id/files/*
// Serves rendered preview HTML + package assets.
//
// NO login guard on purpose: the iframe is sandboxed (opaque origin) so its sub-requests
// carry no session cookie. Access = unguessable 128-bit preview id + 30 min TTL.
// HTML responses carry "CSP: sandbox allow-scripts" so partner JS can NEVER touch the
// admin origin, even if someone opens the preview URL directly in a tab.
import path from 'node:path';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { getPreview, renderPreviewIndex, renderPreviewOther } from '~/lib/cp/preview-store.server';
import { guessContentType } from '~/lib/cp/s3.server';

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function loader({ params }: LoaderFunctionArgs) {
  const p = getPreview(String(params.id || ''));
  if (!p) return text(404, 'Preview expired - upload the ZIP again');

  const rel = path.posix.normalize(String(params['*'] || 'index.html'));
  if (rel.startsWith('..') || path.posix.isAbsolute(rel)) return text(400, 'Bad path');

  const baseHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox allow-scripts',
  };

  if (/\.html$/i.test(rel)) {
    try {
      const html = rel === 'index.html' && p.standardPages['index.html'] ? renderPreviewIndex(p) : renderPreviewOther(p, rel);
      if (html == null) return text(404, 'Page not found in package');
      return new Response(html, { headers: { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) {
      console.error('[cp preview] render error', e);
      return text(500, 'Preview render failed');
    }
  }

  const f = p.files.find((x) => x.relPath === rel);
  if (!f) return text(404, 'Not found');
  return new Response(new Uint8Array(f.buffer), { headers: { ...baseHeaders, 'Content-Type': guessContentType(rel) } });
}
