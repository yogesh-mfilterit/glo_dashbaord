// app/routes/api.cps.preview.$id.tsx   ->  DELETE /api/cps/preview/:id  (discard)
import type { ActionFunctionArgs } from '@remix-run/node';
import { guard, ok, fail } from '~/lib/cp/http.server';
import { deletePreview } from '~/lib/cp/preview-store.server';

export async function action({ request, params }: ActionFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  if (request.method !== 'DELETE') return fail(405, 'Method not allowed');
  deletePreview(String(params.id || ''));
  return ok();
}
