import React from 'react';
import TotalCg1Cg2Traffic from "../components/ui/totalCg1Cg2Traffic";
import SDPSucessFailureChart from '../components/ui/SDPSucessFailureChart';
import SubscriptionFlowChart from '../components/ui/subscriptionFlowChart';
import PieChartComponent from '../components/ui/PieCharts';
import SubscriptionFlowTable from '~/components/ui/subscriptionFlowTable';
import DropoffRateTable from '~/components/ui/dropofRate';
import ConversionRateTable from '~/components/ui/conversionRate';
import TimeSpentCharts from '~/components/ui/timeSpentCharts';

interface SummaryTabProps {
  data: any[];
  startDate: string;
  endDate: string;
  isLoading: boolean;
  selectedCp?: string;
  selectedServiceId?: string;
  selectedSubscription?: string;
  serviceIdList?: any[];
}

export default function SummaryTab({ 
  data, 
  startDate, 
  endDate, 
  isLoading, 
  selectedCp, 
  selectedServiceId, 
  selectedSubscription,
  serviceIdList,
}: SummaryTabProps) {
  
  // Service IDs that belong to the selected CP
  const cpServiceIds: Set<string> = new Set(
    selectedCp && selectedCp !== 'ALL' && serviceIdList
      ? serviceIdList.filter((s: any) => s.cpId === selectedCp).map((s: any) => String(s.serviceId))
      : []
  );

  // Helper function to filter data based on selected filters
  const getFilteredData = (dataSource: any, filterType: 'cp' | 'service' | 'subscription') => {
    if (!dataSource) return {};
    
    if (filterType === 'cp' && selectedCp && selectedCp !== 'ALL') {
      const filtered = { [selectedCp]: dataSource[selectedCp] };
      return filtered;
    }
    
    if (filterType === 'service' && selectedServiceId && selectedServiceId !== 'ALL') {
      const filtered = { [selectedServiceId]: dataSource[selectedServiceId] };
      return filtered;
    }
    
    if (filterType === 'subscription' && selectedSubscription && selectedSubscription !== 'ALL') {
      const filtered = { [selectedSubscription]: dataSource[selectedSubscription] };
      return filtered;
    }
    
    return dataSource;
  };

  // When serviceId is ALL but a CP is selected, filter service_wise_* to only that CP's service IDs
  const getFilteredServiceData = (dataSource: any) => {
    if (!dataSource) return {};
    if (cpServiceIds.size === 0) return dataSource;
    return Object.fromEntries(
      Object.entries(dataSource).filter(([key]) => cpServiceIds.has(String(key)))
    );
  };

  // Function to process current data for charts
  const chartData = () => {
    console.log('Chart data processing started with filters:', {
      selectedCp,
      selectedServiceId,
      selectedSubscription,
      dataLength: data?.length
    });
    
    if (!data || data.length === 0) {
      return {
        totalCg1Cg2ClickedData: [],
        SDPSuccessData: [],
        SubscriptionFlowData: [],
        SDPErrorDistributionData: [],
        TimeSpentData: []
      };
    }

    // Process data for different chart types
    const totalCg1Cg2ClickedData = data.map(record => {
      
      let totalCg1Clicked = 0;
      let totalCg2Clicked = 0;
      let totalTraffic = 0;
      
      // Determine which data source to use based on filters
      let cgData, trafficData;
      
      if (selectedSubscription && selectedSubscription !== 'ALL') {
        cgData = getFilteredData(record.subscription_wise_cg_clicked_data, 'subscription');
        trafficData = getFilteredData(record.subscription_wise_total_traffic, 'subscription');
        console.log('Using subscription-wise data for CG and traffic');
      } else if (selectedServiceId && selectedServiceId !== 'ALL') {
        cgData = getFilteredData(record.service_wise_cg_clicked_data, 'service');
        trafficData = getFilteredData(record.service_wise_total_traffic, 'service');
        console.log('Using service-wise data for CG and traffic');
      } else {
        cgData = getFilteredServiceData(record.service_wise_cg_clicked_data);
        trafficData = getFilteredServiceData(record.service_wise_total_traffic);
      }
      
      console.log('CG Data filtering for date:', record.dbDate, {
        originalData: cgData,
        filteredData: cgData,
        selectedCp,
        selectedServiceId,
        selectedSubscription,
        cgDataType: typeof cgData,
        cgDataKeys: cgData ? Object.keys(cgData) : 'undefined',
        cgDataValues: cgData ? Object.values(cgData) : 'undefined',
        trafficDataType: typeof trafficData,
        trafficDataKeys: trafficData ? Object.keys(trafficData) : 'undefined',
        trafficDataValues: trafficData ? Object.values(trafficData) : 'undefined'
      });
      
      if (cgData) {
        Object.values(cgData).forEach((item: any) => {
          if (item && typeof item === 'object') {
            totalCg1Clicked += Number(item.cg1Clicked || 0);
            totalCg2Clicked += Number(item.cg2Clicked || 0);
          }
        });
      }
      
      if (trafficData) {
        totalTraffic = Object.values(trafficData).reduce((sum: number, val: any) => {
          const numVal = Number(val);
          return sum + (isNaN(numVal) ? 0 : numVal);
        }, 0);
      }
      
      console.log('CG Totals for date:', record.dbDate, {
        totalCg1Clicked,
        totalCg2Clicked,
        totalTraffic,
        trafficDataType: typeof trafficData,
        trafficDataValues: trafficData ? Object.values(trafficData) : 'undefined'
      });
      
      return {
        date: new Date(record.dbDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        totalTraffic: isNaN(totalTraffic) ? 0 : totalTraffic,
        cg1ClickedCount: isNaN(totalCg1Clicked) ? 0 : totalCg1Clicked,
        cg2ClickedCount: isNaN(totalCg2Clicked) ? 0 : totalCg2Clicked
      };
    }).filter(item => item.totalTraffic > 0);

    const SDPSuccessData = data.map(record => {
      console.log('SDP data for date:', record.dbDate);
      console.log('cp_wise_sdp_success_failures:', record.cp_wise_sdp_success_failures);
      console.log('subscription_wise_sdp_success_failures:', record.subscription_wise_sdp_success_failures);
      
      let totalSdpSuccess = 0;
      let totalSdpFailure = 0;
      
      let filteredSdpData;
      
      if (selectedSubscription && selectedSubscription !== 'ALL') {
        filteredSdpData = getFilteredData(record.subscription_wise_sdp_success_failures, 'subscription');
        console.log('Using subscription-wise SDP data');
      } else if (selectedServiceId && selectedServiceId !== 'ALL') {
        filteredSdpData = getFilteredData(record.service_wise_sdp_success_failures, 'service');
        console.log('Using service-wise SDP data');
      } else {
        filteredSdpData = getFilteredServiceData(record.service_wise_sdp_success_failures);
      }
      
      if (filteredSdpData) {
        Object.values(filteredSdpData).forEach((item: any) => {
          if (item && typeof item === 'object') {
            if (item.Success) {
              totalSdpSuccess += Number(item.Success);
            }
            Object.entries(item).forEach(([key, value]) => {
              if (key !== 'Success') {
                totalSdpFailure += Number(value || 0);
              }
            });
          }
        });
      }
      
      console.log('Calculated SDP Success:', totalSdpSuccess, 'SDP Failure:', totalSdpFailure);
      
      return {
        date: new Date(record.dbDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        sdpSuccess: isNaN(totalSdpSuccess) ? 0 : totalSdpSuccess,
        sdpFailure: isNaN(totalSdpFailure) ? 0 : totalSdpFailure,
        total: (isNaN(totalSdpSuccess) ? 0 : totalSdpSuccess) + (isNaN(totalSdpFailure) ? 0 : totalSdpFailure)
      };
    }).filter(item => item.total > 0);

    console.log('Total CG1/CG2 Data after filtering:', totalCg1Cg2ClickedData.length, 'records');
    console.log('SDP Success Data after filtering:', SDPSuccessData.length, 'records');

    const SubscriptionFlowData = data.map(record => {
      console.log('Subscription flow data for date:', record.dbDate);
      
      let totalCta1 = 0;
      let totalCta2 = 0;
      let totalSdpSuccess = 0;
      let totalCallbackSuccess = 0;
      let totalTraffic = 0;
      
      let cgData, sdpData, callbackData, trafficData;
      
      if (selectedSubscription && selectedSubscription !== 'ALL') {
        cgData = getFilteredData(record.subscription_wise_cg_clicked_data, 'subscription');
        sdpData = getFilteredData(record.subscription_wise_sdp_success_failures, 'subscription');
        callbackData = getFilteredData(record.subscription_wise_callback_data, 'subscription');
        trafficData = getFilteredData(record.subscription_wise_total_traffic, 'subscription');
        console.log('Using subscription-wise data for flow');
      } else if (selectedServiceId && selectedServiceId !== 'ALL') {
        cgData = getFilteredData(record.service_wise_cg_clicked_data, 'service');
        sdpData = getFilteredData(record.service_wise_sdp_success_failures, 'service');
        callbackData = getFilteredData(record.service_wise_callback_data, 'service');
        trafficData = getFilteredData(record.service_wise_total_traffic, 'service');
        console.log('Using service-wise data for flow');
      } else {
        cgData = getFilteredServiceData(record.service_wise_cg_clicked_data);
        sdpData = getFilteredServiceData(record.service_wise_sdp_success_failures);
        callbackData = getFilteredServiceData(record.service_wise_callback_data);
        trafficData = getFilteredServiceData(record.service_wise_total_traffic);
      }
      
      if (cgData) {
        Object.values(cgData).forEach((item: any) => {
          if (item && typeof item === 'object') {
            totalCta1 += Number(item.cg1Clicked || 0);
            totalCta2 += Number(item.cg2Clicked || 0);
          }
        });
      }
      
      if (sdpData) {
        Object.values(sdpData).forEach((item: any) => {
          if (item && typeof item === 'object' && item.Success) {
            totalSdpSuccess += Number(item.Success);
          }
        });
      }
      
      if (callbackData) {
        Object.values(callbackData).forEach((item: any) => {
          if (item && typeof item === 'object' && item.Success) {
            totalCallbackSuccess += Number(item.Success);
          }
        });
      }
      
      if (trafficData) {
        totalTraffic = Object.values(trafficData).reduce((sum: number, val: any) => {
          const numVal = Number(val);
          return sum + (isNaN(numVal) ? 0 : numVal);
        }, 0);
      }
      
      console.log('Calculated CTA1:', totalCta1, 'CTA2:', totalCta2, 'SDP Success:', totalSdpSuccess, 'Callback Success:', totalCallbackSuccess, 'Traffic:', totalTraffic);
      
      return {
        date: new Date(record.dbDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        BannerDisplay: isNaN(totalTraffic) ? 0 : totalTraffic,
        CTA1: isNaN(totalCta1) ? 0 : totalCta1,
        CTA2: isNaN(totalCta2) ? 0 : totalCta2,
        sdpSuccess: isNaN(totalSdpSuccess) ? 0 : totalSdpSuccess,
        CallbackSuccess: isNaN(totalCallbackSuccess) ? 0 : totalCallbackSuccess
      };
    }).filter(item => item.BannerDisplay > 0);

    console.log('Subscription Flow Data after filtering:', SubscriptionFlowData.length, 'records');

    const SDPErrorDistributionData = data.reduce((acc: any[], record) => {
      let filteredSdpData;
      
      if (selectedSubscription && selectedSubscription !== 'ALL') {
        filteredSdpData = getFilteredData(record.subscription_wise_sdp_success_failures, 'subscription');
      } else if (selectedServiceId && selectedServiceId !== 'ALL') {
        filteredSdpData = getFilteredData(record.service_wise_sdp_success_failures, 'service');
      } else {
        filteredSdpData = getFilteredServiceData(record.service_wise_sdp_success_failures);
      }
      
      if (filteredSdpData) {
        Object.values(filteredSdpData).forEach((item: any) => {
          if (item && typeof item === 'object') {
            Object.entries(item).forEach(([error, count]) => {
              if (error !== 'Success') {
                const existing = acc.find(accItem => accItem.name === error);
                if (existing) {
                  existing.value += Number(count);
                } else {
                  acc.push({ name: error, value: Number(count) });
                }
              }
            });
          }
        });
      }
      return acc;
    }, []);
        // const TimeSpentData = data.map(record => {
    //   const parseMaybe = (val: any) => {
    //     if (!val) return undefined;
    //     if (typeof val === 'string') {
    //       try { return JSON.parse(val); } catch { return undefined; }
    //     }
    //     return val;
    //   };
    //   const extractTime = (entry: any) => {
    //     if (entry == null) return 0;
    //     if (typeof entry === 'number') return entry;
    //     if (typeof entry === 'string') {
    //       const n = Number(entry);
    //       return isNaN(n) ? 0 : n;
    //     }
    //     if (typeof entry === 'object') {
    //       const cand = entry.timeSpent ?? entry.totalTime ?? entry.total ?? entry.time ?? entry.ms ?? 0;
    //       const n = Number(cand);
    //       return isNaN(n) ? 0 : n;
    //     }
    //     return 0;
    //   };

    //   const getServiceTraffic = (rec: any, svcId: string) => {
    //     const candidates = [
    //       rec.service_wise_total_traffic,
    //       rec.service_wise_traffic,
    //       rec.service_wise_total,
    //     ];
    //     for (const m of candidates) {
    //       const parsed = parseMaybe(m) || {};
    //       // direct value
    //       let v: any = parsed?.[svcId];
    //       if (v === undefined) v = parsed?.[Number(svcId as any) as any];
    //       if (v === undefined && typeof parsed === 'object') {
    //         // nested object with { total: N }
    //         const nested = parsed?.[svcId] ?? parsed?.[Number(svcId as any) as any];
    //         if (nested && typeof nested === 'object') v = nested.total ?? nested.count ?? nested.value;
    //       }
    //       const num = Number(v);
    //       if (!isNaN(num) && num > 0) return num;
    //     }
    //     return 0;
    //   };

    //   let totalCg1 = 0;
    //   let totalCg2 = 0;

    //   const cg1All = parseMaybe(record.service_wise_analytics_of_cg1_time_spent) || {};
    //   const cg2All = parseMaybe(record.service_wise_analytics_of_cg2_time_spent) || {};

    //   const pickByService = (obj: any) => {
    //     if (!obj) return undefined;
    //     const id = selectedServiceId;
    //     if (!id) return undefined;
    //     return obj[id] ?? obj[String(id)] ?? obj[Number(id as any) as any];
    //   };

    //   if (selectedServiceId && selectedServiceId !== 'ALL') {
    //     const cg1Entry: any = pickByService(cg1All);
    //     const cg2Entry: any = pickByService(cg2All);
    //     totalCg1 += extractTime(cg1Entry);
    //     totalCg2 += extractTime(cg2Entry);

    //     // Divide by total traffic of selected service for this day
    //     const svcId = selectedServiceId as string;
    //     const totalTrafficForSvc = getServiceTraffic(record, svcId);

    //     const totalTrafficForSvcc = totalCg1Cg2ClickedData.reduce((totals: any, item: any) => {
    //       totals.totalTraffic += item.totalTraffic;
    //       totals.cta1 += item.cg1ClickedCount;
    //       totals.cta2 += item.cg2ClickedCount;
    //       return totals;
    //     }, { totalTraffic: 0, cta1: 0, cta2: 0 });

    //     const totalTraffic = totalTrafficForSvcc.totalTraffic;
    //     if (totalTraffic > 0) {
    //       totalCg1 = totalCg1 / totalTraffic;
    //       totalCg2 = totalCg2 / totalTraffic;
    //     } else {
    //       totalCg1 = 0;
    //       totalCg2 = 0;
    //     }
    //   } else {
    //     Object.values(cg1All as any).forEach((entry: any) => { totalCg1 += extractTime(entry); });
    //     Object.values(cg2All as any).forEach((entry: any) => { totalCg2 += extractTime(entry); });
    //   }

    //   // Format to 2 decimal places, always showing .00 if integer
    //   const formatTime = (val: number) => {
    //     if (isNaN(val)) return "0.00";
    //     return val.toFixed(2);
    //   };

    //   return {
    //     date: new Date(record.dbDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    //     cg1Time: Number(formatTime(totalCg1)),
    //     cg2Time: Number(formatTime(totalCg2))
    //   };
    // }).filter(item => (item.cg1Time + item.cg2Time) > 0);

    const TimeSpentData = data.map(record => {
      const parseMaybe = (val: any) => {
        if (!val) return undefined;
        if (typeof val === 'string') {
          try { return JSON.parse(val); } catch { return undefined; }
        }
        return val;
      };
      
      const extractTime = (entry: any) => {
        if (entry == null) return 0;
        if (typeof entry === 'number') return entry;
        if (typeof entry === 'string') {
          const n = Number(entry);
          return isNaN(n) ? 0 : n;
        }
        if (typeof entry === 'object') {
          const cand = entry.timeSpent ?? entry.totalTime ?? entry.total ?? entry.time ?? entry.ms ?? 0;
          const n = Number(cand);
          return isNaN(n) ? 0 : n;
        }
        return 0;
      };

      const getServiceTraffic = (rec: any, svcId: string) => {
        const candidates = [
          rec.service_wise_total_traffic,
          rec.service_wise_traffic,
          rec.service_wise_total,
        ];
        for (const m of candidates) {
          const parsed = parseMaybe(m) || {};
          let v: any = parsed?.[svcId];
          if (v === undefined) v = parsed?.[Number(svcId as any) as any];
          if (v === undefined && typeof parsed === 'object') {
            const nested = parsed?.[svcId] ?? parsed?.[Number(svcId as any) as any];
            if (nested && typeof nested === 'object') v = nested.total ?? nested.count ?? nested.value;
          }
          const num = Number(v);
          if (!isNaN(num) && num > 0) return num;
        }
        return 0;
      };

      const getTotalTraffic = (rec: any) => {
        const candidates = [
          rec.service_wise_total_traffic,
          rec.service_wise_traffic,
          rec.service_wise_total,
        ];
        for (const m of candidates) {
          const parsed = parseMaybe(m) || {};
          if (typeof parsed === 'object') {
            let total = 0;
            Object.values(parsed).forEach((v: any) => {
              if (typeof v === 'object' && v !== null) {
                const val = v.total ?? v.count ?? v.value ?? 0;
                total += Number(val) || 0;
              } else {
                total += Number(v) || 0;
              }
            });
            if (total > 0) return total;
          }
        }
        return 0;
      };

      let totalCg1Ms = 0;
      let totalCg2Ms = 0;
      let totalTraffic = 0;

      const cg1All = parseMaybe(record.service_wise_analytics_of_cg1_time_spent) || {};
      const cg2All = parseMaybe(record.service_wise_analytics_of_cg2_time_spent) || {};

      const pickByService = (obj: any) => {
        if (!obj) return undefined;
        const id = selectedServiceId;
        if (!id) return undefined;
        return obj[id] ?? obj[String(id)] ?? obj[Number(id as any) as any];
      };

      if (selectedServiceId && selectedServiceId !== 'ALL') {
        const cg1Entry: any = pickByService(cg1All);
        const cg2Entry: any = pickByService(cg2All);
        totalCg1Ms = extractTime(cg1Entry);
        totalCg2Ms = extractTime(cg2Entry);

        const svcId = selectedServiceId as string;
        totalTraffic = getServiceTraffic(record, svcId);
      } else {
        Object.values(cg1All as any).forEach((entry: any) => { 
          totalCg1Ms += extractTime(entry); 
        });
        Object.values(cg2All as any).forEach((entry: any) => { 
          totalCg2Ms += extractTime(entry); 
        });
        
        totalTraffic = getTotalTraffic(record);
      }

      let avgCg1Seconds = 0;
      let avgCg2Seconds = 0;

      if (totalTraffic > 0) {
        avgCg1Seconds = (totalCg1Ms / totalTraffic) / 1000;
        avgCg2Seconds = (totalCg2Ms / totalTraffic) / 1000;
      }

      const formatTime = (val: number) => {
        if (isNaN(val)) return "0.00";
        return val.toFixed(2);
      };

      return {
        date: new Date(record.dbDate).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric' 
        }),
        cg1Time: Number(formatTime(avgCg1Seconds)),
        cg2Time: Number(formatTime(avgCg2Seconds))
      };
    }).filter(item => (item.cg1Time + item.cg2Time) > 0);

    return {
      totalCg1Cg2ClickedData,
      SDPSuccessData,
      SubscriptionFlowData,
      SDPErrorDistributionData,
      TimeSpentData
    };
  };

  const chartDataProcessed = chartData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading summary data...</p>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center p-8">
        <p className="text-gray-600">No summary data available for the selected date range.</p>
        <p className="text-sm text-gray-500 mt-2">
          Showing data from {startDate} to {endDate}
        </p>
      </div>
    );
  }

  // Calculate KPI totals from filtered data
  const kpiData = chartDataProcessed.totalCg1Cg2ClickedData.reduce((totals: any, item: any) => {
    totals.totalTraffic += item.totalTraffic;
    totals.cta1 += item.cg1ClickedCount;
    totals.cta2 += item.cg2ClickedCount;
    return totals;
  }, { totalTraffic: 0, cta1: 0, cta2: 0 });

  const sdpKpiData = chartDataProcessed.SDPSuccessData.reduce((totals: any, item: any) => {
    totals.sdpSuccess += item.sdpSuccess;
    totals.sdpFailure += item.sdpFailure;
    return totals;
  }, { sdpSuccess: 0, sdpFailure: 0 });

  // Format numbers with K/M suffixes
  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };


  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 lg:grid-cols-5 gap-2">
        <div className="bg-white p-2 rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-blue-500">Total Traffic</div>
          <div className="mt-2 text-xl font-bold text-blue-500">
            {formatNumber(kpiData.totalTraffic)}
          </div>
        </div>

        <div className="bg-white p-2 rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-purple-800">CTA-1</div>
          <div className="mt-2 text-xl font-bold text-purple-800">
            {formatNumber(kpiData.cta1)}
          </div>
        </div>

        <div className="bg-white p-2 rounded-lg shadow border text-center">
          <div className="text-sm font-medium" style={{ color: "#ff6633" }}>CTA-2</div>
          <div className="mt-2 text-xl font-bold" style={{ color: "#ff6633" }}>
            {formatNumber(kpiData.cta2)}
          </div>
        </div>

        <div className="bg-white p-2 rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-green-500">SDP Success</div>
          <div className="mt-2 text-xl font-bold text-green-500">
            {formatNumber(sdpKpiData.sdpSuccess)}
          </div>
        </div>

        <div className="bg-white p-2 rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-red-500">SDP Failure</div>
          <div className="mt-2 text-xl font-bold text-red-500">
            {formatNumber(sdpKpiData.sdpFailure)}
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
        <TotalCg1Cg2Traffic chartData={chartDataProcessed.totalCg1Cg2ClickedData || []} />
        <SDPSucessFailureChart chartData={chartDataProcessed.SDPSuccessData || []} />
        <SubscriptionFlowChart chartData={chartDataProcessed.SubscriptionFlowData || []} />
        <PieChartComponent data={chartDataProcessed.SDPErrorDistributionData || []} title="SDP Error Distribution" />
        <SubscriptionFlowTable chartData={chartDataProcessed.SubscriptionFlowData || []} />
        <DropoffRateTable chartData={chartDataProcessed.SubscriptionFlowData || []} />
        <ConversionRateTable chartData={chartDataProcessed.SubscriptionFlowData || []} />
        
        {/* Show Time Spent Chart only when specific service is selected */}
        {selectedServiceId && selectedServiceId !== 'ALL' && (
          <TimeSpentCharts chartData={chartDataProcessed.TimeSpentData || []} />
        )}
        
        
      </div>
    </div>
  );
}