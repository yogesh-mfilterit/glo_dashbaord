// app/routes/api.cp-service-ids.tsx   ->  GET /api/cp-service-ids[?refresh=1]
import type { LoaderFunctionArgs } from '@remix-run/node';
import { guard, ok, fail, errMsg } from '~/lib/cp/http.server';
import { listServiceIds, SERVICE_ID_TABLE } from '~/lib/cp/serviceids.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    return ok({ items: await listServiceIds(refresh) });
  } catch (e) {
    console.error('[cp] service id list failed', e);
    return fail(500, `Could not read ${SERVICE_ID_TABLE}: ${errMsg(e)}`);
  }
}