import React from "react";
import { format } from "date-fns";
import { Button } from "./ui/button";
import { SearchableSelect } from "./ui/searchable-select";
import { CG2ClickedChart } from "./ui/CG2ClickedChart";
import { BotEventsChart } from "./ui/BotEventsChart";
import { cn } from "../lib/utils";
import { Top5TrafficSourceChart } from "./ui/blockedTrafficSources";
import { Top5BotServicesChart } from "./ui/blockedServicesSources";
import { Top5BlockedCPChart } from "./ui/Top5BlockedCPChart";
import LineChartComponent from "./ui/TotalTraffic";
import PieChartComponent from "./ui/PieCharts";
import { Spinner } from "./ui/Spinner";
import { TotalTrafficNewChart } from "./ui/totalTrafficChartNew";
import { Skeleton } from "./ui/skeleton";
import { Progress } from "./ui/progress";

interface BotAnalysisTabProps {
  startDate: Date;
  endDate: Date;
  summaryData: any[];
  dropdownData: {
    cpList: any[];
    serviceIdList: any[];
    productList: any[];
  };
  cachedSummaryData: {
    timestamp: number;
  };
  onFilter: () => void;
  onClearFilter: () => void;
  isFiltered: boolean;
  selectedCp: string;
  setSelectedCp: (value: string) => void;
  selectedServiceId: string;
  setSelectedServiceId: (value: string) => void;
  selectedSubDesc: string,
  setSelectedSubDesc: (value: string) => void;
  filteredData: any[];
  top5BlockedTrafficSourceData: any[];
  top5BlockedServicesData: any[];
  top5BlockedCPData: any[];
  botStatusData: any[];
  botReasonData: any[];
  isLoading: any
  userRole: string;
  userCpid: string;
}

export function BotAnalysisTab({
  startDate,
  endDate,
  summaryData,
  dropdownData,
  cachedSummaryData,
  onFilter,
  onClearFilter,
  isFiltered,
  selectedCp,
  setSelectedCp,
  selectedServiceId,
  setSelectedServiceId,
  selectedSubDesc,
  setSelectedSubDesc,
  filteredData,
  top5BlockedTrafficSourceData,
  top5BlockedServicesData,
  top5BlockedCPData,
  botStatusData,
  botReasonData,
  isLoading,
  userRole,
  userCpid
}: BotAnalysisTabProps) {
  // Use filtered data if filter is applied, otherwise use full data
  const dataForCharts = isFiltered ? filteredData : summaryData;

  // Bot analysis dropdown options
  const cpOptions = React.useMemo(() => {
    return [
      { value: "ALL", label: "ALL" },
      ...dropdownData.cpList.map((cp: any) => ({
        value: cp.cpid,
        label: cp.cpName
      }))
    ];
  }, [dropdownData.cpList]);

  const serviceIdOptions = React.useMemo(() => {
    if (userRole === "cp") {
      const filteredServiceIds = dropdownData.serviceIdList.filter((sid: any) => sid.cpId === userCpid);
      return filteredServiceIds.map((sid: any) => ({
        value: sid.serviceId,
        label: sid.serviceIdName
      }));
    } else if (selectedCp === "ALL") {
      return [
        { value: "ALL", label: "" },
        ...dropdownData.serviceIdList.map((sid: any) => ({
          value: sid.serviceId,
          label: sid.serviceIdName
        }))
      ];
    } else {
      const filteredServiceIds = dropdownData.serviceIdList.filter((sid: any) => sid.cpId === selectedCp);
      return [
        { value: "ALL", label: "" },
        ...filteredServiceIds.map((sid: any) => ({
          value: sid.serviceId,
          label: sid.serviceIdName
        }))
      ];
    }
  }, [dropdownData.serviceIdList, selectedCp, userRole, userCpid]);

  const subDescOptions = React.useMemo(() => {
    if (selectedServiceId === "ALL") {
      return [
        { value: "ALL", label: "ALL" },
        ...dropdownData.productList.map((prod: any) => ({
          value: prod.subscriptionDescription,
          label: prod.subscriptionDescription
        }))
      ];
    } else {
      const filteredProducts = dropdownData.productList.filter((prod: any) => prod.serviceId === selectedServiceId);
      return [
        { value: "ALL", label: "ALL" },
        ...filteredProducts.map((prod: any) => ({
          value: prod.subscriptionDescription,
          label: prod.subscriptionDescription
        }))
      ];
    }
  }, [dropdownData.productList, selectedServiceId]);


  // Bot Analysis Chart Data
  const cg2ClickedData = React.useMemo(() => {
    const cg2ClickedItems = dataForCharts.filter((item: any) =>
      item.counterKey === 'cg2Clicked'
    );

    const result: Record<string, number> = {};
    for (const item of cg2ClickedItems) {
      const { dbDate, counterValue } = item;
      if (!dbDate) continue;
      result[dbDate] = (result[dbDate] || 0) + (typeof counterValue === 'number' ? counterValue : Number(counterValue) || 0);
    }

    const allDates = [...new Set(summaryData.map(item => item.dbDate))].sort();
    return allDates.map(dbDate => ({
      dbDate,
      total: result[dbDate] || 0
    }));
  }, [dataForCharts, summaryData]);
  console.log("dropdownData:", dropdownData);
  console.log("cpList:", dropdownData.cpList);

  const botEventsData = React.useMemo(() => {
    const botItems = dataForCharts.filter((item: any) =>
      item.counterKey === 'BOT'
    );

    // Also check for any items that might still have the original BOT#serviceId pattern
    const originalBotItems = dataForCharts.filter((item: any) =>
      item.counterKey && item.counterKey.startsWith('BOT#')
    );

    // Combine both filtered items
    const allBotItems = [...botItems, ...originalBotItems];

    const result: Record<string, number> = {};
    for (const item of allBotItems) {
      const { dbDate, counterValue } = item;
      if (!dbDate) continue;
      result[dbDate] = (result[dbDate] || 0) + (typeof counterValue === 'number' ? counterValue : Number(counterValue) || 0);
    }

    const allDates = [...new Set(summaryData.map(item => item.dbDate))].sort();
    return allDates.map(dbDate => ({
      dbDate,
      total: result[dbDate] || 0
    }));
  }, [dataForCharts, summaryData]);

  const formatCompact = (num: number) =>
    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(num);


  return (
    <div>


      {/* Bot Analysis Filter Status */}
      {isFiltered && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md mb-4">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="text-sm text-blue-800">
            Filtered by: CP: <strong>{selectedCp}</strong>, Service ID: <strong>{selectedServiceId}</strong>
          </div>
        </div>
      )}

      {/* Bot Analysis Searchable Dropdowns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {userRole === "admin" && (
          <div className="flex flex-col space-y-2">
            <label className="text-sm font-medium">CP Name</label>
            <SearchableSelect
              options={cpOptions}
              value={selectedCp}
              onValueChange={setSelectedCp}
              placeholder="Select CP Name..."
              searchPlaceholder="Search CP..."
              className="h-8 text-sm"
            />
          </div>
        )}
        <div className="flex flex-col space-y-2">
          <label className="text-sm font-medium">Service ID</label>
          <SearchableSelect
              options={serviceIdOptions.map(opt => ({
              ...opt,
              label: `${opt.label} (${opt.value})` // label ko modify kiya
            }))}
            value={selectedServiceId}
            onValueChange={setSelectedServiceId}
            placeholder="Select Service ID..."
            searchPlaceholder="Search Service ID..."
            disabled={userRole === "admin" && selectedCp === "ALL"}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex flex-col space-y-2">
          <label className="text-sm font-medium">Service ID</label>
          <div className="flex space-x-2">
            <SearchableSelect
              options={subDescOptions}
              value={selectedSubDesc}
              onValueChange={setSelectedSubDesc}
              placeholder="Select Subscription..."
              searchPlaceholder="Search Subscription..."
              disabled={selectedServiceId === "ALL"}
              className="h-8 text-sm flex-1"
            />


            <Button
              onClick={onFilter}
              className={cn(
                "h-8 px-3 text-sm",
                "bg-blue-600 hover:bg-blue-700 text-white"
              )}
            >
              Filter
            </Button>
            {isFiltered && (
              <Button
                onClick={onClearFilter}
                className="h-8 px-3 text-sm bg-red-600 hover:bg-red-700 text-white"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>


      {isLoading && (
        <div className="space-y-6">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-blue-600">
              <span>Loading bot analysis data...</span>
              <span className="font-medium">Please wait</span>
            </div>
            <Progress value={75} className="h-2" />
          </div>
          
          {/* Skeleton cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="bg-white p-2 rounded-lg shadow border">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16 mx-auto" />
              </div>
            ))}
          </div>
          
          {/* Skeleton charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="bg-white p-4 rounded-lg shadow border">
                <Skeleton className="h-6 w-32 mb-4" />
                <Skeleton className="h-48 w-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 ">
            {/* Total Traffic Card */}
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-blue-500">Total Traffic</div>
              <div className="mt-2 text-xl font-bold text-blue-500">
                {formatCompact(botStatusData?.reduce((sum, item) => sum + (item.totalTraffic || 0), 0) || 0)}
              </div>
            </div>
          <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-purple-800">CTA1</div>
              <div className="mt-2 text-xl font-bold text-purple-800">
                {formatCompact(botStatusData?.reduce((sum, item) => sum + (item.cg1ClickedCount || 0), 0) || 0)}
              </div>
            </div>


            {/* Clean Traffic Card */}
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-green-500">Clean Traffic</div>
              <div className="mt-2 text-xl font-bold text-green-500">
                {formatCompact(botStatusData?.reduce((sum, item) => sum + (item.legitimateTraffic || 0), 0) || 0)}
              </div>
            </div>

            {/* Bot Traffic Card */}
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-red-600">Bot Traffic</div>
              <div className="mt-2 text-xl font-bold text-red-600">
                {formatCompact(botStatusData?.reduce((sum, item) => sum + (item.botTraffic || 0), 0) || 0)}
              </div>
            </div>

            {/* Bot Percentage Card */}
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-red-400">Bot Percentage</div>
              <div className="mt-2 text-xl font-bold text-red-400">
                {(() => {
                  const totalBot = botStatusData?.reduce((sum, item) => sum + (item.botTraffic || 0), 0) || 0;
                  const totalTraffic = botStatusData?.reduce((sum, item) => sum + (item.cg1ClickedCount || 0), 0) || 0;
                  return totalTraffic === 0 ? "0.00%" : ((totalBot / totalTraffic) * 100).toFixed(2) + "%";
                })()}
              </div>
            </div>

          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
            <TotalTrafficNewChart data={botStatusData || []} />
            {/* <LineChartComponent chartData={botStatusData || []} /> */}
            <PieChartComponent data={botReasonData} title="Bot Reason Distribution" />
            {/* <CG2ClickedChart data={cg2ClickedData} /> */}
            {/* <BotEventsChart data={botEventsData} /> */}

            <Top5BotServicesChart data={top5BlockedServicesData} />
            <Top5BlockedCPChart data={top5BlockedCPData} cpdata={dropdownData.cpList} />
            <Top5TrafficSourceChart data={top5BlockedTrafficSourceData} />
          </div>
        </>
      )}
    </div>
  );
} 