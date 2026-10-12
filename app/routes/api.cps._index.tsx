// app/routes/api.cps._index.tsx   ->  GET /api/cps
import type { LoaderFunctionArgs } from '@remix-run/node';
import { guard, ok, fail, errMsg } from '~/lib/cp/http.server';
import * as dynamo from '~/lib/cp/dynamo.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    return ok({ items: await dynamo.listCps() });
  } catch (e) {
    console.error('[cp] list failed', e);
    return fail(500, `Could not list content providers: ${errMsg(e)}`);
  }
}
