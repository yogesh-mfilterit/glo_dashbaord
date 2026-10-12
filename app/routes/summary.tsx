import { useEffect, useState } from "react";
import { Calendar } from "../components/ui/calendar";
import { addDays, format } from "date-fns";
import { json, redirect, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { getSession } from "../lib/session.server";
import Layout from "../components/layout";
import { DYNAMODB_TABLES } from "../lib/config";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getAllCPs } from "../lib/dynamodb-cp";
import { getAllServiceIds } from "../lib/dynamodb-serviceid";
import { getAllProducts } from "../lib/dynamodb-products";
import React from "react";
import { Button } from "../components/ui/button";
import { useFetcher } from "@remix-run/react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { SummaryTab } from "../components/SummaryTab";
import { BotAnalysisTab } from "../components/BotAnalysisTab";
import mysqlService from "../lib/mysql.server";
import { executeAllQueries } from "../lib/mysql-queries";
import { Skeleton } from "../components/ui/skeleton";
import { Progress } from "../components/ui/progress";
import { useLoading } from "../components/LoadingProvider";
import { fullAuthGuard } from "~/util/authGuard";


// Caching disabled - removed localStorage utilities

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }
  const userRole = session.get("role") || null;

  const userCpid = session.get("cpid") || null; // ✅ ADDED: Get CP ID from session if role is cp

  console.log("[DEBUG] User role:", userRole);

  // Parse start/end from query params
  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const cpParam = url.searchParams.get("cp"); // Get CP filter from URL
  const service_id = url.searchParams.get("service_id");
  const subscription_desc = url.searchParams.get("subscription_desc");

  console.log("[DEBUG] URL start param:", startParam);
  console.log("[DEBUG] URL end param:", endParam);
  console.log("[DEBUG] URL cp param:", cpParam);

  // Get selected CP from URL params
  const selectedCp = url.searchParams.get("selectedcp");
  console.log("[DEBUG] Selected CP from URL:", selectedCp);

  function parseDateInNigeriaTimezone(dateString: string): Date {
    const [year, month, day] = dateString.split('-').map(Number);
    const nigeriaDateString = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T00:00:00+01:00`;
    return new Date(nigeriaDateString);
  }

  let startDate = startParam ? parseDateInNigeriaTimezone(startParam) : addDays(new Date(), -6);
  let endDate = endParam ? parseDateInNigeriaTimezone(endParam) : new Date();

  console.log("[DEBUG] Parsed startDate:", startDate);
  console.log("[DEBUG] Parsed endDate:", endDate);
  console.log("[DEBUG] startDate ISO string:", startDate.toISOString());
  console.log("[DEBUG] endDate ISO string:", endDate.toISOString());
  console.log("[DEBUG] startDate Nigeria time:", startDate.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
  console.log("[DEBUG] endDate Nigeria time:", endDate.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));

  const [cpList, serviceIdList, productList] = await Promise.all([
    getAllCPs(),
    getAllServiceIds(),
    getAllProducts(),
  ]);

  const filters_available = session.get("viewFilters")
  let filteredServiceIdList :any = []
  if (filters_available){
    filteredServiceIdList = serviceIdList.filter((item) => filters_available.includes(item.serviceId))
  }

 

  let summaryData: any[] = [];
  let botStatusData: any[] = [];
  let SDPSuccessData: any[] = [];
  let SubscriptionFlowData: any[] = [];
  let SDPErrorDistributionData: any[] = [];
  let top5BlockedTrafficSourceData: any[] = [];
  let top5BlockedServicesData: any[] = [];
  let top5BlockedCPData: any[] = [];
  let botReasonData: any[] = [];

  const dateList = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (startDate.getTime() === endDate.getTime()) {
    const dateStr = startDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }).replace(/-/g, '');
    dateList.push(dateStr);
    console.log("[DEBUG] Single day selected, added date:", dateStr);
  } else {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }).replace(/-/g, '');
      dateList.push(dateStr);
      console.log("[DEBUG] Added date to list:", dateStr);
    }
  }

  console.log("[DEBUG] Final dateList:", dateList);



  

  // Fix: Use timezone-aware date formatting instead of toISOString()
  const startDateStr = startDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  const endDateStr = endDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

  console.log("[DEBUG] MySQL startDateStr:", startDateStr);
  console.log("[DEBUG] MySQL endDateStr:", endDateStr);

  // ✅ Add this logic to determine which CP to use in MySQL queries
  let finalCpParam: string | undefined = undefined;
  if (userRole === "cp") {
    finalCpParam = userCpid || undefined;
  } else if (cpParam && cpParam !== "ALL") {
    finalCpParam = cpParam;
  }

  try {
    console.log("[DEBUG] Fetching MySQL data for date range:", startDateStr, "to", endDateStr);

    const mysqlResults = await executeAllQueries(mysqlService, {
      startDateStr,
      endDateStr,
      cpParam: finalCpParam, // ✅ use final param based on role
      serviceIdParam: service_id ? service_id : filters_available ? filters_available[0] : undefined,
      subDescParam: subscription_desc || undefined,
    });

    botStatusData = mysqlResults.botStatusData;
    SDPSuccessData = mysqlResults.SDPSuccessData;
    SubscriptionFlowData = mysqlResults.SubscriptionFlowData;
    SDPErrorDistributionData = mysqlResults.SDPErrorDistributionData;
    top5BlockedTrafficSourceData = mysqlResults.top5BlockedTrafficSourceData;
    top5BlockedServicesData = mysqlResults.top5BotServicesData;
    top5BlockedCPData = mysqlResults.top5BlockedCPData;
    botReasonData = mysqlResults.botReasonData;
  } catch (error) {
    console.error("[DEBUG] Error in MySQL queries execution:", error);
    botStatusData = [];
    SDPSuccessData = [];
    SubscriptionFlowData = [];
  }

  return json({
    userRole,
    userEmail: session.get("email") || null,
    summaryData,
    botStatusData,
    SDPSuccessData,
    SubscriptionFlowData,
    SDPErrorDistributionData,
    top5BlockedTrafficSourceData,
    top5BlockedServicesData,
    top5BlockedCPData,
    botReasonData,
    defaultStart: format(startDate, "yyyy-MM-dd"),
    defaultEnd: format(endDate, "yyyy-MM-dd"),
    cpList: userRole === "admin" ? cpList : [], // ✅ Show only for admin
    serviceIdList: filters_available ? filteredServiceIdList : serviceIdList,
    productList,
    userCpid
  });
}


export default function Summary() {
  const loaderData = useLoaderData<typeof loader>();
  const { userRole, userEmail, summaryData: initialSummaryData, SDPErrorDistributionData: initialSDPErrorDistributionData, botStatusData: initialBotStatusData, SDPSuccessData: initialSDPSuccessData, SubscriptionFlowData: initialSubscriptionFlowData, top5BlockedTrafficSourceData: initialTop5BlockedTrafficSourceData, top5BlockedServicesData: initialTop5BlockedServicesData, top5BlockedCPData: initialTop5BlockedCPData, botReasonData: initialBotReasonData, defaultStart, defaultEnd, cpList, serviceIdList, productList, userCpid } = loaderData;
  const fetcher = useFetcher<typeof loader>();
  const navigation = useNavigation();
  const { isGlobalLoading, hideSummaryLoading } = useLoading();
  
  // LocalStorage cache keys and TTL (5 minutes)
  // const getSummaryCacheKey = (startDate: string, endDate: string) => `summary_data_cache_${startDate}_${endDate}`;
  // const DROPDOWN_CACHE_KEY = 'dropdown_data_cache';
  // const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
  
  // Caching disabled - removed cached state variables
  // Load cached data from localStorage on client side
  // React.useEffect(() => {
  //   const currentStartDate = fetcher.data?.defaultStart || defaultStart;
  //   const currentEndDate = fetcher.data?.defaultEnd || defaultEnd;
  //   const cacheKey = getSummaryCacheKey(currentStartDate, currentEndDate);
    
  //   const cachedSummary = getWithExpiry(cacheKey);
  //   if (cachedSummary) {
  //     setCachedSummaryData(cachedSummary);
  //   }
    
  //   const cachedDropdown = getWithExpiry(DROPDOWN_CACHE_KEY);
  //   if (cachedDropdown) {
  //     setCachedDropdownData(cachedDropdown);
  //   }
  // }, [fetcher.data?.defaultStart, fetcher.data?.defaultEnd, defaultStart, defaultEnd]);
  
  // Use fetcher.data if available, otherwise use cached data
  const summaryData = fetcher.data?.summaryData ?? initialSummaryData;
  const botStatusData = fetcher.data?.botStatusData ?? initialBotStatusData;
  const SDPSuccessData = fetcher.data?.SDPSuccessData ?? initialSDPSuccessData;
  const SubscriptionFlowData = fetcher.data?.SubscriptionFlowData ?? initialSubscriptionFlowData;
  const SDPErrorDistributionData = fetcher.data?.SDPErrorDistributionData ?? initialSDPErrorDistributionData;
  const top5BlockedTrafficSourceData = fetcher.data?.top5BlockedTrafficSourceData ?? initialTop5BlockedTrafficSourceData;
  const top5BlockedServicesData = fetcher.data?.top5BlockedServicesData ?? initialTop5BlockedServicesData;
  const top5BlockedCPData = fetcher.data?.top5BlockedCPData ?? initialTop5BlockedCPData;
  const botReasonData = fetcher.data?.botReasonData ?? initialBotReasonData;
  // Debug: Log which data source is being used
  console.log("[DEBUG] Using fetcher data:", !!fetcher.data?.summaryData);
  console.log("[DEBUG] Using cached data:", !fetcher.data?.summaryData && !!initialSummaryData);
  console.log("[DEBUG] Summary data length:", summaryData.length);
  console.log("[DEBUG] Summary data dbDates:", [...new Set(summaryData.map((item: any) => item.dbDate))].sort());
  console.log("[DEBUG] Bot status data:", botStatusData);
  console.log("[DEBUG] SDP success and failure data:", SDPSuccessData);
  console.log("[DEBUG] Subscription flow data:", SubscriptionFlowData);
  console.log("[DEBUG] SDP error distribution data:", SDPErrorDistributionData);
  console.log("[DEBUG] SDP error distribution data length:", SDPErrorDistributionData.length);
    console.log("[DEBUG] Top 5 blocked traffic source data:", top5BlockedTrafficSourceData);
  console.log("[DEBUG] Top 5 blocked traffic source data length:", top5BlockedTrafficSourceData.length);
  console.log("[DEBUG] Top 5 blocked services data:", top5BlockedServicesData);
  console.log("[DEBUG] Top 5 blocked services data length:", top5BlockedServicesData.length);
  console.log("[DEBUG] Top 5 blocked CP data:", top5BlockedCPData);
  console.log("[DEBUG] Top 5 blocked CP data length:", top5BlockedCPData.length);
  console.log("[DEBUG] Bot reason data:", botReasonData);
  console.log("[DEBUG] Bot reason data length:", botReasonData.length);
  // Use dropdown data directly (no caching)
  const dropdownData = { cpList, serviceIdList, productList };
  
  // Cache summary data whenever it changes (from fetcher or initial load)
  // React.useEffect(() => {
  //   if (fetcher.data?.summaryData) {
  //     const cacheData = {
  //       data: fetcher.data.summaryData,
  //       startDate: fetcher.data.defaultStart,
  //       endDate: fetcher.data.defaultEnd,
  //       timestamp: Date.now()
  //     };
  //     const cacheKey = getSummaryCacheKey(fetcher.data.defaultStart, fetcher.data.defaultEnd);
  //     setWithExpiry(cacheKey, cacheData, CACHE_TTL);
  //     setCachedSummaryData(cacheData);
  //   } else if (initialSummaryData && initialSummaryData.length > 0) {
  //     const cacheData = {
  //       data: initialSummaryData,
  //       startDate: defaultStart,
  //       endDate: defaultEnd,
  //       timestamp: Date.now()
  //     };
  //     const cacheKey = getSummaryCacheKey(defaultStart, defaultEnd);
  //     setWithExpiry(cacheKey, cacheData, CACHE_TTL);
  //     setCachedSummaryData(cacheData);
  //   }
  // }, [fetcher.data?.summaryData, initialSummaryData, defaultStart, defaultEnd]);

  // Cache dropdown data whenever it changes
  // React.useEffect(() => {
  //   if (cpList && serviceIdList && productList) {
  //     const cacheData = {
  //       cpList,
  //       serviceIdList,
  //       productList,
  //       timestamp: Date.now()
  //     };
  //     setWithExpiry(DROPDOWN_CACHE_KEY, cacheData, CACHE_TTL);
  //     setCachedDropdownData(cacheData);
  //   }
  // }, [cpList, serviceIdList, productList]);

  // Clear filters when dates change
  // React.useEffect(() => {
  //   if (isFiltered) {
  //     handleClearFilter();
  //   }
  // }, [fetcher.data?.defaultStart, fetcher.data?.defaultEnd]);

  // Initialize dates from URL params or defaults - FIX: Don't recalculate based on data
  // The previous logic was recalculating dates based on the actual data returned from DynamoDB,
  // which caused the selected dates to shift. Now we respect the user's selected date range.
  const [startDate, setStartDate] = useState(() => {
    // Use fetcher data if available (from URL params), otherwise use defaults
    if (fetcher.data?.defaultStart) {
      return new Date(fetcher.data.defaultStart);
    }
    return new Date(defaultStart);
  });
  
  const [endDate, setEndDate] = useState(() => {
    // Use fetcher data if available (from URL params), otherwise use defaults
    if (fetcher.data?.defaultEnd) {
      return new Date(fetcher.data.defaultEnd);
    }
    return new Date(defaultEnd);
  });
  
  // Summary tab dropdown state with cascading filters
  const [selectedCp, setSelectedCp] = React.useState("ALL");
  const [selectedServiceId, setSelectedServiceId] = React.useState("ALL");
  const [selectedSubDesc, setSelectedSubDesc] = React.useState("ALL");
  
  // Bot analysis tab dropdown state
  const [botSelectedCp, setBotSelectedCp] = React.useState("ALL");
  const [botSelectedServiceId, setBotSelectedServiceId] = React.useState("ALL");
  
  // Filter state
  const [isFiltered, setIsFiltered] = React.useState(false);
  const [filteredData, setFilteredData] = React.useState<any[]>([]);
  
  // Bot analysis filter state
  const [isBotFiltered, setIsBotFiltered] = React.useState(false);
  const [botFilteredData, setBotFilteredData] = React.useState<any[]>([]);
  
  // Active tab state
  const [activeTab, setActiveTab] = React.useState("summary");
  
  // Use filtered data if filter is applied, otherwise use full data
  const dataForCharts = isFiltered ? filteredData : summaryData;
  
  // Use bot filtered data if bot filter is applied, otherwise use full data
  const botDataForCharts = isBotFiltered ? botFilteredData : summaryData;
  
  // Debug: Log filtered data info
  console.log("[DEBUG] Using filtered data:", isFiltered);
  console.log("[DEBUG] Filtered data length:", filteredData.length);
  console.log("[DEBUG] Data for charts length:", dataForCharts.length);
  console.log("[DEBUG] Using bot filtered data:", isBotFiltered);
  console.log("[DEBUG] Bot filtered data length:", botFilteredData.length);
  console.log("[DEBUG] Bot data for charts length:", botDataForCharts.length);
  
  // Error state for date validation
  const [dateError, setDateError] = React.useState<string | null>(null);

  // Date validation function
  const validateDates = (start: Date, end: Date): boolean => {
    if (start > end) {
      setDateError("Start date must be earlier than or equal to end date");
      return false;
    }
    setDateError(null);
    return true;
  };


  const [isSDPSuccessFiltered, setIsSDPSuccessFiltered] = React.useState(false);
  const [botstatusFilteredData, setbotStatusFilteredData] = React.useState<any[]>([]);
  const [SubscriptionFlowFilteredData, setSubscriptionFlowFilteredData] = React.useState<any[]>([]);
  const [SDPSuccessFilteredData, setSDPSuccessFilteredData] = React.useState<any[]>([]);

  const masterFilter = (selectedCp:any, selectedServiceId:any, selectedSubDesc:any, data: any) => {
  
    const filtered = data.filter((item: any) => {
      // Filter by serviceId if available
      if (item.cpId && selectedCp !== "ALL" && item.cpId !== selectedCp) {
        return false;
      }

      if (item.serviceId && selectedServiceId !== "ALL" && item.serviceId !== selectedServiceId) {
        return false;
      }

      // Filter by subscriptionDescription if available
      if (item.subscriptionDescription && selectedSubDesc !== "ALL" && item.subscriptionDescription !== selectedSubDesc) {
        return false;
      }

      return true;
    });

    return filtered
  }


  const [isLoading, setIsLoading] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isDataReady, setIsDataReady] = useState(false)

  useEffect(() => {
    if (fetcher.state == "loading"){
      setIsLoading(true)
    } else {
      setIsLoading(false)
    }
  },[fetcher.state])

  // Check if data is ready
  useEffect(() => {
    if (botStatusData && botStatusData.length > 0 && SDPSuccessData && SDPSuccessData.length > 0) {
      setIsDataReady(true)
    }
  }, [botStatusData, SDPSuccessData])

  // Set initial loading to false after component mounts and data is processed
  useEffect(() => {
    // Show loader for at least 1.5 seconds to ensure users see it
    const timer = setTimeout(() => {
      if (isDataReady) {
        setIsInitialLoading(false)
        // Also hide the global loading state
        hideSummaryLoading()
      }
    }, 1500)

    // Fallback: hide loader after 3 seconds even if data isn't ready
    const fallbackTimer = setTimeout(() => {
      setIsInitialLoading(false)
      hideSummaryLoading()
    }, 3000)

    return () => {
      clearTimeout(timer)
      clearTimeout(fallbackTimer)
    }
  }, [isDataReady, hideSummaryLoading])

  // Also check navigation state for page transitions
  const isNavigating = navigation.state === "loading"
  const shouldShowLoader = isInitialLoading || isNavigating || isGlobalLoading

  // Debug logging for loading states
  console.log("[DEBUG] Loading states:", {
    isInitialLoading,
    isNavigating,
    shouldShowLoader,
    isGlobalLoading,
    isDataReady,
    botStatusDataLength: botStatusData?.length || 0,
    SDPSuccessDataLength: SDPSuccessData?.length || 0,
    navigationState: navigation.state
  })

  // Log when loading state changes
  useEffect(() => {
    console.log("[DEBUG] Loading state changed:", {
      isInitialLoading,
      isGlobalLoading,
      shouldShowLoader,
      timestamp: new Date().toISOString()
    })
  }, [isInitialLoading, isGlobalLoading, shouldShowLoader])

  // Summary tab filter function
  const handleFilter = () => {
    // ✅ Use Nigerian timezone for date formatting
    const currentStartDate = startDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    const currentEndDate = endDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    
    fetcher.load(`/summary?start=${currentStartDate}&end=${currentEndDate}&cp=${selectedCp}&service_id=${selectedServiceId}&subscription_desc=${selectedSubDesc}`)
    
    console.log("[DEBUG] Filter applied with Nigerian dates:", { currentStartDate, currentEndDate, selectedCp, selectedServiceId, selectedSubDesc });
  };
  
  // Bot analysis tab filter function
  const handleBotFilter = () => {

    console.log("TEST handleBotFilter");
    // For bot analysis tab: check CP and service ID
    if (botSelectedCp === "ALL" || botSelectedServiceId === "ALL") {
      return; // Don't filter if ALL is selected
    }
    
    const filtered = summaryData.filter((item: any) => {
      // Filter by CP ID
      if (item.cpId && item.cpId !== botSelectedCp) {
        return false;
      }
      
      // Filter by serviceId if available
      if (item.serviceId && item.serviceId !== botSelectedServiceId) {
        return false;
      }
      
      return true;
    });
    
    setBotFilteredData(filtered);
    setIsBotFiltered(true);
    console.log("[DEBUG] Bot analysis filter applied:", { botSelectedCp, botSelectedServiceId, filteredCount: filtered.length });
  };
  
  // Clear filter function
  const handleClearFilter = () => {
    setFilteredData([]);
    setIsFiltered(false);
    setSelectedCp("ALL");
    setSelectedServiceId("ALL");
    setSelectedSubDesc("ALL");
    console.log("[DEBUG] Summary filter cleared");
  };
  
  // Bot analysis clear filter function
  const handleBotClearFilter = () => {
    setBotFilteredData([]);
    setIsBotFiltered(false);
    setBotSelectedCp("ALL");
    setBotSelectedServiceId("ALL");
    console.log("[DEBUG] Bot analysis filter cleared");
  };
  
  // Clear cache function (useful for debugging or manual refresh)
  // const clearCache = () => {
  //   // Clear all summary cache entries by removing keys that start with 'summary_data_cache_'
  //   Object.keys(localStorage).forEach(key => {
  //     if (key.startsWith('summary_data_cache_')) {
  //       localStorage.removeItem(key);
  //     }
  //   });
  //   localStorage.removeItem(DROPDOWN_CACHE_KEY);
  //   setCachedSummaryData({ data: [], startDate: defaultStart, endDate: defaultEnd, timestamp: Date.now() });
  //   setCachedDropdownData({ cpList: [], serviceIdList: [], productList: [], timestamp: Date.now() });
  // };





  // Reset dependent dropdowns when parent selection changes
  React.useEffect(() => {
    console.log("Resetting service ID and subscription description");
    setSelectedServiceId("ALL");
    setSelectedSubDesc("ALL");
  }, [selectedCp]);

  React.useEffect(() => {
    setSelectedSubDesc("ALL");
  }, [selectedServiceId]);
  
  // Bot analysis: Reset dependent dropdowns when parent selection changes
  React.useEffect(() => {
    setBotSelectedServiceId("ALL");
  }, [botSelectedCp]);



  return (
    <Layout userRole={userRole} userEmail={userEmail}>
      {/* Loading Indicator */}
      {shouldShowLoader && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-600 to-blue-800 text-white p-3 text-center shadow-lg">
          <div className="flex items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
            <div className="flex flex-col items-center">
              <span className="font-semibold text-lg">Loading Summary Dashboard</span>
              <span className="text-sm text-blue-100">Please wait while we prepare your data...</span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-2 w-full bg-blue-700 rounded-full h-2">
            <div className="bg-white h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
          </div>
        </div>
      )}



      {/* Tabs + Date Filter in One Row */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-4">
        {/* Tabs */}
        <Tabs defaultValue="summary" className="w-full md:w-auto" onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger
              value="summary"
              className="data-[state=active]:bg-blue-500 data-[state=active]:text-white"
            >
              Summary
            </TabsTrigger>
            <TabsTrigger
              value="cpwise"
              className="data-[state=active]:bg-blue-500 data-[state=active]:text-white"
            >
              Bot Analysis
            </TabsTrigger>
          </TabsList>
        </Tabs>
  
        {/* Date Range and GO Button */}
        <fetcher.Form
  method="get"
  className="flex gap-4 items-end"
  onSubmit={(e) => {
    if (!validateDates(startDate, endDate)) {
      e.preventDefault();
      return false;
    }
  }}
>
  {/* Start Date */}
  <div className="flex items-center gap-2">
    <label className="text-sm font-medium whitespace-nowrap">Start Date</label>
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[200px] justify-start text-left font-normal",
            !startDate && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {startDate ? format(startDate, "PPP") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={startDate}
          onSelect={(date) => {
            if (date) {
              setStartDate(date);
              setDateError(null);
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
    <input type="hidden" name="start" value={startDate.toISOString().slice(0, 10)} />
  </div>

  {/* End Date */}
  <div className="flex items-center gap-2">
    <label className="text-sm font-medium whitespace-nowrap">End Date</label>
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[200px] justify-start text-left font-normal",
            !endDate && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {endDate ? format(endDate, "PPP") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={endDate}
          onSelect={(date) => {
            if (date) {
              setEndDate(date);
              setDateError(null);
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
    <input type="hidden" name="end" value={endDate.toISOString().slice(0, 10)} />
  </div>

  <div className="flex items-end h-full">
    <Button type="submit" disabled={fetcher.state === "submitting"} className="ml-2">
      {fetcher.state === "submitting" ? "Loading..." : "GO"}
    </Button>
  </div>
</fetcher.Form>

      </div>
  
      {/* Error Message */}
      {dateError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md mb-6">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-sm text-red-800">{dateError}</div>
        </div>
      )}
  
      {/* Tabs Content */}
      {shouldShowLoader ? (
        <div className="space-y-6">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-blue-600">
              <span>Loading summary dashboard...</span>
              <span className="font-medium">Please wait</span>
            </div>
            <Progress value={60} className="h-2" />
          </div>
          
          {/* Skeleton tabs */}
          <div className="flex space-x-2 mb-6">
            {[...Array(2)].map((_, index) => (
              <Skeleton key={index} className="h-10 w-24" />
            ))}
          </div>
          
          {/* Skeleton cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 lg:grid-cols-5 gap-2">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="bg-white p-2 rounded-lg shadow border">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16 mx-auto" />
              </div>
            ))}
          </div>
          
          {/* Skeleton charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="bg-white p-4 rounded-lg shadow border">
                <Skeleton className="h-6 w-32 mb-4" />
                <Skeleton className="h-48 w-full" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          
          <TabsContent value="summary">
            <SummaryTab
              startDate={startDate}
              endDate={endDate}
              summaryData={[]}
              botStatusData={botStatusData}
              SDPSuccessData={SDPSuccessData}
              SubscriptionFlowData={SubscriptionFlowData}
              SDPErrorDistributionData={SDPErrorDistributionData}
              dropdownData={dropdownData}
              cachedSummaryData={{ timestamp: Date.now() }}
              onFilter={handleFilter}
              onClearFilter={handleClearFilter}
              isFiltered={isSDPSuccessFiltered}
              selectedCp={selectedCp}
              setSelectedCp={setSelectedCp}
              selectedServiceId={selectedServiceId}
              setSelectedServiceId={setSelectedServiceId}
              selectedSubDesc={selectedSubDesc}
              setSelectedSubDesc={setSelectedSubDesc}
              filteredData={SDPSuccessFilteredData}
              isLoading={isLoading}
              userRole={userRole}
              userCpid={userCpid}
            />
          </TabsContent>
    
          <TabsContent value="cpwise">
            <BotAnalysisTab
              startDate={startDate}
              endDate={endDate}
              botStatusData={botStatusData}
              summaryData={summaryData}
              dropdownData={dropdownData}
              cachedSummaryData={{ timestamp: Date.now() }}
              onFilter={handleFilter}
              onClearFilter={handleClearFilter}
              isFiltered={isBotFiltered}
              selectedCp={selectedCp}
              setSelectedCp={setSelectedCp}
              selectedServiceId={selectedServiceId}
              setSelectedServiceId={setSelectedServiceId}
              selectedSubDesc={selectedSubDesc}
              setSelectedSubDesc={setSelectedSubDesc}
              filteredData={botFilteredData}
              top5BlockedTrafficSourceData={top5BlockedTrafficSourceData}
              top5BlockedServicesData={top5BlockedServicesData}
              top5BlockedCPData={top5BlockedCPData}
              botReasonData={botReasonData}
              isLoading={isLoading}
              userCpid={userCpid}
              userRole={userRole}
            />
          </TabsContent>
        </Tabs>
      )}
    </Layout>
  );
  
} 