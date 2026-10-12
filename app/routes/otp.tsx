import { ActionFunctionArgs, json, redirect, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation, useLoaderData } from "@remix-run/react";
import { useState, useEffect } from "react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../components/ui/input-otp";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { getSession, commitSession } from "../lib/session.server";
import { sendOtpEmail } from "../../tools/mailer";
import { Loader2 } from "lucide-react";
// Generate a 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

interface LoaderData {
  otpSent: boolean;
  error?: string;
  email?: string;
  otpResent?: boolean;
  canResendAt?: number;
}

interface ActionData {
  error?: string;
  otpResent?: boolean;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<Response | LoaderData> {
  const session = await getSession(request);
  
  // Check if user has passed login step
  if (!session.get("email") || !session.get("login")) {
    return redirect("/login");
  }

  // Check if already verified - but also verify the session hasn't expired
  if (session.get("otp") === true) {
    // Double-check that login session hasn't expired (24 hours)
    const loginTimestamp = session.get("login_timestamp");
    if (loginTimestamp) {
      const now = Date.now();
      const elapsed = now - loginTimestamp;
      const sessionExpire = 30 * 60 * 1000;
      if (elapsed > sessionExpire) {
        // Session expired, clear everything and redirect to login
        console.log(`[SECURITY_ALERT] Session expired for verified user ${session.get("email")}`);
        session.unset("login");
        session.unset("otp");
        session.unset("login_timestamp");
        session.unset("otp_code");
        session.unset("otp_sent_at");
        session.unset("otp_expires_at");
        return redirect("/login", {
          headers: {
            "Set-Cookie": await commitSession(session),
          },
        });
      }
    }
    console.log(`[SECURITY_CHECK] Redirecting verified user ${session.get("email")} to dashboard`);
    return redirect("/service-ids");
  }

  // Check if OTP was already sent recently
  const otpSentAt = session.get("otp_sent_at");
  const now = Date.now();

  if (!otpSentAt || (now - otpSentAt) > 2 * 60 * 1000) { // 2 minutes
    // Generate new OTP
    const otp = generateOTP();
    const email = session.get("email");

    // console.log(`[OTP_GENERATION] Generated OTP for ${email}: ${otp}`);

    // Send OTP email via frontend function
    try {
      await sendOtpEmail(email, otp);
    //   console.log(`[OTP_SUCCESS] OTP email sent successfully to ${email}`);
    } catch (error) {
      console.error(`[OTP_ERROR] Failed to send OTP email to ${email}:`, error);
      // Continue with flow even if email fails - OTP is still in session
    }

    session.set("otp_code", otp);
    session.set("otp_sent_at", now);
    session.set("otp_expires_at", now + 2 * 60 * 1000); // 2 minutes

    return json({ otpSent: true, email }, {
      headers: {
        "Set-Cookie": await commitSession(session),
      },
    } as any);
  }

  return { otpSent: true, email: session.get("email"), canResendAt: otpSentAt + 30 * 1000 };
}

export async function action({ request }: ActionFunctionArgs): Promise<Response | ActionData> {
  const session = await getSession(request);
  const formData = await request.formData();
  const action = formData.get("action");

  // Handle "not you" button - clear session and redirect to login
  if (action === "not-you") {
    // Clear all session data
    session.unset("email");
    session.unset("id");
    session.unset("role");
    session.unset("login");
    session.unset("otp");
    session.unset("login_timestamp");
    session.unset("otp_code");
    session.unset("otp_sent_at");
    session.unset("otp_expires_at");

    return redirect("/login", {
      headers: {
        "Set-Cookie": await commitSession(session),
      },
    });
  }

  // Handle "resend otp" button
  if (action === "resend-otp") {
    // Check if user has passed login step
    if (!session.get("email") || !session.get("login")) {
      return redirect("/login");
    }

    // CRITICAL SECURITY: Ensure user is NOT already verified - prevent bypass attempts
    if (session.get("otp") === true) {
      console.log(`[SECURITY_ALERT] Attempted resend after verification for ${session.get("email")}`);
      return redirect("/service-ids");
    }

    const now = Date.now();
    const lastSentAt = session.get("otp_sent_at");

    // Rate limiting: don't allow resend more than once every 30 secondseyJlbWFpbCI6ImFkbWluQG1maWx0ZXJpdC5jb20iLCJpZCI6ImFkbWluLTEiLCJyb2xlIjoiYWRtaW4iLCJsb2dpbiI6dHJ1ZSwib3RwIjpmYWxzZSwibG9naW5fdGltZXN0YW1wIjoxNzc2MjM0ODAzNTgyLCJvdHBfY29kZSI6IjQzNjU0MCIsIm90cF9zZW50X2F0IjoxNzc2MjM0ODAzOTkwLCJvdHBfZXhwaXJlc19hdCI6MTc3NjIzNDkyMzk5MH0=.Tea/99mmcbGeRaU2T5gT4HvSjADuJt3m+inv46OMN9U
    if (lastSentAt && (now - lastSentAt) < 30 * 1000) {
      console.log(`[SECURITY_ALERT] Rate limit hit for resend attempt by ${session.get("email")}`);
      return json({ error: "Please wait 30 seconds before requesting a new code." }, { status: 429 });
    }

    // Generate new OTP
    const otp = generateOTP();
    const email = session.get("email");

    // Send OTP email via frontend function
    try {
      await sendOtpEmail(email, otp);
      console.log(`[OTP_RESEND_SUCCESS] OTP email resent successfully to ${email}`);
    } catch (error) {
      console.error(`[OTP_RESEND_ERROR] Error resending OTP email to ${email}:`, error);
      return json({ error: "Failed to send OTP email. Please try again." }, { status: 500 });
    }

    // Update session with new OTP - EXPLICITLY ensure otp verification flag remains false
    session.set("otp_code", otp);
    session.set("otp_sent_at", now);
    session.set("otp_expires_at", now + 2 * 60 * 1000); // 2 minutes
    
    // CRITICAL: Double ensure verification flag is false and log the action
    session.set("otp", false);
    console.log(`[SECURITY_RESEND] OTP resent for ${email}, verification flag reset to false`);

    return json({ otpResent: true }, {
      headers: {
        "Set-Cookie": await commitSession(session),
      },
    });
  }

  // Check if user has passed login step
  if (!session.get("email") || !session.get("login")) {
    console.log(`[SECURITY_ALERT] OTP verification attempt without login for IP: ${request.headers.get("x-forwarded-for") || "unknown"}`);
    return redirect("/login");
  }

  // CRITICAL SECURITY: Additional check to prevent bypass attempts
  if (session.get("otp") === true) {
    console.log(`[SECURITY_ALERT] OTP verification attempt for already verified user ${session.get("email")}`);
    return redirect("/service-ids");
  }

  const otp = formData.get("otp")?.toString();

  if (!otp || otp.length !== 6) {
    console.log(`[SECURITY_ALERT] Invalid OTP format attempt for ${session.get("email")}: ${otp}`);
    return json({ error: "Please enter a valid 6-digit OTP" }, { status: 400 });
  }

  const storedOTP = session.get("otp_code");
  const otpExpiresAt = session.get("otp_expires_at");
  const now = Date.now();

  if (!storedOTP || !otpExpiresAt || now > otpExpiresAt) {
    console.log(`[SECURITY_ALERT] Expired/invalid OTP attempt for ${session.get("email")}: stored=${!!storedOTP}, expires=${otpExpiresAt}, now=${now}`);
    return json({ error: "OTP has expired. Please request a new one." }, { status: 400 });
  }

  if (otp !== storedOTP) {
    console.log(`[SECURITY_ALERT] Wrong OTP attempt for ${session.get("email")}: entered=${otp}, stored=${storedOTP}`);
    return json({ error: "Invalid OTP. Please try again." }, { status: 400 });
  }

  // OTP verified successfully - log for security audit
  console.log(`[SECURITY_SUCCESS] OTP verification successful for ${session.get("email")}`);
  session.set("otp", true); // Mark OTP as verified
  session.unset("otp_code");
  session.unset("otp_sent_at");
  session.unset("otp_expires_at");

  return redirect("/service-ids", {
    headers: {
      "Set-Cookie": await commitSession(session),
    },
  });
}

export default function OTPVerification() {
  const actionData = useActionData<ActionData>();
  const loaderData = useLoaderData<LoaderData>();
  const navigation = useNavigation();
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (actionData?.error) {
      toast(actionData.error, { className: "bg-red-500 text-white" });
    }
  }, [actionData]);

  useEffect(() => {
    if (loaderData?.error) {
      toast(loaderData.error, { className: "bg-red-500 text-white" });
    }
  }, [loaderData]);

  useEffect(() => {
    if (loaderData?.otpResent) {
      toast("New OTP sent to your email!", { className: "bg-green-500 text-white" });
    }
  }, [loaderData]);

  // Handle resend cooldown timer
  useEffect(() => {
    if (loaderData?.canResendAt) {
      const now = Date.now();
      const cooldown = Math.max(0, loaderData.canResendAt - now);
      setResendCooldown(Math.ceil(cooldown / 1000));

      if (cooldown > 0) {
        const timer = setInterval(() => {
          const remaining = Math.max(0, loaderData.canResendAt - Date.now());
          setResendCooldown(Math.ceil(remaining / 1000));
          if (remaining <= 0) {
            clearInterval(timer);
          }
        }, 1000);

        return () => clearInterval(timer);
      }
    }
  }, [loaderData?.canResendAt]);

  const handleResend = () => {
    if (resendCooldown > 0) return;
    // The form will handle the submission
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg dark:bg-gray-800 text-center">
        <img
          src="/mfilter-logo.webp"
          alt="mFilterIt Logo"
          className="h-8 w-auto mb-6 mx-auto"
        />
        <h2 className="mb-6 text-center text-2xl font-semibold text-gray-900 dark:text-white">
          Verify Your Identity
        </h2>
        <p className="mb-2 text-center text-gray-600 dark:text-gray-400">
          We've sent a 6-digit code to your email.
        </p>
        {loaderData?.email && (
          <p className="mb-4 text-center text-sm text-gray-500 dark:text-gray-400">
            {loaderData.email}
          </p>
        )}
        <p className="mb-6 text-center text-gray-600 dark:text-gray-400">
          Enter it below to continue.
        </p>

        <Form method="post" className="space-y-6">
          <input type="hidden" name="otp" value={otp} />
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={otp}
              onChange={(value) => setOtp(value)}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button
            type="submit"
            className="w-full bg-purple-700 hover:bg-purple-800"
            disabled={navigation.state === "submitting" || otp.length !== 6}
          >
            {navigation.state === "submitting" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              "Verify OTP"
            )}
          </Button>
        </Form>

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Form method="post" className="inline">
            <input type="hidden" name="action" value="not-you" />
            <Button
              type="submit"
              variant="ghost"
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              disabled={navigation.state === "submitting"}
            >
              {navigation.state === "submitting" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resending otp...
                </>
              ) : (
                "Not you? Sign in with a different account"
              )}
            </Button>
          </Form>
        </div>

        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Didn't receive the code?{" "}
          <Form method="post" className="inline">
            <input type="hidden" name="action" value="resend-otp" />
            <Button
              type="submit"
              variant="link"
              className="p-0 h-auto text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200"
              disabled={resendCooldown > 0 || navigation.state === "submitting"}
              onClick={handleResend}
            >
              {navigation.state === "submitting" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : resendCooldown > 0 ? (
                `Resend in ${resendCooldown}s`
              ) : (
                "Resend OTP"
              )}
            </Button>
          </Form>
        </p>
      </div>
    </div>
  );
}
