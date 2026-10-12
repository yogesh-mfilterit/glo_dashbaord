import { LoaderFunctionArgs, redirect } from '@remix-run/node';
import { getAllCPs } from '~/lib/dynamodb-cp';
import { getAllProducts } from '~/lib/dynamodb-products';
import { getAllServiceIds } from '~/lib/dynamodb-serviceid';
import { getSession } from '~/lib/session.server';
import mysqlService from '~/lib/mysql.server';
import {
  getDashboardData,
  getTop5BlockedCPQuery,
  getTop5BlockedServicesQuery,
  getTop5BlockedTrafficSourceQuery,
} from '~/lib/mysql-queries';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { useLoaderData, useNavigate, useSearchParams, useFetcher } from '@remix-run/react';
import Layout from '~/components/layout';
import { useState, useEffect } from 'react';
import SummaryTab from '~/summary/SummaryTab';
import BotAnalysisTab from '~/summary/BotAnalysisTab';
import CustomDropdown from '~/components/ui/CustomDropdown';
import { fullAuthGuard } from '~/util/authGuard';

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }
  const userRole = session.get('role') || null;

  const userCpid = session.get('cpid') || null;

  const url = new URL(request.url);
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const cpParam = url.searchParams.get('cp'); // Get CP filter from URL
  const service_id = url.searchParams.get('service_id');
  const subscription_desc = url.searchParams.get('subscription_desc');

  const selectedCp = url.searchParams.get('selectedcp');

  const [cpList, serviceIdList, productList] = await Promise.all([
    getAllCPs(),
    getAllServiceIds(),
    getAllProducts(),
  ]);



  const filters_available = session.get('viewFilters');
  let filteredServiceIdList: any = [];
  if (filters_available) {
    filteredServiceIdList = serviceIdList.filter((item) =>
      filters_available.includes(item.serviceId),
    );
  }

  let finalCpParam: string | undefined = undefined;
  if (userRole === 'cp') {
    finalCpParam = userCpid || undefined;
  } else if (cpParam && cpParam !== 'ALL') {
    finalCpParam = cpParam;
  }

  // Set default dates if not provided (using local timezone)
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 7); // 7 days ago
  const defaultEndDate = new Date();

  // Format dates in local timezone to avoid timezone conversion issues
  const formatLocalDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const startDate = startParam || formatLocalDate(defaultStartDate);
  const endDate = endParam || formatLocalDate(defaultEndDate);

  // Validate that start date is before end date
  if (startDate > endDate) {
    console.error('[DEBUG] Invalid date range: start date is after end date');
    return {
      userRole,
      userEmail: session.get('email'),
      userCpid,
      cpList,
      serviceIdList: filteredServiceIdList.length > 0 ? filteredServiceIdList : serviceIdList,
      productList,
      initialData: [],
      defaultStart: startDate,
      defaultEnd: endDate,
      selectedCp,
      cpParam,
      service_id,
      subscription_desc,
      error: 'Start date must be before end date',
    };
  }



  let dashboardData: any[] = [];
  let top5BlockedServicesData: any[] = [];
  let top5BlockedCPData: any[] = [];
  let top5BlockedTrafficSourceData: any[] = [];
  try {

    dashboardData = await getDashboardData(mysqlService, {
      start_date: startDate,
      end_date: endDate,
    });


    // Log the actual dates in the returned data
    if (dashboardData.length > 0) {

      dashboardData.forEach((row, index) => {

      });
    }
  } catch (error) {
    console.error('[DEBUG] Error fetching dashboard data:', error);
    dashboardData = [];
    top5BlockedServicesData = [];
    top5BlockedCPData = [];
    top5BlockedTrafficSourceData = [];
  }

  return {
    userRole,
    userEmail: session.get('email'),
    userCpid,
    cpList,
    serviceIdList: filteredServiceIdList.length > 0 ? filteredServiceIdList : serviceIdList,
    productList,
    initialData: dashboardData,
    defaultStart: startDate,
    defaultEnd: endDate,
    selectedCp,
    cpParam,
    service_id,
    subscription_desc,
    top5BlockedServicesData,
    top5BlockedCPData,
    top5BlockedTrafficSourceData,
  };
}

export default function NewSummary() {
  const loaderData = useLoaderData<typeof loader>();
  const {
    userRole,
    userEmail,
    userCpid,
    initialData,
    defaultStart,
    defaultEnd,
    error,
    cpList,
    serviceIdList,
    productList,
    top5BlockedServicesData,
    top5BlockedCPData,
    top5BlockedTrafficSourceData,
  } = loaderData;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher<typeof loader>();

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [dateError, setDateError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter states
  const [selectedCp, setSelectedCp] = useState(userRole === 'cp' ? userCpid || '' : '');

  // For CP users, get their services and set the first one as default
  const getCPUserServices = () => {
    if (userRole === 'cp' && userCpid) {
      return (serviceIdList || []).filter((service: any) => {
        return service.cpId === userCpid;
      });
    }
    return [];
  };

  const cpUserServices = getCPUserServices();
  const firstServiceId = cpUserServices.length > 0 ? cpUserServices[0].serviceId : '';

  const [selectedServiceId, setSelectedServiceId] = useState(
    userRole === 'cp' ? firstServiceId : '',
  );
  const [selectedSubscription, setSelectedSubscription] = useState('');

  // Effect to set first service when serviceIdList loads for CP users
  useEffect(() => {
    if (userRole === 'cp' && userCpid && serviceIdList && serviceIdList.length > 0) {
      const cpServices = serviceIdList.filter((service: any) => service.cpId === userCpid);
      if (cpServices.length > 0 && !selectedServiceId) {
        setSelectedServiceId(cpServices[0].serviceId);
      }
    }
  }, [serviceIdList, userRole, userCpid, selectedServiceId]);


  // Get filtered options based on selections
  const getFilteredServices = () => {
    if (userRole === 'cp') {
      // For CP users, show only their services
      return (serviceIdList || []).filter((service: any) => {
        return service.cpId === userCpid;
      });
    }

    if (selectedCp === 'ALL' || !selectedCp) {
      return serviceIdList || [];
    }
    // Filter services based on selected CP
    return (serviceIdList || []).filter((service: any) => {
      return service.cpId === selectedCp;
    });
  };

  const getFilteredSubscriptions = () => {
    if (selectedServiceId === 'ALL' || !selectedServiceId) {
      return productList || [];
    }
    // Filter subscriptions based on selected Service ID
    return (productList || []).filter((product: any) => {
      // You might need to adjust this logic based on your data structure
      // This assumes there's a relationship between Service and Subscription
      return (
        product.serviceId === selectedServiceId || product.associatedService === selectedServiceId
      );
    });
  };

  // Update URL when dates change (without showing start/end params)
  const updateDates = (newStartDate: string, newEndDate: string) => {
    const params = new URLSearchParams(searchParams);
    // Remove start and end from URL to hide them
    params.delete('start');
    params.delete('end');
    // Keep other params like cp, service_id, etc.
    const otherParams = params.toString();
    const newUrl = otherParams ? `?${otherParams}` : '';
    navigate(newUrl);
  };
  const addDays = (dateStr: string, days: number) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  const today = new Date().toISOString().split('T')[0];

  // Handle start date change (no auto-trigger)
  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newStartDate = e.target.value;

    setStartDate(newStartDate);

    // Auto-adjust end date if invalid
    if (!endDate || newStartDate > endDate) {
      // set end date to min(start + 30 days, today)
      const autoEnd = addDays(newStartDate, 30);
      setEndDate(autoEnd > today ? today : autoEnd);
      setDateError('');
      return;
    }

    // Optional: enforce 30-day window
    const maxAllowedEnd = addDays(newStartDate, 30);
    if (endDate > maxAllowedEnd) {
      setEndDate(maxAllowedEnd);
    }

    setDateError('');
  };

  // Handle end date change (no auto-trigger)
  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEndDate = e.target.value;

    if (newEndDate < startDate) {
      setEndDate(startDate);
      setDateError('');
      return;
    }

    const maxAllowedEnd = addDays(startDate, 30);
    if (newEndDate > maxAllowedEnd) {
      setEndDate(maxAllowedEnd);
      setDateError('');
      return;
    }

    setEndDate(newEndDate);
    setDateError('');
  };

  // Handle CP change - reset dependent dropdowns
  const handleCpChange = (cpValue: string) => {
    setSelectedCp(cpValue);
    // Reset Service ID and Subscription when CP changes
    setSelectedServiceId('');
    setSelectedSubscription('');
  };

  // Handle Service ID change - reset dependent dropdowns
  const handleServiceIdChange = (serviceValue: string) => {
    setSelectedServiceId(serviceValue);
    // Reset Subscription when Service ID changes
    setSelectedSubscription('');
  };

  // Handle submit button click
  const handleSubmit = () => {
    if (!startDate || !endDate) {
      setDateError('Start and End dates are required');
      return;
    }

    const maxEndDate = addDays(startDate, 30);

    if (endDate > maxEndDate) {
      setDateError('End date cannot be more than 30 days after start date');
      return;
    }

    if (startDate > endDate) {
      setDateError('Start date must be before end date');
      return;
    }

    setDateError('');
    setIsSubmitting(true);

    const formData = new FormData();
    formData.append('start', startDate);
    formData.append('end', endDate);

    fetcher.submit(formData, { method: 'get' });
  };

  // Reset submitting state when fetcher completes
  useEffect(() => {
    if (fetcher.state === 'idle' && isSubmitting) {
      setIsSubmitting(false);
    }
  }, [fetcher.state, isSubmitting]);

  // Use fetcher data if available, otherwise use initial data
  const rawData = fetcher.data?.initialData || initialData;
  const currentError = fetcher.data?.error || error;

  // Filter data based on selected filters
  const currentData = rawData.filter((record: any) => {
    // For CP users, filter by their CP ID
    if (userRole === 'cp' && userCpid) {
      if (record.cp_wise_total_traffic && !record.cp_wise_total_traffic[userCpid]) {
        return false;
      }
    } else {
      // Filter by CP for non-CP users
      if (selectedCp && selectedCp !== 'ALL') {
        if (record.cp_wise_total_traffic && !record.cp_wise_total_traffic[selectedCp]) {
          return false;
        }
      }
    }

    // Filter by Service ID
    if (selectedServiceId && selectedServiceId !== 'ALL') {
      if (record.service_wise_traffic && !record.service_wise_traffic[selectedServiceId]) {
        return false;
      }
    }

    // Filter by Subscription (if available in data)
    if (selectedSubscription && selectedSubscription !== 'ALL') {
      if (
        record.subscription_wise_traffic &&
        !record.subscription_wise_traffic[selectedSubscription]
      ) {
        return false;
      }
    }

    return true;
  });

  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      <div>
        {/* Error message */}
        {(currentError || dateError) && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {currentError || dateError}
          </div>
        )}

        <Tabs defaultValue="summary">
          <div className="flex justify-between items-center mb-4">
            <TabsList>
              <TabsTrigger
                value="summary"
                className="data-[state=active]:bg-blue-500 data-[state=active]:text-white"
              >
                Summary
              </TabsTrigger>
              <TabsTrigger
                value="bot_traffic"
                className="data-[state=active]:bg-blue-500 data-[state=active]:text-white"
              >
                Bot Traffic
              </TabsTrigger>
            </TabsList>

            {/* Date inputs on the right side */}
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <label
                  htmlFor="startDate"
                  className="text-sm font-medium text-gray-700 whitespace-nowrap"
                >
                  Start Date:
                </label>
                <input type="date" value={startDate} max={today} onChange={handleStartDateChange} className="w-32 px-2 py-1 text-sm border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent" />
              </div>

              <div className="flex items-center space-x-2">
                <label
                  htmlFor="endDate"
                  className="text-sm font-medium text-gray-700 whitespace-nowrap"
                >
                  End Date:
                </label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={addDays(startDate, 30) > today ? today : addDays(startDate, 30)}
                  onChange={handleEndDateChange}
                  className="w-32 px-2 py-1 text-sm border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={isSubmitting || fetcher.state === 'submitting'}
                className="px-4 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting || fetcher.state === 'submitting' ? 'Loading...' : 'Submit'}
              </button>
            </div>
          </div>

          {/* Filter Section - Now under tabs and dates */}
          <div className="bg-white p-4 rounded-lg shadow mb-4">
            <div
              className={`grid grid-cols-1 gap-4 ${userRole === 'cp' ? 'md:grid-cols-2' : 'md:grid-cols-3'
                }`}
            >
              {/* CP Filter - Hidden for CP users */}
              {userRole !== 'cp' && (
                <div>
                  <label
                    htmlFor="cpFilter"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    CP Name
                  </label>
                  <CustomDropdown
                    options={[
                      { value: 'ALL', label: 'ALL' },
                      ...(cpList?.map((cp: any) => ({
                        value: cp.cpid,
                        label: cp.cpName || cp.cpid,
                      })) || []),
                    ]}
                    value={selectedCp}
                    onChange={handleCpChange}
                    placeholder="Select CP"
                    searchPlaceholder="Search CP..."
                  />
                </div>
              )}

              {/* Service ID Filter */}
              <div>
                <label
                  htmlFor="serviceFilter"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Service ID
                </label>
                <CustomDropdown
                  options={[
                    { value: 'ALL', label: '(ALL)' },
                    ...(getFilteredServices()?.map((service: any) => ({
                      value: service.serviceId,
                      label:
                        service.serviceId && service.serviceIdName
                          ? `${service.serviceId} (${service.serviceIdName})`
                          : service.serviceId || '',
                    })) || []),
                  ]}
                  value={selectedServiceId}
                  onChange={handleServiceIdChange}
                  placeholder="Select Service"
                  searchPlaceholder="Search Service..."
                  disabled={userRole !== 'cp' && (!selectedCp || selectedCp === 'ALL')}
                />
              </div>

              {/* Subscription Filter */}
              <div>
                <label
                  htmlFor="subscriptionFilter"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Subscription Name
                </label>
                <CustomDropdown
                  options={[
                    { value: 'ALL', label: 'All Subscriptions' },
                    ...(getFilteredSubscriptions()?.map((product: any) => ({
                      value: product.subscriptionDescription,
                      label: product.subscriptionDescription,
                    })) || []),
                  ]}
                  value={selectedSubscription}
                  onChange={setSelectedSubscription}
                  placeholder="Select Subscription"
                  searchPlaceholder="Search Subscription..."
                  disabled={!selectedServiceId || selectedServiceId === 'ALL'}
                />
              </div>
            </div>
          </div>

          <TabsContent value="summary" forceMount>
            <SummaryTab
              data={currentData}
              startDate={startDate}
              endDate={endDate}
              isLoading={isSubmitting || fetcher.state === 'submitting'}
              selectedCp={userRole === 'cp' ? userCpid : selectedCp}
              selectedServiceId={selectedServiceId}
              selectedSubscription={selectedSubscription}
              serviceIdList={serviceIdList}
            />
          </TabsContent>
          <TabsContent value="bot_traffic" forceMount>
            <BotAnalysisTab
              data={currentData}
              startDate={startDate}
              endDate={endDate}
              isLoading={isSubmitting || fetcher.state === 'submitting'}
              selectedCp={userRole === 'cp' ? userCpid : selectedCp}
              selectedServiceId={selectedServiceId}
              selectedSubscription={selectedSubscription}
              top5BlockedServicesData={top5BlockedServicesData}
              top5BlockedCPData={top5BlockedCPData}
              cpList={cpList}
              serviceList={serviceIdList}
              productList={productList}
              top5BlockedTrafficSourceData={top5BlockedTrafficSourceData}
            />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
