import { ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { useState, useEffect } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { z } from "zod";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { commitSession, sessionStorage } from "../lib/session.server";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { DYNAMODB_TABLES } from "../lib/config";
import { getCPByCpid } from "../lib/dynamodb-cp";
import { logDashboardActivity, getClientIP } from "../lib/dynamodb-log";
import { checkRateLimit, recordFailedAttempt, resetAttempts } from "../lib/rate-limiter.server";
import { docClient } from "~/lib/aws.server";

const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .regex(/[!@#$%^&*(),.?":{}|<>]/, {
      message: "Password must contain at least one special character",
    })
    .refine((val) => /[A-Z]/.test(val) || /[a-z]/.test(val), {
      message: "Password must contain at least one upper or lower case letter",
    }),
});

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email")?.toString().toLowerCase();
  const password = formData.get("password");
  const rememberMe = formData.get("rememberMe") === "on";


  const ipAddress = getClientIP(request);

  const rateLimit = checkRateLimit(ipAddress);
  if (rateLimit.blocked) {
    return json(
      { error: `Too many failed attempts. Try again in ${Math.ceil(rateLimit.retryAfterSeconds! / 60)} minute(s).` },
      { status: 429 }
    );
  }

  const result = loginSchema.safeParse({ email, password });
  if (!result.success) {
    return json({ error: result.error.errors[0].message }, { status: 400 });
  }

  // DynamoDB lookup
  try {
    const { Item } = await docClient.send(
      new GetCommand({
        TableName: DYNAMODB_TABLES.DASHBOARD_LOGINS,
        Key: { email },
      })
    );

    if (!Item || Item.password !== password) {
      recordFailedAttempt(ipAddress);
      return json({ error: "Invalid email or password" }, { status: 401 });
    }

    resetAttempts(ipAddress);

    // Set session cookie
    const session = await sessionStorage.getSession();
    session.set("email", Item.email);
    session.set("id", Item.id);
    session.set("role", Item.role);

    // Set MFA flags - login succeeded, OTP pending
    session.set("login", true);
    session.set("otp", false);
    session.set("login_timestamp", Date.now());

    // If user is CP role, get additional CP information and store in session
    if (Item.role === "cp") {
      // Set cpId directly from the user record
      if (Item.cpId) {
        session.set("cpid", Item.cpId);

        // Get CP details from CP configuration table to set cpName and viewFilters
        const cpDetails = await getCPByCpid(Item.cpId);
        if (cpDetails) {
          session.set("cpName", cpDetails.cpName);

          // Set viewFilters (serviceIds) from the user record if available
          if (Item.serviceIds && Array.isArray(Item.serviceIds)) {
            session.set("viewFilters", Item.serviceIds);
          }

          console.log("[LOGIN_DEBUG] CP user session data set:", {
            cpid: Item.cpId,
            cpName: cpDetails.cpName,
            viewFilters: Item.serviceIds,
            serviceIdsCount: Item.serviceIds ? Item.serviceIds.length : 0,
          });
        } else {
          console.log(
            "[LOGIN_DEBUG] CP details not found for cpid:",
            Item.cpId
          );
        }
      } else {
        ;
      }
    }

    // Log login activity
    console.log("[LOGIN_LOG] Attempting to log login activity:", {
      email: Item.email,
      ipAddress,
      table: DYNAMODB_TABLES.DASHBOARD_LOGINS,
    });

    try {
      await logDashboardActivity(
        DYNAMODB_TABLES.DASHBOARD_LOGINS,
        "LOGIN",
        { email: Item.email },
        ipAddress,
        Item.email,
      );
    } catch (error) {
      console.error("[LOGIN_LOG] Error logging login activity:", error);
    }

    // Set cookie options for remember me
    const cookieOptions = rememberMe
      ? { maxAge: 60 * 60 * 24 * 30 } // 30 days
      : undefined; // default (7 days from session.server)
    return redirect("/otp", {
      headers: {
        "Set-Cookie": await commitSession(session, cookieOptions),
      },
    });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return json({ error: "Server error. Please try again." }, { status: 500 });
  }
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  //const [showedError, setShowedError] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setFormError(null);
  };

  const handleRememberMe = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRememberMe(e.target.checked);
  };

  const handleSubmit = (e: React.FormEvent) => {
    const result = loginSchema.safeParse(form);
    if (!result.success) {
      e.preventDefault();
      setFormError(result.error.errors[0].message);
      toast(result.error.errors[0].message, {
        className: "bg-red-500 text-white",
      });
    }
  };

  // if (actionData?.error && !showedError) {
  //   toast(actionData.error, { className: "bg-red-500 text-white" });
  //   setShowedError(true);
  // }
  useEffect(() => {
    if (actionData?.error) {
      toast(actionData.error, { className: "bg-red-500 text-white" });
    }
  }, [actionData]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg dark:bg-gray-800 text-center">
        <img
          src="/mfilter-logo.webp"
          alt="mFilterIt Logo"
          className="h-8 w-auto mb-6 mx-auto"
        />
        <h2 className="mb-6 text-center text-2xl font-semibold text-gray-900 dark:text-white">
          Login
        </h2>
        <Form method="post" className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="email"
              className="block text-left text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              Email :
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1"
              value={form.email}
              onChange={handleChange}
            />
          </div>
          <div className="relative">
            <label
              htmlFor="password"
              className="block text-left text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              Password :
            </label>
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className="mt-1 pr-10"
              value={form.password}
              onChange={handleChange}
            />
            <button
              type="button"
              className="absolute right-2 top-8 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          {/* <div className="flex items-center">
            <input
              id="rememberMe"
              name="rememberMe"
              type="checkbox"
              checked={rememberMe}
              onChange={handleRememberMe}
              className="mr-2 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label
              htmlFor="rememberMe"
              className="text-sm text-gray-700 dark:text-gray-200"
            >
              Remember me
            </label>
          </div> */}
          <Button
            type="submit"
            className="w-full bg-purple-700 hover:bg-purple-800"
            disabled={navigation.state === "submitting"}
          >
            {navigation.state === "submitting" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Logging in...
              </>
            ) : (
              "Login"
            )}
          </Button>
        </Form>
        <div className="mt-4 capitalize text-sm">
          {/* <p>not logged in? <Link to="/signup" className="text-purple-600 hover:text-purple-700">sign up</Link></p> */}
        </div>
      </div>
    </div>
  );
}
