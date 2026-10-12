import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { getSession, destroySession } from "../lib/session.server";
import { changeUserPassword, getUserByEmail } from "../lib/dynamodb-users";
import { logDashboardActivity, getClientIP } from "../lib/dynamodb-log";

export async function action({ request }: ActionFunctionArgs) {
  const session = await getSession(request);
  if (!session.has("email")) {
    return redirect("/login?message=login%20required");
  }

  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "changePassword") {
    const email = (formData.get("email") as string)?.toLowerCase();
    const currentPassword = formData.get("currentPassword") as string;
    const newPassword = formData.get("newPassword") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    const currentUserEmail = session.get("email");
    if (email !== currentUserEmail) {
      return json({ error: "You can only change your own password" }, { status: 403 });
    }

    if (!currentPassword) {
      return json({ error: "Current password is required" }, { status: 400 });
    }

    // Verify current password against DB
    const existingUser = await getUserByEmail(email);
    if (!existingUser || existingUser.password !== currentPassword) {
      return json({ error: "Current password is incorrect" }, { status: 400 });
    }

    // Validate password requirements
    if (newPassword.length < 10) {
      return json({ error: "Password must be at least 10 characters long" }, { status: 400 });
    }

    if (!/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
      return json({ error: "Password must contain at least one special character" }, { status: 400 });
    }

    if (!/\d/.test(newPassword)) {
      return json({ error: "Password must contain at least one numeric digit" }, { status: 400 });
    }

    if (newPassword !== confirmPassword) {
      return json({ error: "Passwords do not match" }, { status: 400 });
    }

    try {
      // Change the password in the database
      await changeUserPassword(email, newPassword);

      // Log the password change activity
      const ipAddress = getClientIP(request);
      await logDashboardActivity(
        "mtn-nigeria-dev-dashboard-logins",
        "UPDATE",
        { email, ipAddress },
        ipAddress
      );

      // Invalidate the session and redirect to login
      return redirect("/login?message=password%20changed%20successfully%20please%20login%20again", {
        headers: {
          "Set-Cookie": await destroySession(session),
        },
      });
    } catch (error) {
      console.error("Error changing password:", error);
      return json({ error: "Failed to change password. Please try again." }, { status: 500 });
    }
  }

  return json({ error: "Invalid action" }, { status: 400 });
} 