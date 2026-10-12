import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import Layout from "../components/layout";
import { getAllUsers, createUser, updateUser, deleteUser, type User, getUserByEmail } from "../lib/dynamodb-users";
import { getAllCPs } from "../lib/dynamodb-cp";
import { getAllServiceIds } from "../lib/dynamodb-serviceid";
import { getSession, commitSession } from "../lib/session.server";
import { logDashboardActivity, getClientIP } from "../lib/dynamodb-log";
import { useState, useEffect, useRef } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { z } from "zod";
import { DYNAMODB_TABLES } from "~/lib/config";
import { fullAuthGuard } from "~/util/authGuard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Checkbox } from "../components/ui/checkbox";
import { Eye, EyeOff } from "lucide-react";
import { generateCsrfToken, validateCsrfToken, validateCsrfFromForm } from "~/lib/csrf.server";

// Schema for creating new users (password required, cpId conditional)
const createUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string()
    .min(10, "Password must be at least 10 characters long")
    .regex(/[!@#$%^&*(),?":{}|<>]/, "Password must contain at least one special character")
    .regex(/\d/, "Password must contain at least one numeric digit"),
  role: z.enum(["admin", "cp", "operations"], {
    errorMap: () => ({ message: "Role must be either 'admin', 'cp', or 'operations'" }),
  }),
  cpId: z.string().optional(),
  serviceIds: z.array(z.string()).optional(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);

  // Check if user is authenticated
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }

  // Check if user has admin role
  const userRole = session.get("role");
  if (userRole !== "admin") {
    return redirect("/service-ids?message=access%20denied");
  }

  const [users, cps, serviceIds] = await Promise.all([
    getAllUsers(),
    getAllCPs(),
    getAllServiceIds()
  ]);

  const csrfToken = generateCsrfToken(session);
  const sessionCookie = await commitSession(session);
  return json(
    { users, cps, serviceIds, userRole, userEmail: session.get("email") || null, csrfToken },
    { headers: { "Set-Cookie": sessionCookie } }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return json({ error: "Authentication required" }, { status: 401 });
  }

  const session = await getSession(request);
  const userEmail = session.get("email");
  const user_ip = getClientIP(request);
  const userRole = session.get("role");

  if (userRole !== "admin") {
    return json({ error: "Access denied. Admin role required." }, { status: 403 });
  }

  // Validate Origin/Referer header
  const originValid = await validateCsrfToken(request, session);
  if (!originValid) {
    return json({ error: "Invalid request origin" }, { status: 403 });
  }

  const formData = await request.formData();

  // Validate CSRF token from form
  if (!validateCsrfFromForm(formData, session)) {
    return json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  const intent = formData.get("intent") as string;
  const emailRaw = formData.get("email");
  const passwordRaw = formData.get("password");
  const roleRaw = formData.get("role");
  const cpIdRaw = formData.get("cpId");

  // Handle serviceIds as an array from form data
  const serviceIdsRaw = formData.getAll("serviceIds");
  const serviceIdsArray = serviceIdsRaw.filter(id => typeof id === 'string' && id.trim() !== '') as string[];

  // Email is always required for all operations
  if (!emailRaw) {
    return json({ error: "Email is required" }, { status: 400 });
  }

  const email = (emailRaw as string).toLowerCase();
  const password = (passwordRaw as string) || "";
  const role = (roleRaw as string) || "";
  const cpId = (cpIdRaw as string) || "";

  // Debug logging - log all form data keys and values
  const allFormData: Record<string, string | null> = {};
  for (const [key, value] of formData.entries()) {
    allFormData[key] = typeof value === 'string' ? value : null;
  }
  console.log("All form data:", allFormData);
  console.log("Field details:", {
    intent,
    email,
    role,
    passwordRaw,
    password,
    passwordType: typeof password,
    hasPassword: !!password,
    passwordLength: password.length
  });

  if (intent === "create") {
    // For creating new users, password and role are required
    if (!password || password.trim() === "") {
      return json({ error: "Password is required for new users" }, { status: 400 });
    }

    if (!role || role.trim() === "") {
      return json({ error: "Role is required for new users" }, { status: 400 });
    }

    // CP ID is only required when role is "cp"
    if (role === "cp" && (!cpId || cpId.trim() === "")) {
      return json({ error: "CP ID is required when role is 'cp'" }, { status: 400 });
    }

    // Service IDs are required when role is "cp"
    if (role === "cp" && (!serviceIdsArray || serviceIdsArray.length === 0)) {
      return json({ error: "Service IDs are required when role is 'cp'" }, { status: 400 });
    }

    const validation = createUserSchema.safeParse({ email, password, role, cpId, serviceIds: serviceIdsArray });
    if (!validation.success) {
      return json({ error: validation.error.errors[0].message }, { status: 400 });
    }

    // Check if user with this email already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return json({ error: "Email already exists, please use another email" }, { status: 400 });
    }

    try {
      const userData = { email, password, role: role as "admin" | "cp" | "operations", cpId, serviceIds: serviceIdsArray };
      await createUser(userData);

      // Log the create activity
      await logDashboardActivity(
        DYNAMODB_TABLES.DASHBOARD_LOGINS,
        "CREATE_USER",
        userData,
        user_ip,
        userEmail
      );

      return json({ success: "created" });
    } catch (error) {
      console.error("Database error:", error);
      return json({ error: "Failed to save user. Please try again." }, { status: 500 });
    }
  } else if (intent === "update") {
    // For updating users, only update fields that have changed
    const updateData: { password?: string; role?: "admin" | "cp" | "operations"; cpId?: string; serviceIds?: string[] } = {};

    // Get the original user data to compare what has changed
    const originalUser = await getUserByEmail(email);
    if (!originalUser) {
      return json({ error: "User not found" }, { status: 404 });
    }
    const currentPasswordRaw = formData.get("currentPassword") as string;
    const confirmPasswordRaw = formData.get("confirmPassword") as string;

    if (currentPasswordRaw || password) {
      if (!currentPasswordRaw) {
        return json({ error: "Current password is required to set a new password" }, { status: 400 });
      }
      if (originalUser.password !== currentPasswordRaw) {
        return json({ error: "Current password is incorrect" }, { status: 400 });
      }
      if (password !== confirmPasswordRaw) {
        return json({ error: "Passwords do not match" }, { status: 400 });
      }
    }

    // Only include password if it's provided and different from original
    if (password && password.trim() !== "" && password !== originalUser.password) {
      updateData.password = password;
    }

    // Only include role if it's different from original
    if (role !== originalUser.role) {
      updateData.role = role as "admin" | "cp" | "operations";

      // If role is being changed to "cp", cpId becomes required
      if (role === "cp" && (!cpId || cpId.trim() === "")) {
        return json({ error: "CP ID is required when role is 'cp'" }, { status: 400 });
      }
    }

    if (cpId && cpId.trim() !== "" && cpId !== originalUser.cpId) {
      updateData.cpId = cpId;
    }

    if (serviceIdsArray.length > 0 && JSON.stringify(serviceIdsArray) !== JSON.stringify(originalUser.serviceIds)) {
      updateData.serviceIds = serviceIdsArray;
    }

    // If role is "cp" and cpId is not being updated, ensure the current cpId is valid
    if (role === "cp" && !updateData.cpId && (!originalUser.cpId || originalUser.cpId.trim() === "")) {
      return json({ error: "CP ID is required when role is 'cp'" }, { status: 400 });
    }

    // If role is "cp" and serviceIds are not being updated, ensure the current serviceIds are valid
    if (role === "cp" && !updateData.serviceIds && (!originalUser.serviceIds || originalUser.serviceIds.length === 0)) {
      return json({ error: "Service IDs are required when role is 'cp'" }, { status: 400 });
    }

    // Check if there are any changes to update
    if (Object.keys(updateData).length === 0) {
      return json({ error: "No changes detected" }, { status: 400 });
    }

    // Validate only the fields that are being updated
    if (updateData.password) {
      // Validate password if it's being updated
      const passwordValidation = z.string()
        .min(10, "Password must be at least 10 characters long")
        .regex(/[!@#$%^&*(),?":{}|<>]/, "Password must contain at least one special character")
        .regex(/\d/, "Password must contain at least one numeric digit");

      const passwordResult = passwordValidation.safeParse(updateData.password);
      if (!passwordResult.success) {
        return json({ error: passwordResult.error.errors[0].message }, { status: 400 });
      }
    }

    if (updateData.role) {
      // Validate role if it's being updated
      const roleValidation = z.enum(["admin", "cp", "operations"], {
        errorMap: () => ({ message: "Role must be either 'admin', 'cp', or 'operations'" }),
      });

      const roleResult = roleValidation.safeParse(updateData.role);
      if (!roleResult.success) {
        return json({ error: roleResult.error.errors[0].message }, { status: 400 });
      }
    }

    if (updateData.cpId) {
      const cpIdValidation = z.string().min(1, "CP ID is required");
      const cpIdResult = cpIdValidation.safeParse(updateData.cpId);
      if (!cpIdResult.success) {
        return json({ error: cpIdResult.error.errors[0].message }, { status: 400 });
      }
    }

    if (updateData.serviceIds) {
      const serviceIdsValidation = z.array(z.string()).optional();
      const serviceIdsResult = serviceIdsValidation.safeParse(updateData.serviceIds);
      if (!serviceIdsResult.success) {
        return json({ error: "Invalid service IDs provided" }, { status: 400 });
      }
    }

    // Validate email format
    const emailValidation = z.string().email("Invalid email address");
    const emailResult = emailValidation.safeParse(email);
    if (!emailResult.success) {
      return json({ error: emailResult.error.errors[0].message }, { status: 400 });
    }

    try {
      await updateUser(email, updateData);

      // Log the update activity
      await logDashboardActivity(
        DYNAMODB_TABLES.DASHBOARD_LOGINS,
        "UPDATE_USER",
        { email, ...updateData },
        user_ip,
        userEmail
      );

      return json({ success: "updated" });
    } catch (error) {
      console.error("Database error:", error);
      return json({ error: "Failed to update user. Please try again." }, { status: 500 });
    }
  } else if (intent === "delete") {
    try {
      await deleteUser(email);

      // Log the delete activity
      await logDashboardActivity(
        DYNAMODB_TABLES.DASHBOARD_LOGINS,
        "DELETE_USER",
        { email },
        user_ip,
        userEmail
      );

      return json({ success: "deleted" });
    } catch (error) {
      console.error("Database error:", error);
      return json({ error: "Failed to delete user. Please try again." }, { status: 500 });
    }
  }

  return json({ error: "Invalid action" }, { status: 400 });
}

export default function Users() {
  const { users, cps, serviceIds, userRole, userEmail, csrfToken } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [editUser, setEditUser] = useState<User | null>(null);
  const [updateFormError, setUpdateFormError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    email: "",
    password: "",
    role: "cp" as "admin" | "cp" | "operations",
    cpId: "",
    serviceIds: [] as string[],
  });
  const [updateForm, setUpdateForm] = useState({
    email: "",
    currentPassword: "",
    password: "",
    confirmPassword: "",
    role: "cp" as "admin" | "cp" | "operations",
    cpId: "",
    serviceIds: [] as string[],
  });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [showServiceDropdown, setShowServiceDropdown] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");
  const [updateServiceSearch, setUpdateServiceSearch] = useState("");
  const [showCreatePassword, setShowCreatePassword] = useState(true);
  const [showUpdatePassword, setShowUpdatePassword] = useState(false);
  const [showUpdateConfirmPassword, setShowUpdateConfirmPassword] = useState(false);
  const [showUpdateCurrentPassword, setShowUpdateCurrentPassword] = useState(false);
  const serviceDropdownRef = useRef<HTMLDivElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (serviceDropdownRef.current && !serviceDropdownRef.current.contains(e.target as Node)) {
        setShowServiceDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (navigation.state === "idle" && actionData) {
      if ('success' in actionData) {
        if (actionData.success === "created") {
          toast("User created successfully!", { className: "bg-green-500 text-white" });
        } else if (actionData.success === "updated") {
          toast("User updated successfully!", { className: "bg-green-500 text-white" });
        } else if (actionData.success === "deleted") {
          toast("User deleted successfully!", { className: "bg-green-500 text-white" });
        }
        setCreateForm({
          email: "",
          password: "",
          role: "cp",
          cpId: "",
          serviceIds: [],
        });
        setUpdateForm({
          email: "",
          currentPassword: "",
          password: "",
          confirmPassword: "",
          role: "cp",
          cpId: "",
          serviceIds: [],
        });
        setShowCreateForm(false);
        setShowServiceDropdown(false);
        setEditUser(null);
        setCreateFormError(null);
        setUpdateFormError(null);
      } else if ('error' in actionData) {
        if (actionData.error === "Email already exists, please use another email") {
          setCreateFormError(actionData.error);
          emailInputRef.current?.focus();
        } else {
          setCreateFormError(null);
        }
        if (editUser) {
          setUpdateFormError(actionData.error);
        }
        toast(actionData.error, { className: "bg-red-500 text-white" });
      }
    }
  }, [navigation.state, actionData]);

  const handleEdit = (user: User) => {
    setEditUser(user);
    setUpdateServiceSearch("");
    setUpdateForm({
      email: user.email,
      currentPassword: "",
      password: "", // Clear password when editing - user must enter new one if they want to change it
      confirmPassword: "",
      role: user.role,
      cpId: user.cpId || "", // Handle cases where cpId might not exist
      serviceIds: user.serviceIds || [],
    });
  };

  const handleCancel = () => {
    setEditUser(null);
    setUpdateServiceSearch("");
    setUpdateFormError(null);
    setUpdateForm({
      email: "",
      currentPassword: "",
      password: "",
      confirmPassword: "",
      role: "cp",
      cpId: "",
      serviceIds: [],
    });
  };

  const handleShowCreateForm = () => setShowCreateForm(true);
  const handleHideCreateForm = () => {
    setShowCreateForm(false);
    setShowServiceDropdown(false);
    setCreateForm({
      email: "",
      password: "",
      role: "cp",
      cpId: "",
      serviceIds: [],
    });
  };

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // For creating new users, all fields are required
    if (!createForm.email || !createForm.password || !createForm.role) {
      e.preventDefault();
      toast("Please fill in all required fields", { className: "bg-red-500 text-white" });
      return;
    }

    // CP ID is only required when role is "cp"
    if (createForm.role === "cp" && !createForm.cpId) {
      e.preventDefault();
      toast("CP ID is required when role is 'cp'", { className: "bg-red-500 text-white" });
      return;
    }

    // Service IDs are required when role is "cp"
    if (createForm.role === "cp" && (!createForm.serviceIds || createForm.serviceIds.length === 0)) {
      e.preventDefault();
      toast("Service IDs are required when role is 'cp'", { className: "bg-red-500 text-white" });
      return;
    }
  };

  const handleUpdateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    setUpdateFormError(null);
    if (!updateForm.email) {
      e.preventDefault();
      toast("Email is required", { className: "bg-red-500 text-white" });
      return;
    }
    const isChangingPassword = updateForm.currentPassword || updateForm.password || updateForm.confirmPassword;
    if (isChangingPassword) {
      if (!updateForm.currentPassword) {
        e.preventDefault();
        setUpdateFormError("Current password is required");
        toast("Current password is required", { className: "bg-red-500 text-white" });
        return;
      }
      if (updateForm.password.length < 10) {
        e.preventDefault();
        setUpdateFormError("New password must be at least 10 characters long");
        toast("New password must be at least 10 characters", { className: "bg-red-500 text-white" });
        return;
      }
      if (!/[!@#$%^&*(),.?":{}|<>]/.test(updateForm.password)) {
        e.preventDefault();
        setUpdateFormError("New password must contain at least one special character");
        toast("New password must contain at least one special character", { className: "bg-red-500 text-white" });
        return;
      }
      if (!/\d/.test(updateForm.password)) {
        e.preventDefault();
        setUpdateFormError("New password must contain at least one digit");
        toast("New password must contain at least one digit", { className: "bg-red-500 text-white" });
        return;
      }
      if (updateForm.password !== updateForm.confirmPassword) {
        e.preventDefault();
        setUpdateFormError("New password and confirm password do not match");
        toast("Passwords do not match", { className: "bg-red-500 text-white" });
        return;
      }
    }

    if (updateForm.role === "cp" && !updateForm.cpId) {
      e.preventDefault();
      setUpdateFormError("CP ID is required when role is 'cp'");
      toast("CP ID is required when role is 'cp'", { className: "bg-red-500 text-white" });
      return;
    }

    if (updateForm.role === "cp" && (!updateForm.serviceIds || updateForm.serviceIds.length === 0)) {
      e.preventDefault();
      setUpdateFormError("Service IDs are required when role is 'cp'");
      toast("Service IDs are required when role is 'cp'", { className: "bg-red-500 text-white" });
      return;
    }
  };

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-4">
        Manage Users
        <Button type="button" size="icon" onClick={handleShowCreateForm} className="rounded-full p-0 w-8 h-8 flex items-center justify-center">
          <span className="text-2xl leading-none">+</span>
        </Button>
      </h1>

      {/* Create New User Form */}
      {showCreateForm && (
        <div className="mb-8 p-4 border-2 border-green-200 rounded-lg bg-green-50">
          <h2 className="text-lg font-semibold mb-4 text-green-800 flex items-center gap-2">
            <span className="text-2xl">➕</span>
            Create New User
          </h2>
          <Form method="post" className="space-y-4" onSubmit={handleCreateSubmit}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div className="flex gap-4 flex-wrap">
              <div className="flex flex-col">
                <label htmlFor="create-email" className="text-sm font-medium mb-1">Email <span className="text-red-500">*</span></label>
                <Input
                  id="create-email"
                  name="email"
                  type="email"
                  placeholder="user@example.com"
                  value={createForm.email}
                  ref={emailInputRef}
                  onChange={e => {
                    setCreateForm(f => ({ ...f, email: e.target.value }));
                    setCreateFormError(null);
                  }}
                  className={createFormError ? "border-red-500 focus:border-red-500 focus:ring-red-500" : undefined}
                  required
                />
                {createFormError && (
                  <p className="text-sm text-red-600 mt-1">{createFormError}</p>
                )}
              </div>
              <div className="flex flex-col">
                <label htmlFor="create-password" className="text-sm font-medium mb-1">Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Input
                    id="create-password"
                    name="password"
                    type={showCreatePassword ? "password" : "text"}
                    placeholder="Password"
                    value={createForm.password}
                    onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                    className="pr-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showCreatePassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Password must be at least 10 characters long and contain at least one special character and one numeric digit.
                </p>
              </div>
              <div className="flex flex-col">
                <label htmlFor="create-role" className="text-sm font-medium mb-1">Role <span className="text-red-500">*</span></label>
                <select
                  id="create-role"
                  name="role"
                  value={createForm.role}
                  onChange={e => setCreateForm(f => ({ ...f, role: e.target.value as "admin" | "cp" | "operations" }))}
                  required
                  className="border rounded px-2 py-1"
                >
                  <option value="cp">Content Partner (cp)</option>
                  <option value="admin">Administrator (admin)</option>
                  <option value="operations">Operations (operations)</option>
                </select>
              </div>
              <div className="flex flex-col">
                <label htmlFor="create-cpId" className="text-sm font-medium mb-1">
                  CP ID {createForm.role === "cp" && <span className="text-red-500">*</span>}
                </label>
                <select
                  id="create-cpId"
                  name="cpId"
                  value={createForm.cpId}
                  onChange={e => setCreateForm(f => ({ ...f, cpId: e.target.value }))}
                  required={createForm.role === "cp"}
                  className="border rounded px-2 py-1"
                >
                  <option value="">Select a CP</option>
                  {cps.map(cp => (
                    <option key={cp.cpid} value={cp.cpid}>{cp.cpName} ({cp.cpid})</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {createForm.role === "cp"
                    ? "CP ID is required for Content Partner users"
                    : "CP ID is not required for Admin and Operations users"
                  }
                </p>
              </div>
              {createForm.role === "cp" && (
                <div className="flex flex-col" ref={serviceDropdownRef}>
                  <label className="text-sm font-medium mb-1">
                    Service IDs <span className="text-red-500">*</span>
                  </label>

                  {createForm.serviceIds.map(id => (
                    <input key={id} type="hidden" name="serviceIds" value={id} />
                  ))}

                  <div className="relative min-w-[20rem]">
                    <button
                      type="button"
                      onClick={() => { setShowServiceDropdown(v => !v); setServiceSearch(""); }}
                      className="w-full h-9 border border-gray-300 rounded-md px-3 text-sm bg-white text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <span className={createForm.serviceIds.length === 0 ? "text-gray-400" : "text-gray-700"}>
                        {createForm.serviceIds.length === 0 ? "Select service IDs" : `${createForm.serviceIds.length} selected`}
                      </span>
                      <span className="text-gray-400 text-xs">▾</span>
                    </button>

                    {showServiceDropdown && (
                      <div className="absolute z-50 top-full left-0 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg">
                        <div className="p-2 border-b border-gray-100">
                          <input
                            type="text"
                            autoFocus
                            placeholder="Search service IDs..."
                            value={serviceSearch}
                            onChange={e => setServiceSearch(e.target.value)}
                            className="w-full h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="overflow-y-auto max-h-[240px] divide-y divide-gray-100">
                          {serviceIds.filter(s => s.cpId === createForm.cpId).length === 0 ? (
                            <p className="text-sm text-gray-400 px-3 py-3">
                              {createForm.cpId ? "No services available for selected CP" : "Select a CP first"}
                            </p>
                          ) : (() => {
                            const filtered = serviceIds.filter(s =>
                              s.cpId === createForm.cpId &&
                              (s.serviceIdName?.toLowerCase().includes(serviceSearch.toLowerCase()) ||
                                s.serviceId.toLowerCase().includes(serviceSearch.toLowerCase()))
                            );
                            return filtered.length === 0 ? (
                              <p className="text-sm text-gray-400 px-3 py-3">No results for "{serviceSearch}"</p>
                            ) : filtered.map(s => {
                              const checked = createForm.serviceIds.includes(s.serviceId);
                              return (
                                <label
                                  key={s.serviceId}
                                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-blue-50" : "hover:bg-gray-50"
                                    }`}
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(val) => {
                                      setCreateForm(f => ({
                                        ...f,
                                        serviceIds: val
                                          ? [...f.serviceIds, s.serviceId]
                                          : f.serviceIds.filter(id => id !== s.serviceId),
                                      }));
                                    }}
                                  />
                                  <span className="text-sm text-gray-700 leading-tight">
                                    {s.serviceIdName || s.serviceId}
                                    <span className="ml-1.5 text-xs text-gray-400">({s.serviceId})</span>
                                  </span>
                                </label>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" name="intent" value="create" className="bg-green-600 hover:bg-green-700">
                {navigation.state === "submitting" ? "Creating..." : "Create User"}
              </Button>
              <Button type="button" variant="outline" onClick={handleHideCreateForm}>
                Cancel
              </Button>
            </div>
          </Form>
        </div>
      )}

      {/* Edit User Modal */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) handleCancel(); }}>
        <DialogContent className="max-w-xl w-full p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gray-50">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-gray-800">
              {/* <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-600 text-sm">✏️</span> */}
              Edit User
            </DialogTitle>
            <p className="text-sm text-gray-500 mt-0.5 font-normal">{editUser?.email}</p>
          </DialogHeader>

          <Form method="post" onSubmit={handleUpdateSubmit}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="email" value={updateForm.email} />

            <div className="px-6 py-5 space-y-5">

              {/* Password */}
              <div className="space-y-1">
                <label htmlFor="update-current-password" className="text-sm font-medium text-gray-700">
                  Current Password
                </label>
                <div className="relative">
                  <Input
                    id="update-current-password"
                    name="currentPassword"
                    type={showUpdateCurrentPassword ? "text" : "password"}
                    placeholder="Enter current password to change it"
                    value={updateForm.currentPassword}
                    onChange={e => setUpdateForm(f => ({ ...f, currentPassword: e.target.value }))}
                    className="h-9 pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUpdateCurrentPassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showUpdateCurrentPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-1">
                <label htmlFor="update-password" className="text-sm font-medium text-gray-700">New Password</label>
                <div className="relative">
                  <Input
                    id="update-password"
                    name="password"
                    type={showUpdatePassword ? "text" : "password"}
                    placeholder="Leave blank to keep current password"
                    value={updateForm.password}
                    onChange={e => setUpdateForm(f => ({ ...f, password: e.target.value }))}
                    className="h-9 pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUpdatePassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showUpdatePassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-400">Min 10 chars · 1 special character · 1 digit</p>
              </div>

              {/* Confirm New Password */}
              <div className="space-y-1">
                <label htmlFor="update-confirm-password" className="text-sm font-medium text-gray-700">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Input
                    id="update-confirm-password"
                    name="confirmPassword"
                    type={showUpdateConfirmPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={updateForm.confirmPassword}
                    onChange={e => setUpdateForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    className="h-9 pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUpdateConfirmPassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showUpdateConfirmPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Role + CP ID side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="update-role" className="text-sm font-medium text-gray-700">Role</label>
                  <select
                    id="update-role"
                    name="role"
                    value={updateForm.role}
                    onChange={e => setUpdateForm(f => ({ ...f, role: e.target.value as "admin" | "cp" | "operations", cpId: "", serviceIds: [] }))}
                    className="w-full h-9 border border-gray-300 rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="cp">Content Partner</option>
                    <option value="admin">Administrator</option>
                    <option value="operations">Operations</option>
                  </select>
                  <p className="text-xs text-gray-400">Current: <span className="font-medium">{editUser?.role}</span></p>
                </div>

                <div className="space-y-1">
                  <label htmlFor="update-cpId" className="text-sm font-medium text-gray-700">
                    CP ID {updateForm.role === "cp" && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <select
                    id="update-cpId"
                    name="cpId"
                    value={updateForm.cpId}
                    onChange={e => setUpdateForm(f => ({ ...f, cpId: e.target.value, serviceIds: [] }))}
                    required={updateForm.role === "cp"}
                    className="w-full h-9 border border-gray-300 rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select CP</option>
                    {cps.map(cp => (
                      <option key={cp.cpid} value={cp.cpid}>{cp.cpName} ({cp.cpid})</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400">Current: <span className="font-medium">{editUser?.cpId || "Not set"}</span></p>
                </div>
              </div>

              {/* Service IDs — only for cp role */}
              {updateForm.role === "cp" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">
                      Service IDs <span className="text-red-500">*</span>
                    </label>
                    {updateForm.serviceIds.length > 0 && (
                      <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                        {updateForm.serviceIds.length} selected
                      </span>
                    )}
                  </div>

                  {/* hidden inputs so form submission picks up selected values */}
                  {updateForm.serviceIds.map(id => (
                    <input key={id} type="hidden" name="serviceIds" value={id} />
                  ))}

                  <div className="border border-gray-300 rounded-md overflow-hidden">
                    <div className="p-2 border-b border-gray-100">
                      <input
                        type="text"
                        placeholder="Search service IDs..."
                        value={updateServiceSearch}
                        onChange={e => setUpdateServiceSearch(e.target.value)}
                        className="w-full h-8 border border-gray-300 rounded px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="overflow-y-auto max-h-[160px] divide-y divide-gray-100">
                      {serviceIds.filter(s => s.cpId === updateForm.cpId).length === 0 ? (
                        <p className="text-sm text-gray-400 px-3 py-3">No services available for selected CP</p>
                      ) : (() => {
                        const filtered = serviceIds.filter(s =>
                          s.cpId === updateForm.cpId &&
                          (s.serviceIdName?.toLowerCase().includes(updateServiceSearch.toLowerCase()) ||
                            s.serviceId.toLowerCase().includes(updateServiceSearch.toLowerCase()))
                        );
                        return filtered.length === 0 ? (
                          <p className="text-sm text-gray-400 px-3 py-3">No results for "{updateServiceSearch}"</p>
                        ) : filtered.map(s => {
                          const checked = updateForm.serviceIds.includes(s.serviceId);
                          return (
                            <label
                              key={s.serviceId}
                              className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-blue-50" : "hover:bg-gray-50"
                                }`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(val) => {
                                  setUpdateForm(f => ({
                                    ...f,
                                    serviceIds: val
                                      ? [...f.serviceIds, s.serviceId]
                                      : f.serviceIds.filter(id => id !== s.serviceId),
                                  }));
                                }}
                              />
                              <span className="text-sm text-gray-700 leading-tight">
                                {s.serviceIdName || s.serviceId}
                                <span className="ml-1.5 text-xs text-gray-400">({s.serviceId})</span>
                              </span>
                            </label>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {editUser?.serviceIds && editUser.serviceIds.length > 0 && (
                    <p className="text-xs text-gray-400">Current: <span className="font-medium">{editUser.serviceIds.join(', ')}</span></p>
                  )}
                </div>
              )}
            </div>
            {updateFormError && (
              <div className="mx-6 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
                {updateFormError}
              </div>
            )}

            <DialogFooter className="px-6 py-4 border-t bg-gray-50 flex flex-row justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
              <Button type="submit" name="intent" value="update" size="sm" className="bg-blue-600 hover:bg-blue-700 min-w-[110px]">
                {navigation.state === "submitting" ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
      <div>
        <h2 className="text-xl font-semibold mb-2">All Users</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                <th className="px-4 py-2 border">Email</th>
                <th className="px-4 py-2 border">ID</th>
                <th className="px-4 py-2 border">Role</th>
                <th className="px-4 py-2 border">CP ID</th>
                <th className="px-4 py-2 border">Service IDs</th>
                <th className="px-4 py-2 border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users && users.length > 0 ? (
                users.map((user: User) => (
                  <tr key={user.email}>
                    <td className="px-4 py-2 border">{user.email}</td>
                    <td className="px-4 py-2 border">{user.id}</td>
                    <td className="px-4 py-2 border">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${user.role === "admin"
                        ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        : user.role === "operations"
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                        }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 border">{user.cpId || "N/A"}</td>
                    <td className="px-4 py-2 border">
                      {user.serviceIds && user.serviceIds.length > 0
                        ? user.serviceIds.map(id => {
                          const service = serviceIds.find(s => s.serviceId === id);
                          return `${id} (${service?.serviceIdName || service?.serviceId || 'N/A'})`;
                        }).join(', ')
                        : 'N/A'
                      }
                    </td>
                    <td className="px-4 py-2 border">
                      <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={() => handleEdit(user)}>
                          Edit
                        </Button>
                        <Form method="post" className="inline">
                          <input type="hidden" name="_csrf" value={csrfToken} />
                          <input type="hidden" name="email" value={user.email} />
                          <Button
                            type="submit"
                            name="intent"
                            value="delete"
                            size="sm"
                            variant="destructive"
                            onClick={(e) => {
                              if (!confirm("Are you sure you want to delete this user?")) {
                                e.preventDefault();
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </Form>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-4">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
} 