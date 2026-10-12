import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getSession, destroySession } from "../lib/session.server";
import { logDashboardActivity, getClientIP } from "../lib/dynamodb-log";
import { DYNAMODB_TABLES } from "../lib/config";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const email = session.get("email");
  
  // Log logout activity if user was logged in
  if (email) {
    const ipAddress = getClientIP(request);
    await logDashboardActivity(
      DYNAMODB_TABLES.DASHBOARD_LOGINS,
      "LOGOUT",
      { email },
      ipAddress,
      email,
    );
  }
  
  return redirect("/login?message=login%20required", {
    headers: {
      "Set-Cookie": await destroySession(session),
    },
  });
}

export default function Logout() {
  return null;
} 