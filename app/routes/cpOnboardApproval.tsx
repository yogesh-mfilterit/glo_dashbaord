import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import Layout from "../components/layout";
import { getAllServiceIds, updateServiceId } from "../lib/dynamodb-serviceid";
import { getAllCPs } from "../lib/dynamodb-cp";
import { useState, useEffect } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { toast } from "sonner";
import { getSession } from "../lib/session.server";
import { logDashboardActivity, getClientIP } from "../lib/dynamodb-log";
import { fullAuthGuard } from "~/util/authGuard";

function formatDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleString();
}

function truncateText(text: string, maxLength: number = 80): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }
  const userRole = session.get("role") || null;
  const userEmail = session.get("email") || null;
  
  // Only allow admin users to access this page
  if (userRole !== "admin") {
    return json({ 
      serviceIds: [], 
      cps: [], 
      userRole, 
      userEmail,
      error: "Access denied. Admin role required." 
    }, { status: 403 });
  }
  
  const [allServiceIds, cps] = await Promise.all([
    getAllServiceIds(),
    getAllCPs(),
  ]);
  
  // Filter to show only services that are not live (pending approval)
  const pendingServices = allServiceIds.filter((sid: any) => 
    sid.isLive === false
  );
  
  return json({ 
    serviceIds: pendingServices, 
    cps, 
    userRole, 
    userEmail
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await getSession(request);
  const userRole = session.get("role");
  const userEmail = session.get("email");
  
  // Only allow admin users to perform actions
  if (userRole !== "admin") {
    return json({ error: "Access denied. Admin role required." }, { status: 403 });
  }
  
  if (request.method.toLowerCase() === "post") {
    const formData = await request.formData();
    const intent = formData.get("intent");
    const serviceId = formData.get("serviceId") as string;
    const action = formData.get("action") as string; // "approve" or "reject"
    
    if (intent === "approve_service") {
      try {
        // Update the service to be live
        await updateServiceId(serviceId, { isLive: true });
        
        // Log the approval activity
        const ipAddress = getClientIP(request);
        await logDashboardActivity(
          "mtn-nigeria-dev-serviceId-approval",
          "UPDATE",
          { serviceId, action: "approved", approvedBy: userEmail },
          ipAddress
        );
        
        return json({ success: "Service approved successfully" });
      } catch (err) {
        console.error("Error approving service:", err);
        return json({ error: "Failed to approve service." }, { status: 500 });
      }
    } else if (intent === "reject_service") {
      try {
        // For rejection, we could either delete the service or mark it as rejected
        // For now, let's mark it as rejected by setting isLive to false and adding a rejection flag
        await updateServiceId(serviceId, { isLive: false, rejected: true });
        
        // Log the rejection activity
        const ipAddress = getClientIP(request);
        await logDashboardActivity(
          "mtn-nigeria-dev-serviceId-approval",
          "UPDATE",
          { serviceId, action: "rejected", rejectedBy: userEmail },
          ipAddress
        );
        
        return json({ success: "Service rejected successfully" });
      } catch (err) {
        console.error("Error rejecting service:", err);
        return json({ error: "Failed to reject service." }, { status: 500 });
      }
    }
  }
  
  return null;
}

export default function CPOnboardApproval() {
  const { serviceIds, cps, userRole, userEmail, error } = useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [cpNameFilter, setCpNameFilter] = useState("");
  const [selectedBanner, setSelectedBanner] = useState<string | null>(null);
  const [viewServiceId, setViewServiceId] = useState<any | null>(null);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<any | null>(null);
  const [approvalAction, setApprovalAction] = useState<"approve" | "reject" | null>(null);

  // Filter service IDs based on CP name filter
  const filteredServiceIds = serviceIds.filter((sid: any) => {
    if (!cpNameFilter) return true;
    const cp = cps.find((cp: any) => cp.cpid === sid.cpId);
    if (!cp) return false;
    return cp.cpName.toLowerCase().includes(cpNameFilter.toLowerCase());
  });

  useEffect(() => {
    if (navigation.state === "idle" && actionData) {
      if ('success' in actionData) {
        toast(actionData.success, { className: "bg-green-500 text-white" });
        setApprovalModalOpen(false);
        setSelectedService(null);
        setApprovalAction(null);
      } else if ('error' in actionData) {
        toast(actionData.error, { className: "bg-red-500 text-white" });
      }
    }
  }, [actionData, navigation.state]);

  const handleViewModal = (sid: any) => {
    setViewServiceId(sid);
  };

  const handleApproval = (service: any, action: "approve" | "reject") => {
    setSelectedService(service);
    setApprovalAction(action);
    setApprovalModalOpen(true);
  };

  const handleApprovalConfirm = () => {
    if (!selectedService || !approvalAction) return;
    
    const form = document.createElement('form');
    form.method = 'POST';
    form.innerHTML = `
      <input type="hidden" name="intent" value="${approvalAction === 'approve' ? 'approve_service' : 'reject_service'}" />
      <input type="hidden" name="serviceId" value="${selectedService.serviceId}" />
      <input type="hidden" name="action" value="${approvalAction}" />
    `;
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  const handleApprovalCancel = () => {
    setApprovalModalOpen(false);
    setSelectedService(null);
    setApprovalAction(null);
  };

  if (error) {
    return (
      <Layout userRole={userRole} userEmail={userEmail}>
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          <strong>Error:</strong> {error}
        </div>
      </Layout>
    );
  }

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-4">
        CP Onboard Approval
        <span className="text-sm font-normal text-gray-600 bg-yellow-100 px-2 py-1 rounded">
          {filteredServiceIds.length} pending services
        </span>
      </h1>
      
      <div>
        <h2 className="text-xl font-semibold mb-2">Pending Service Approvals</h2>
        
        {/* CP Name Filter */}
        <div className="mb-4">
          <label htmlFor="cpNameFilter" className="block text-sm font-medium text-gray-700 mb-2">
            Filter by CP Name
          </label>
          <Input
            id="cpNameFilter"
            type="text"
            placeholder="Enter CP name to filter..."
            value={cpNameFilter}
            onChange={(e) => setCpNameFilter(e.target.value)}
            className="max-w-md"
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServiceIds && filteredServiceIds.length > 0 ? (
            filteredServiceIds.map((sid: any) => {
              const cp = cps.find((cp: any) => cp.cpid === sid.cpId);
              return (
                <div key={sid.serviceId} className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-shadow duration-200">
                  {/* Banner Image */}
                  <div className="h-48 bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    {sid.bannerUrl ? (
                      <button
                        type="button"
                        onClick={() => setSelectedBanner(sid.bannerUrl)}
                        className="w-full h-full hover:opacity-90 transition-opacity"
                      >
                        <img 
                          src={sid.bannerUrl} 
                          alt="Service Banner" 
                          className="w-full h-full object-cover cursor-pointer" 
                        />
                      </button>
                    ) : (
                      <div className="text-gray-400 dark:text-gray-500 text-center">
                        <svg className="w-12 h-12 mx-auto mb-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                        <p className="text-sm">No Banner Image</p>
                      </div>
                    )}
                  </div>
                  
                  {/* Card Content */}
                  <div className="p-4">
                    {/* Service ID */}
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={() => handleViewModal(sid)}
                        className="text-lg font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                      >
                        {sid.serviceId}
                      </button>
                    </div>
                    
                    {/* Service Name */}
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                      {sid.serviceIdName}
                    </h3>
                    
                    {/* CP Name */}
                    <div className="mb-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        {cp ? cp.cpName : sid.cpId}
                      </span>
                    </div>
                    
                    {/* Service Text */}
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">
                        {sid.serviceIdText || "No description provided"}
                      </p>
                    </div>
                    
                    {/* Created Date */}
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Created: {formatDate(sid.createdAt)}
                      </p>
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      <Button 
                        size="sm"
                        onClick={() => handleApproval(sid, "approve")}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      >
                        Approve
                      </Button>
                      <Button 
                        size="sm"
                        onClick={() => handleApproval(sid, "reject")}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full text-center py-12">
              <div className="text-gray-400 dark:text-gray-500">
                <svg className="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm8 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V8zm0 4a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1v-2z" clipRule="evenodd" />
                </svg>
                <p className="text-lg font-medium mb-2">No Pending Services</p>
                <p className="text-sm">
                  {cpNameFilter 
                    ? `No pending services found for CP name containing "${cpNameFilter}".` 
                    : "All services have been reviewed and approved."
                  }
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Banner Modal */}
      <Dialog open={!!selectedBanner} onOpenChange={(open) => !open && setSelectedBanner(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Banner Image</DialogTitle>
          </DialogHeader>
          {selectedBanner && (
            <div className="flex justify-center">
              <img 
                src={selectedBanner} 
                alt="Banner Full Size" 
                className="max-w-full max-h-[70vh] object-contain rounded shadow-lg" 
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Service ID View Modal */}
      <Dialog open={!!viewServiceId} onOpenChange={(open) => !open && setViewServiceId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Service ID Details</DialogTitle>
          </DialogHeader>
          {viewServiceId && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Service ID</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewServiceId.serviceId}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Content Partner (CP)</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {(() => {
                      const cp = cps.find((cp: any) => cp.cpid === viewServiceId.cpId);
                      return cp ? `${cp.cpName} (${viewServiceId.cpId})` : viewServiceId.cpId;
                    })()}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Service Name</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {viewServiceId.serviceIdName}
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium mb-1">Created At</label>
                  <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    {formatDate(viewServiceId.createdAt)}
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Service Text</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[60px] whitespace-pre-wrap">
                  {viewServiceId.serviceIdText || "-"}
                </div>
              </div>
              
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Script Tags</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[60px] whitespace-pre-wrap">
                  {viewServiceId.scriptTags || "-"}
                </div>
              </div>
              
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Body Script Tags</label>
                <div className="border rounded px-3 py-2 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-h-[60px] whitespace-pre-wrap">
                  {viewServiceId.bodyScriptTags || "-"}
                </div>
              </div>
              
              <div className="flex flex-col">
                <label className="text-sm font-medium mb-1">Banner Image</label>
                {viewServiceId.bannerUrl ? (
                  <div className="w-80 h-40 border rounded shadow overflow-hidden bg-gray-50 flex items-center justify-center">
                    <img 
                      src={viewServiceId.bannerUrl} 
                      alt="Banner" 
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  </div>
                ) : (
                  <div className="w-80 h-40 border rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 flex items-center justify-center">
                    No Image
                  </div>
                )}
              </div>
              
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setViewServiceId(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approval Confirmation Modal */}
      <Dialog open={approvalModalOpen} onOpenChange={(open) => !open && handleApprovalCancel()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {approvalAction === "approve" ? "Approve Service" : "Reject Service"}
            </DialogTitle>
          </DialogHeader>
          {selectedService && (
            <div className="space-y-4">
              <p className="text-gray-700">
                Are you sure you want to {approvalAction} the service{" "}
                <strong>{selectedService.serviceIdName}</strong> (ID: {selectedService.serviceId})?
              </p>
              {approvalAction === "approve" && (
                <p className="text-sm text-green-600">
                  This will make the service live and available to users.
                </p>
              )}
              {approvalAction === "reject" && (
                <p className="text-sm text-red-600">
                  This will reject the service and it will not be made live.
                </p>
              )}
              <div className="flex justify-end gap-2 pt-4">
                <Button 
                  onClick={handleApprovalConfirm}
                  className={approvalAction === "approve" 
                    ? "bg-green-600 hover:bg-green-700 text-white" 
                    : "bg-red-600 hover:bg-red-700 text-white"
                  }
                  disabled={navigation.state === "submitting"}
                >
                  {navigation.state === "submitting" 
                    ? (approvalAction === "approve" ? "Approving..." : "Rejecting...") 
                    : (approvalAction === "approve" ? "Approve" : "Reject")
                  }
                </Button>
                <Button type="button" variant="outline" onClick={handleApprovalCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
