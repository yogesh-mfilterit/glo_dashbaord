import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import Layout from "../components/layout";
import { getAllCPs, createCP, updateCP, getCPByCpid } from "../lib/dynamodb-cp";
import { useState, useEffect, useRef } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { toast } from "sonner";
import { getSession, commitSession } from "../lib/session.server";
import { logDashboardActivity, getClientIP } from "../lib/dynamodb-log";
import { DYNAMODB_TABLES } from "~/lib/config";
import { fullAuthGuard } from "~/util/authGuard";
import { generateCsrfToken, validateCsrfToken, validateCsrfFromForm } from "~/lib/csrf.server";
import { checkQuota, incrementQuota } from "~/lib/quota-limiter.server";
import { saveVersionToS3 } from '~/lib/s3-version';
import { S3_VERSION_BUCKET_NAME } from '../lib/config';
import { validateEmail, validatePhone, validateName } from "../util/validations";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }
  const userRole = session.get("role") || null;
  const userEmail = session.get("email") || null;


  if (userRole === "cp") {
    const userCpid = session.get("cpid");
    const userCpName = session.get("cpName");
    const viewFilters = session.get("viewFilters");

    if (!userCpid) {
      const csrfToken = generateCsrfToken(session);
      const sessionCookie = await commitSession(session);
      return json(
        { cps: [], userRole, userCpid: null, userCpName: null, viewFilters: null, userEmail, csrfToken, error: "CP configuration not found" },
        { headers: { "Set-Cookie": sessionCookie } }
      );
    }

    const allCPs = await getAllCPs();
    const userCP = allCPs.find((cp: any) => cp.cpid === userCpid);

    if (!userCP) {
      const csrfToken = generateCsrfToken(session);
      const sessionCookie = await commitSession(session);
      return json(
        { cps: [], userRole, userCpid, userCpName: null, viewFilters: null, userEmail, csrfToken, error: "CP configuration not found in database" },
        { headers: { "Set-Cookie": sessionCookie } }
      );
    }

    const csrfToken = generateCsrfToken(session);
    const sessionCookie = await commitSession(session);
    return json(
      { cps: [userCP], userRole, userCpid, userCpName: userCP.cpName, viewFilters, userEmail, csrfToken },
      { headers: { "Set-Cookie": sessionCookie } }
    );
  }

  const cps = await getAllCPs();
  const csrfToken = generateCsrfToken(session);
  const sessionCookie = await commitSession(session);
  return json(
    { cps, userRole, userEmail, userCpid: null, userCpName: null, viewFilters: null, csrfToken },
    { headers: { "Set-Cookie": sessionCookie } }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const session = await getSession(request);
  const userRole = session.get("role");
  const userCpid = session.get("cpid");
  const userEmail = session.get("email");
  const user_ip = getClientIP(request);
  const viewFilters = session.get("viewFilters");

  if (!userEmail || !userRole) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate Origin/Referer header
  const originValid = await validateCsrfToken(request, session);
  if (!originValid) {
    return json({ error: "Invalid request origin" }, { status: 403 });
  }

  if (userRole === "operations") {
    return json({ error: "Operations role do not have permission to edit or create" }, { status: 403 });
  }

  if (userRole === "cp" && viewFilters && Array.isArray(viewFilters) && viewFilters.length > 0) {
    return json({ error: "CP users with view filters have view-only access and cannot edit or create" }, { status: 403 });
  }

  const formData = await request.formData();

  // Validate CSRF token from form
  if (!validateCsrfFromForm(formData, session)) {
    return json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  const intent = formData.get("intent");
  const cpName = formData.get("cpName") as string;
  const cpEmail = formData.get("cpEmail") as string;
  const cpContact = formData.get("cpContact") as string;

  // For CP users, ensure they can only update their own CP details
  if (userRole === "cp") {
    if (!userCpid) {
      return json({ error: "CP configuration not found. Please contact administrator." }, { status: 403 });
    }

    if (intent === "update") {
      const cpid = formData.get("cpid") as string;
      if (cpid !== userCpid) {
        return json({ error: "You can only update your own content partner details." }, { status: 403 });
      }
    } else if (intent === "create") {
      return json({ error: "CP users cannot create new content partners." }, { status: 403 });
    }
  }

  if (intent === "create") {
    const quota = await checkQuota(userEmail, "create_cp");
    if (!quota.allowed) return json({ error: quota.message }, { status: 429 });

    const trimmedName = cpName?.trim();
    const trimmedEmail = cpEmail?.trim();
    const trimmedContact = cpContact?.trim();

    if (!trimmedName || !trimmedEmail || !trimmedContact) {
      return json({ error: "All fields are required" }, { status: 400 });
    }
    const nameError = validateName(trimmedName);
    const emailError = validateEmail(trimmedEmail);
    const phoneError = validatePhone(trimmedContact);
    if (nameError || emailError || phoneError) {
      return json(
        { error: nameError || emailError || phoneError },
        { status: 400 }
      );
    }
    const cpData = {
      cpName: trimmedName,
      cpEmail: trimmedEmail,
      cpContact: trimmedContact
    };
    const newCP = await createCP(cpData);
    incrementQuota(userEmail, "create_cp");
    await saveVersionToS3(S3_VERSION_BUCKET_NAME, "content-partners", newCP.cpid, newCP);

    // Log the create activity
    await logDashboardActivity(
      DYNAMODB_TABLES.CP_DETAILS,
      "CREATE_CP",
      //cpData,
      newCP,
      user_ip,
      userEmail
    );

    return json({ success: "created" });
  } else if (intent === "update") {
    const updateQuota = await checkQuota(userEmail, "update");
    if (!updateQuota.allowed) return json({ error: updateQuota.message }, { status: 429 });
    const cpid = formData.get("cpid") as string;
    if (!cpid || !/^\d+$/.test(cpid)) {
      return json({ error: "Cannot update cpid" }, { status: 400 });
    }
    const existingCP = await getCPByCpid(cpid);
    if (!existingCP) {
      return json({ error: "Cannot update cpid" }, { status: 400 });
    }
    const updateData = { cpName, cpEmail, cpContact };
    //await updateCP(cpid, updateData);
    const updatedCP = await updateCP(cpid, updateData);
    incrementQuota(userEmail, "update");
    if (updatedCP) {
      await saveVersionToS3(S3_VERSION_BUCKET_NAME, "content-partners", cpid, updatedCP);
    }

    // Log the update activity
    await logDashboardActivity(
      DYNAMODB_TABLES.CP_DETAILS,
      "UPDATE_CP",
      //{ cpid, ...updateData },
      updatedCP,
      user_ip,
      userEmail
    );

    return json({ success: "updated" });
  }
  return null;
}

function formatDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleString();
}

export default function ContentPartners() {
  const { cps, userRole, userCpid, userCpName, viewFilters, userEmail, csrfToken, error } = useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [editCP, setEditCP] = useState<any | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Form state for create/update
  const [form, setForm] = useState({ cpName: "", cpEmail: "", cpContact: "" });
  const cpNameInputRef = useRef<HTMLInputElement>(null);

  const [showCustomToast, setShowCustomToast] = useState(false);
  const [toastPosition, setToastPosition] = useState({ top: 0, left: 0 });
  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState({ cpName: "", cpEmail: "", cpContact: "" });
  const isFormValid = form.cpName && form.cpEmail && form.cpContact && !errors.cpName && !errors.cpEmail && !errors.cpContact;

  // Determine if user has view-only access
  const isViewOnly = userRole === "operations" || (userRole === "cp" && viewFilters && Array.isArray(viewFilters) && viewFilters.length > 0);

  const handleCpNameClick = () => {
    if (cpNameInputRef.current) {
      const rect = cpNameInputRef.current.getBoundingClientRect();
      const top = rect.top - 10; // 10px above the input
      const left = rect.left;

      setToastPosition({ top, left });
      setShowCustomToast(true);
    } else {
      // Fallback to center if ref is not available
      setToastPosition({ top: 100, left: window.innerWidth / 2 - 300 });
      setShowCustomToast(true);
    }
  };

  const closeToast = () => {
    setShowCustomToast(false);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Trim all fields before submission
    const trimmedCpName = form.cpName.trim();
    const trimmedCpEmail = form.cpEmail.trim();
    const trimmedCpContact = form.cpContact.trim();

    if (trimmedCpName !== form.cpName) {
      setForm(f => ({ ...f, cpName: trimmedCpName }));
    }
    if (trimmedCpEmail !== form.cpEmail) {
      setForm(f => ({ ...f, cpEmail: trimmedCpEmail }));
    }
    if (trimmedCpContact !== form.cpContact) {
      setForm(f => ({ ...f, cpContact: trimmedCpContact }));
    }
  };

  const handleEdit = (cp: any) => {
    setEditCP(cp);
    setForm({ cpName: cp.cpName, cpEmail: cp.cpEmail, cpContact: cp.cpContact });
    setEditModalOpen(true);
  };

  const handleView = (cp: any) => {
    setEditCP(cp);
    setForm({ cpName: cp.cpName, cpEmail: cp.cpEmail, cpContact: cp.cpContact });
  };

  const handleCancel = () => {
    setEditCP(null);
    setEditModalOpen(false);
    setForm({ cpName: "", cpEmail: "", cpContact: "" });
  };
  const handleShowForm = () => {
    setShowForm(prev => !prev);
  };

  const handleChange = (field: string, value: string) => {
    setForm(f => ({ ...f, [field]: value }));

    let error = "";

    if (field === "cpEmail") error = validateEmail(value);
    if (field === "cpContact") error = validatePhone(value);
    if (field === "cpName") error = validateName(value);
    setErrors(prev => ({ ...prev, [field]: error }));
  };

  useEffect(() => {
    if (navigation.state === "idle" && actionData) {
      if ('success' in actionData && actionData.success === "created") {
        toast("Content Partner created successfully!", { className: "bg-green-500 text-white" });
        setForm({ cpName: "", cpEmail: "", cpContact: "" });
      } else if ('success' in actionData && actionData.success === "updated") {
        toast("Content Partner updated successfully!", { className: "bg-green-500 text-white" });
        setEditCP(null);
        setEditModalOpen(false);
        setForm({ cpName: "", cpEmail: "", cpContact: "" });
      } else if ('error' in actionData) {
        toast(actionData.error, { className: "bg-red-500 text-white" });
      }
    }
  }, [actionData, navigation.state]);

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          <strong>Error:</strong> {error}. Please contact your administrator.
        </div>
      )}

      <h1 className="text-2xl font-bold mb-6 flex items-center gap-3">
  {userRole === "cp" ? "My Content Partner Profile" : "Content Partners"}

  {userRole === "admin" && (
    <Button
      type="button"
      size="icon"
      onClick={handleShowForm}
      className="rounded-full p-0 w-8 h-8 flex items-center justify-center"
    >
      <span className="text-2xl leading-none">+</span>
    </Button>
  )}
</h1>



      {/* Show create form for admin users */}
      {userRole === "admin" && !editCP && showForm && (
        <div className="mb-8">
          <Form method="post" className="space-y-4" onSubmit={handleSubmit}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div className="flex gap-4">
              <div className="flex flex-col w-full">
                <Input
                  ref={cpNameInputRef}
                  name="cpName"
                  placeholder="CP Name"
                  value={form.cpName}
                  onChange={(e) => handleChange("cpName", e.target.value)}
                  onClick={handleCpNameClick}
                  required
                />
                {errors.cpName && <p className="text-red-500 text-sm">{errors.cpName}</p>}
              </div>
              <div className="flex flex-col w-full">
                <Input
                  name="cpEmail"
                  placeholder="CP Email"
                  value={form.cpEmail}
                  onChange={(e) => handleChange("cpEmail", e.target.value)}
                  required
                />
                {errors.cpEmail && <p className="text-red-500 text-sm">{errors.cpEmail}</p>}
              </div>
              <div className="flex flex-col w-full">
                <Input
                  name="cpContact"
                  placeholder="CP Contact"
                  value={form.cpContact}
                  onChange={(e) => handleChange("cpContact", e.target.value)}
                  required
                />
                {errors.cpContact && <p className="text-red-500 text-sm">{errors.cpContact}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" name="intent" value="create" disabled={!isFormValid}>
                {navigation.state === "submitting" ? "Creating..." : "Create CP"}
              </Button>
            </div>
          </Form>
        </div>
      )}

      {/* View form for operations role */}
      {userRole === "operations" && editCP && (
        <div className="mb-8">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">CP Name</label>
                <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {form.cpName}
                </div>
              </div>
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">CP Email</label>
                <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {form.cpEmail}
                </div>
              </div>
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">CP Contact</label>
                <div className="border rounded px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {form.cpContact}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleCancel}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-2">
          {userRole === "cp" ? "My Content Partner Details" : "All Content Partners"}
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                <th className="px-4 py-2 border">CPID</th>
                <th className="px-4 py-2 border">Name</th>
                <th className="px-4 py-2 border">Email</th>
                <th className="px-4 py-2 border">Contact</th>
                <th className="px-4 py-2 border">Created At</th>
                <th className="px-4 py-2 border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cps && cps.length > 0 ? (
                cps.map((cp: any) => (
                  <tr key={cp.cpid}>
                    <td className="px-4 py-2 border">{cp.cpid}</td>
                    <td className="px-4 py-2 border">{cp.cpName}</td>
                    <td className="px-4 py-2 border">{cp.cpEmail}</td>
                    <td className="px-4 py-2 border">{cp.cpContact}</td>
                    <td className="px-4 py-2 border">{formatDate(cp.createdAt)}</td>
                    <td className="px-4 py-2 border">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => isViewOnly ? handleView(cp) : handleEdit(cp)}
                      >
                        {isViewOnly ? "View" : "Edit"}
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-4">
                    No Content Partners found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom Toast with Close Button */}
      {showCustomToast && (
        <div
          style={{
            position: 'fixed',
            top: `${toastPosition.top}px`,
            left: `${toastPosition.left}px`,
            zIndex: 9999,
            maxWidth: '600px',
            width: '90%',
            transform: 'translateY(-100%)',
            margin: '8px',
            padding: '12px 16px',
            backgroundColor: '#fdf2f8',
            color: '#1f2937',
            border: '2px solid #f9a8d4',
            borderRadius: '8px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            fontSize: '14px',
            lineHeight: '1.4',
          }}
        >
          <div style={{ position: 'relative' }}>
            <button
              onClick={closeToast}
              style={{
                position: 'absolute',
                top: '-8px',
                right: '-8px',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: '#f9a8d4',
                border: '2px solid #ec4899',
                color: '#831843',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: '1',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#ec4899';
                e.currentTarget.style.color = 'white';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#f9a8d4';
                e.currentTarget.style.color = '#831843';
              }}
            >
              ×
            </button>
            ⚠️ IMPORTANT: Enter CP Name EXACTLY as configured in MTN SM. This field is used as NodeId in SDP communication and is therefore critical, else SDP activations will fail. Ensure that space and dots are entered exactly as they are configured in SM
          </div>
        </div>
      )}

      {/* Edit Content Partner Modal */}
      <Dialog open={editModalOpen} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Edit Content Partner: {editCP?.cpName}
            </DialogTitle>
          </DialogHeader>
          {editCP && (
            <Form method="post" className="space-y-4" onSubmit={handleSubmit}>
              <input type="hidden" name="_csrf" value={csrfToken} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col">
                  <label htmlFor="edit-cpName" className="text-sm font-medium mb-1">CP Name</label>
                  <Input
                    id="edit-cpName"
                    name="cpName"
                    placeholder="CP Name"
                    value={form.cpName}
                    onChange={(e) => handleChange("cpName", e.target.value)}
                    onClick={handleCpNameClick}
                    required
                  />
                  {errors.cpName && <p className="text-red-500 text-sm">{errors.cpName}</p>}

                </div>
                <div className="flex flex-col">
                  <label htmlFor="edit-cpEmail" className="text-sm font-medium mb-1">CP Email</label>
                  <Input
                    id="edit-cpEmail"
                    name="cpEmail"
                    placeholder="CP Email"
                    value={form.cpEmail}
                    onChange={(e) => handleChange("cpEmail", e.target.value)}
                    required
                  />
                  {errors.cpEmail && <p className="text-red-500 text-sm">{errors.cpEmail}</p>}
                </div>
                <div className="flex flex-col">
                  <label htmlFor="edit-cpContact" className="text-sm font-medium mb-1">CP Contact</label>
                  <Input
                    id="edit-cpContact"
                    name="cpContact"
                    placeholder="CP Contact"
                    value={form.cpContact}
                    onChange={(e) => handleChange("cpContact", e.target.value)}
                    required
                  />
                  {errors.cpContact && <p className="text-red-500 text-sm">{errors.cpContact}</p>}
                </div>
              </div>
              <input type="hidden" name="cpid" value={editCP.cpid} />
              <div className="flex justify-end gap-2 pt-4">
                <Button type="submit" name="intent" value="update" disabled={!isFormValid}>
                  {navigation.state === "submitting" ? "Updating..." : "Update CP"}
                </Button>
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
            </Form>
          )}
        </DialogContent>
      </Dialog>

    </Layout>
  );
} 