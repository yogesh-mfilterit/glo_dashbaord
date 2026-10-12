import { ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { z } from "zod";
import { DynamoDBClient, Select } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { commitSession, sessionStorage } from "../lib/session.server";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { DYNAMODB_TABLES } from "../lib/config";
import { createCP, getCPByCpid } from "../lib/dynamodb-cp";
import { logDashboardActivity, getClientIP } from "../lib/dynamodb-log";
import {
  Select as SelectorComponent,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { createUser } from "~/lib/dynamodb-users";

const signUpSchema = z
  .object({
    email: z.string().trim().email({ message: "Invalid email address" }),
    aggregator: z.string().trim().min(1, { message: "Aggregator is required" }),
    cpName: z.string().trim().min(1, { message: "CP Name is required" }),
    cpContactNumber: z
      .string()
      .trim()
      .min(1, { message: "CP Contact Number is required" }),
    password: z
      .string()
      .min(8, { message: "Password must be at least 8 characters" })
      .regex(/[!@#$%^&*(),.?":{}|<>]/, {
        message: "Password must contain at least one special character",
      })
      .regex(/[A-Za-z]/, {
        message: "Password must contain at least one letter",
      }),
    confirmPassword: z
      .string()
      .min(8, { message: "Confirm Password must be at least 8 characters" })
      .regex(/[!@#$%^&*(),.?":{}|<>]/, {
        message: "Confirm Password must contain at least one special character",
      })
      .regex(/[A-Za-z]/, {
        message: "Confirm Password must contain at least one letter",
      }),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        path: ["confirmPassword"], // 👈 attach error to confirmPassword
        message: "Confirm Password must match Password",
        code: z.ZodIssueCode.custom,
      });
    }
  });

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = (formData.get("email") as string)?.toLowerCase();
  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");
  const cpName = formData.get("cpName");
  const cpContactNumber = formData.get("cpContactNumber");
  const aggregator = formData.get("aggregator");
  const result = signUpSchema.safeParse({
    email,
    password,
    confirmPassword,
    cpName,
    cpContactNumber,
    aggregator,
  });
  if (!result.success) {
    console.log(`ZOD parsing error`, result);
    return json({ error: result.error.errors[0].message }, { status: 400 });
  }

  // DynamoDB lookup
  const client = new DynamoDBClient({ region: "ap-south-1" }); // Set your region
  const docClient = DynamoDBDocumentClient.from(client);
  try {
    console.log("querying the database");
    const { Item } = await docClient.send(
      new GetCommand({
        TableName: DYNAMODB_TABLES.DASHBOARD_LOGINS,
        Key: { email },
      })
    );

    if (Item) {
      console.log("[SIGNUP_LOG] Email already exists");
      return json({ error: "Email already exists" }, { status: 400 });
    }
    console.log("[SIGNUP_LOG] creating new user");
    try {
      const newCp = await createCP({
        cpName: cpName as string,
        cpContact: cpContactNumber as string,
        cpEmail: email as string,
        aggregator: aggregator as string,
      });
      const newUser = {
        email: email as string,
        password: password as string,
        cpId: newCp.cpid as string,
        role: "cp" as "cp" | "admin" | "operations",
      };
      await createUser(newUser);
    } catch (error) {
      console.error("DynamoDB error:", error);
      return json(
        { error: "Failed to create user. Please try again." },
        { status: 500 }
      );
    }

    console.log("[SIGNUP_LOG] success: User and CP created successfully");
    return redirect("/login");
  } catch (err) {
    console.error("DynamoDB error:", err);
    return json({ error: "Server error. Please try again." }, { status: 500 });
  }
}

export default function SignUp() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showedError, setShowedError] = useState(false);
  const [form, setForm] = useState({
    email: "",
    cpName: "",
    cpContactNumber: "",
    aggregator: "",
    password: "",
    confirmPassword: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setFormError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    console.log("this is the form", form);
    const result = signUpSchema.safeParse(form);
    console.log("this is the result", result);
    if (!result.success) {
      e.preventDefault();
      setFormError(result.error.errors[0].message);
      toast(result.error.errors[0].message, {
        className: "bg-red-500 text-white",
      });
    }
  };

  if (actionData?.error && !showedError) {
    toast(actionData.error, { className: "bg-red-500 text-white" });
    setShowedError(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg dark:bg-gray-800 text-center">
        <div>
            <Link to="/login" className=" hover:text-purple-700">
        <ArrowLeft size={20} className="cursor-pointer"/>
            </Link>
        </div>
        <img
          src="/mfilter-logo.webp"
          alt="mFilterIt Logo"
          className="h-8 w-auto mb-6 mx-auto"
        />
        <h2 className="mb-6 text-center text-2xl font-semibold text-gray-900 dark:text-white">
          {/* <span className="text-gray-400">Content Partner</span> -  */}
          Sign Up
        </h2>
        <Form method="post" className="space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-2">
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
            <div>
              <label
                htmlFor="cpName"
                className="block text-left text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                Name :
              </label>
              <Input
                id="cpName"
                name="cpName"
                type="text"
                autoComplete="cpName"
                required
                className="mt-1"
                value={form.cpName}
                onChange={handleChange}
              />
            </div>
            <div>
              <label
                htmlFor="cpContactNumber"
                className="block text-left text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                Contact Number :
              </label>
              <Input
                id="cpContactNumber"
                name="cpContactNumber"
                type="text"
                autoComplete="cpContactNumber"
                required
                className="mt-1"
                value={form.cpContactNumber}
                onChange={handleChange}
              />
            </div>
            <div>
              <label
                htmlFor="aggregator"
                className="block text-left text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                Aggregator :
              </label>
              <SelectorComponent
                value={form.aggregator}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, aggregator: value }))
                }
                name="aggregator"
              >
                <SelectTrigger className="w-full mt-1">
                  <SelectValue placeholder="Select an aggregator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_test_">Test</SelectItem>
                  <SelectItem value="AGGREGATOR_2">Aggregator 2</SelectItem>
                  <SelectItem value="AGGREGATOR_3">Aggregator 3</SelectItem>
                </SelectContent>
              </SelectorComponent>
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
            <div className="relative">
              <label
                htmlFor="confirmPassword"
                className="block text-left text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                Confirm Password :
              </label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="mt-1 pr-10"
                value={form.confirmPassword}
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
          </div>

          <Button
            type="submit"
            className="w-full bg-purple-700 hover:bg-purple-800"
            disabled={navigation.state === "submitting"}
          >
            {navigation.state === "submitting" ? "Signing up..." : "Sign Up"}
          </Button>
        </Form>
      </div>
    </div>
  );
}
