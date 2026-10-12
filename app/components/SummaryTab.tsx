import React from "react";
import { format } from "date-fns";
import { Button } from "./ui/button";
import { SearchableSelect } from "./ui/searchable-select";
import { TotalTrafficChart } from "./ui/TotalTrafficChart";
import { ConsentGivenChart } from "./ui/ConsentGivenChart";
import { SDPSuccessChart } from "./ui/SDPSuccessChart";
import { SDPFailureChart } from "./ui/SDPFailureChart";
import { TotalCallbacksChart } from "./ui/TotalCallbacksChart";
import { CallbackSuccessChart } from "./ui/CallbackSuccessChart";
import { CallbackErrorsChart } from "./ui/CallbackErrorsChart";
import { BotStatusHistogram } from "./BotStatusHistogram";
import { cn } from "../lib/utils";
import LineChartComponent from "./ui/TotalTraffic";
import SDPSucessFailureChart from "./ui/SDPSucessFailureChart";
import SubscriptionFlowChart from "./ui/subscriptionFlowChart";
import SubscriptionFlowTable from "./ui/subscriptionFlowTable";
import DropoffRateTable from "./ui/dropofRate";
import ConversionRateTable from "./ui/conversionRate";
import PieChartComponent from "./ui/PieCharts";
import TotalCg1Cg2Traffic from "./ui/totalCg1Cg2Traffic";
import { useFetcher } from "@remix-run/react";
import { getSession } from "~/lib/session.server";
import { Spinner } from "./ui/Spinner";
import { Skeleton } from "./ui/skeleton";
import { Progress } from "./ui/progress";

interface SummaryTabProps {
  startDate: Date;
  endDate: Date;
  summaryData: any[];
  botStatusData?: any[];
  SDPSuccessData?: any[];
  SubscriptionFlowData?: any[];
  SDPErrorDistributionData?: any[];
  dropdownData: {
    cpList: any[];
    serviceIdList: any[];
    productList: any[];
  };
  cachedSummaryData: {
    timestamp: number;
  };
  onFilter: (selectedCp: string) => void;
  onClearFilter: () => void;
  isFiltered: boolean;
  selectedCp: string;
  setSelectedCp: (value: string) => void;
  selectedServiceId: string;
  setSelectedServiceId: (value: string) => void;
  selectedSubDesc: string;
  setSelectedSubDesc: (value: string) => void;
  filteredData: any[];
  isLoading: any
  userRole: string;
  userCpid: string;
}

export function SummaryTab({
  startDate,
  endDate,
  summaryData,
  botStatusData,
  SDPSuccessData,
  SubscriptionFlowData,
  SDPErrorDistributionData,
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
  isLoading,
  userRole,
  userCpid
}: SummaryTabProps) {
  // Use filtered data if filter is applied, otherwise use full data
  const dataForCharts = isFiltered ? filteredData : summaryData;


  const fetcher = useFetcher();

  // Cascading filter logic
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

      // For CP users, filter service IDs for their CP only
      const filteredServiceIds = dropdownData.serviceIdList.filter((sid: any) => sid.cpId === userCpid);
      return filteredServiceIds.map((sid: any) => ({
        value: sid.serviceId,
        label: sid.serviceIdName
      }));
    } else if (selectedCp === "ALL") {
      return [
        { value: "ALL",label: "" },
        ...dropdownData.serviceIdList.map((sid: any) => ({
          value: sid.serviceId,
          label: sid.serviceIdName
        }))
      ];
    } else {
      const filteredServiceIds = dropdownData.serviceIdList.filter((sid: any) => sid.cpId === selectedCp);
      return [
        { value: "ALL" ,label: "" },
        ...filteredServiceIds.map((sid: any) => ({
          value: sid.serviceId,
          label: sid.serviceIdName
        }))
      ];
    }
  }, [dropdownData.serviceIdList, selectedCp, userRole]);


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
  // Chart data calculations
  const totalTrafficData = React.useMemo(() => {
    const cg1LoadedData = dataForCharts.filter((item: any) =>
      item.counterKey === 'cg1Loaded'
    );

    const result: Record<string, number> = {};
    for (const item of cg1LoadedData) {
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

  const consentGivenData = React.useMemo(() => {
    const cg2ClickedData = dataForCharts.filter((item: any) =>
      item.counterKey === 'cg2Clicked'
    );

    const result: Record<string, number> = {};
    for (const item of cg2ClickedData) {
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

  const sdpSuccessData = React.useMemo(() => {
    const sdpSuccessItems = dataForCharts.filter((item: any) =>
      item.counterKey === 'sdpSuccess'
    );

    const result: Record<string, number> = {};
    for (const item of sdpSuccessItems) {
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

  const sdpFailureData = React.useMemo(() => {
    const sdpFailureItems = dataForCharts.filter((item: any) =>
      item.counterKey === 'sdpFailure'
    );

    const result: Record<string, number> = {};
    for (const item of sdpFailureItems) {
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

  const totalCallbacksData = React.useMemo(() => {
    const callbackItems = dataForCharts.filter((item: any) =>
      item.counterKey === 'CBSuccess' || item.counterKey === 'CBFailure'
    );

    const result: Record<string, number> = {};
    for (const item of callbackItems) {
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

  const callbackSuccessData = React.useMemo(() => {
    const callbackSuccessItems = dataForCharts.filter((item: any) =>
      item.counterKey === 'CBSuccess'
    );

    const result: Record<string, number> = {};
    for (const item of callbackSuccessItems) {
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

  const callbackErrorsData = React.useMemo(() => {
    const callbackErrorItems = dataForCharts.filter((item: any) =>
      item.counterKey === 'CBFailure'
    );

    const result: Record<string, number> = {};
    for (const item of callbackErrorItems) {
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

      {/* Filter Status */}
      {isFiltered && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md mb-4">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="text-sm text-blue-800">
            Filtered by: Service ID: <strong>{selectedServiceId}</strong>, Subscription: <strong>{selectedSubDesc}</strong>
          </div>
        </div>
      )}

      {/* Searchable Dropdowns */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {userRole === "admin" && (
          <div className="flex flex-col space-y-2">
            <label className="text-sm font-medium">CP Name</label>
            <SearchableSelect
              options={cpOptions}
              value={selectedCp}
              onValueChange={(value) => {
                setSelectedCp(value);
              }}
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
          <label className="text-sm font-medium">Subscription Description</label>
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
              // disabled={selectedServiceId === "ALL" || selectedSubDesc === "ALL"}
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
              <span>Loading summary data...</span>
              <span className="font-medium">Please wait</span>
            </div>
            <Progress value={75} className="h-2" />
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
      )}

      {!isLoading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 lg:grid-cols-5 gap-2 ">
            {/* Total Traffic Card */}
            <div className="bg-white p-2  rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-blue-500">Total Traffic</div>
              <div className="mt-2 text-xl font-bold text-blue-500">
                {formatCompact(botStatusData?.reduce((sum, item) => sum + (item.totalTraffic || 0), 0) || 0)}
              </div>
            </div>
            {/* Lasso CTA -1 Card */}
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-purple-800">CTA-1</div>
              <div className="mt-2 text-xl font-bold text-purple-800">
                {formatCompact(botStatusData?.reduce((sum, item) => sum + (item.cg1ClickedCount || 0), 0) || 0)}
              </div>
            </div>
            {/* CTA 2 Card */}
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-indigo-500" style={{ color: "#ff6633" }}>CTA-2</div>
              <div className="mt-2 text-xl font-bold" style={{ color: "#ff6633" }}>
                {formatCompact(botStatusData?.reduce((sum, item) => sum + (item.cg2ClickedCount || 0), 0) || 0)}
              </div>
            </div>
            {/* SDP Submit Card
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-yellow-500">SDP Submit</div>
              <div className="mt-2 text-2xl font-bold text-yellow-500">
                {SDPSuccessData?.reduce((sum, item) => sum + (item.total || 0), 0) || 0}
              </div>
            </div> */}
            {/* SDP Success Count Card */}
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-green-500">SDP Success</div>
              <div className="mt-2 text-xl font-bold text-green-500">
                {formatCompact(SDPSuccessData?.reduce((sum, item) => sum + (item.sdpSuccess || 0), 0) || 0)}
              </div>
            </div>
            {/* SDP Failure Count Card */}
            <div className="bg-white p-2 rounded-lg shadow border text-center">
              <div className="text-sm font-medium text-red-500">SDP Failure</div>
              <div className="mt-2 text-xl font-bold text-red-500">
                {formatCompact(SDPSuccessData?.reduce((sum, item) => sum + (item.sdpFailure || 0), 0) || 0)}
              </div>
            </div>

            

          
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
            <TotalCg1Cg2Traffic chartData={botStatusData || []} />
            <SDPSucessFailureChart chartData={SDPSuccessData || []} />
            <SubscriptionFlowChart chartData={SubscriptionFlowData || []} />
            <PieChartComponent data={SDPErrorDistributionData || []} title="SDP Error Distribution" />
            <SubscriptionFlowTable chartData={SubscriptionFlowData || []} />
            <DropoffRateTable chartData={SubscriptionFlowData || []} />
            <ConversionRateTable chartData={SubscriptionFlowData || []} />

          </div>
        </>
      )}
    </div>
  );
} 