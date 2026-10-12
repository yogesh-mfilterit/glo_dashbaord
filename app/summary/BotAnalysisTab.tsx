import React from 'react';
import PieChartComponent from '~/components/ui/PieCharts';
import { TotalTrafficNewChart } from '~/components/ui/totalTrafficChartNew';
import { Top5BotServicesChart } from '~/components/ui/blockedServicesSources';
import { Top5BlockedCPChart } from '~/components/ui/Top5BlockedCPChart';
import { Top5TrafficSourceChart } from '~/components/ui/blockedTrafficSources';
import Top10ServicesByTraffic from '~/components/ui/top10ServicesByTraffic';

interface BotAnalysisTabProps {
  data: any[];
  startDate: string;
  endDate: string;
  isLoading: boolean;
  selectedCp?: string;
  selectedServiceId?: string;
  selectedSubscription?: string;
  top5BlockedServicesData?: any[];
  top5BlockedCPData?: any[];
  cpList?: any[];
  serviceList?: any[];
  productList?: any[];
  top5BlockedTrafficSourceData?: any[];
  serviceIdList?: { id: string; name: string }[]; // Add this prop
}

export default function BotAnalysisTab({
  data,
  startDate,
  endDate,
  isLoading,
  selectedCp,
  selectedServiceId,
  selectedSubscription,
  cpList,
  serviceList,
  productList,
  serviceIdList,
}: BotAnalysisTabProps) {
  // Debug: Log when component renders
  console.log('BotAnalysisTab rendered with filters:', {
    selectedCp,
    selectedServiceId,
    selectedSubscription,
    dataLength: data?.length,
    cpList,
    serviceList,
    productList,
    serviceIdList,
  });

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

  // Service IDs that belong to the selected CP
  const cpServiceIds: Set<string> = new Set(
    selectedCp && selectedCp !== 'ALL' && serviceList
      ? serviceList.filter((s: any) => s.cpId === selectedCp).map((s: any) => String(s.serviceId))
      : []
  );

  // When serviceId is ALL but a CP is selected, filter service_wise_* to only that CP's service IDs
  const getFilteredServiceData = (dataSource: any) => {
    if (!dataSource) return {};
    if (cpServiceIds.size === 0) return dataSource;
    return Object.fromEntries(
      Object.entries(dataSource).filter(([key]) => cpServiceIds.has(String(key)))
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading bot analysis data...</p>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center p-8">
        <p className="text-gray-600">No Bot Analysis data available for the selected date range.</p>
        <p className="text-sm text-gray-500 mt-2">
          Showing data from {startDate} to {endDate}
        </p>
      </div>
    );
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  const parseCount = (v: any) => {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (!isNaN(Number(v))) return Number(v);
    return 0;
  };

  const formatDateISO = (d: string | Date | undefined) => {
    if (!d) return startDate || '';
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return startDate || '';
      return dt.toISOString().slice(0, 10); // YYYY-MM-DD
    } catch (e) {
      return startDate || '';
    }
  };

  // Function to process current data for bot analysis
  const chartData = () => {
    if (!data || data.length === 0) {
      return {
        dailyBotData: [],
        botReasonsData: [],
        cpBotData: [],
      };
    }

    // Process daily bot data
    const dailyBotData = data
      .map((record) => {
        let totalBotTraffic = 0;
        let totalCleanTraffic = 0;
        let totalTraffic = 0;

        // Determine which data source to use based on filters
        let botData, trafficData;

        let cg1Data;
        if (selectedSubscription && selectedSubscription !== 'ALL') {
          botData = getFilteredData(record.subscription_wise_bot_traffic, 'subscription');
          trafficData = getFilteredData(record.subscription_wise_total_traffic, 'subscription');
          cg1Data = getFilteredData(record.subscription_wise_cg_clicked_data, 'subscription');
        } else if (selectedServiceId && selectedServiceId !== 'ALL') {
          botData = getFilteredData(record.service_wise_bot_traffic, 'service');
          trafficData = getFilteredData(record.service_wise_total_traffic, 'service');
          cg1Data = getFilteredData(record.service_wise_cg_clicked_data, 'service');
        } else {
          botData = getFilteredServiceData(record.service_wise_bot_traffic);
          trafficData = getFilteredServiceData(record.service_wise_total_traffic);
          cg1Data = getFilteredServiceData(record.service_wise_cg_clicked_data);
        }

        if (botData) {
          totalBotTraffic = Object.values(botData).reduce((sum: number, val: any) => {
            const numVal = Number(val);
            return sum + (isNaN(numVal) ? 0 : numVal);
          }, 0);
        }

        // Calculate total cg1Clicked from cg1Data
        let totalCg1Clicked = 0;
        if (cg1Data) {
          Object.values(cg1Data).forEach((item: any) => {
            if (item && typeof item === 'object') {
              totalCg1Clicked += Number(item.cg1Clicked || 0);
            }
          });
        }

        totalCleanTraffic = totalCg1Clicked - totalBotTraffic;
        if (totalCleanTraffic < 0) totalCleanTraffic = 0;

        if (trafficData) {
          totalTraffic = Object.values(trafficData).reduce((sum: number, val: any) => {
            const numVal = Number(val);
            return sum + (isNaN(numVal) ? 0 : numVal);
          }, 0);
        } else {
          totalTraffic = totalBotTraffic + totalCleanTraffic;
        }

        const botPercentage = totalCg1Clicked > 0 ? (totalBotTraffic / totalCg1Clicked) * 100 : 0;

        return {
          date: new Date(record.dbDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          }),
          totalTraffic: isNaN(totalTraffic) ? 0 : totalTraffic,
          legitimateTraffic: isNaN(totalCleanTraffic) ? 0 : totalCleanTraffic,
          botTraffic: isNaN(totalBotTraffic) ? 0 : totalBotTraffic,
          botPercentage: isNaN(botPercentage) ? 0 : Number(botPercentage.toFixed(2)),
          cg1ClickedCount: isNaN(totalCg1Clicked) ? 0 : totalCg1Clicked,
        };
      })
      .filter((item) => item.totalTraffic > 0);

    // Process bot reasons data
    const botReasonsData = data.reduce((acc: any[], record) => {
      let filteredBotReasonData;

      if (selectedSubscription && selectedSubscription !== 'ALL') {
        filteredBotReasonData = getFilteredData(
          record.subscription_wise_bot_reasons,
          'subscription',
        );
      } else if (selectedServiceId && selectedServiceId !== 'ALL') {
        filteredBotReasonData = getFilteredData(record.service_wise_bot_reasons, 'service');
      } else {
        filteredBotReasonData = getFilteredServiceData(record.service_wise_bot_reasons);
      }

      if (filteredBotReasonData) {
        Object.values(filteredBotReasonData).forEach((item: any) => {
          if (item && typeof item === 'object') {
            Object.entries(item).forEach(([reason, count]) => {
              const existing = acc.find((item) => item.name === reason);
              if (existing) {
                existing.value += Number(count);
              } else {
                acc.push({ name: reason, value: Number(count) });
              }
            });
          }
        });
      }
      return acc;
    }, []);

    // Process CP bot data
    const cpBotData = data.reduce((acc: any[], record) => {
      let filteredCpBotData;

      if (selectedSubscription && selectedSubscription !== 'ALL') {
        filteredCpBotData = getFilteredData(record.subscription_wise_bot_traffic, 'subscription');
      } else if (selectedServiceId && selectedServiceId !== 'ALL') {
        filteredCpBotData = getFilteredData(record.service_wise_bot_traffic, 'service');
      } else {
        filteredCpBotData = getFilteredServiceData(record.service_wise_bot_traffic);
      }

      if (filteredCpBotData) {
        Object.entries(filteredCpBotData).forEach(([cpId, count]) => {
          const existing = acc.find((item) => item.name === cpId);
          if (existing) {
            existing.value += Number(count);
          } else {
            acc.push({ name: cpId, value: Number(count) });
          }
        });
      }
      return acc;
    }, []);

    return {
      dailyBotData,
      botReasonsData,
      cpBotData,
    };
  };

  const chartDataProcessed = chartData();

  // ---------------------- New: compute Top 5 helpers ----------------------
  // Each returns the shapes requested by you.

  const computeTop5BlockedServices = () => {
    // Return type: { dbDate: string; serviceName: string; count: number }[]
    const acc: Record<string, number> = {};

    if (!data || data.length === 0) return [];

    data.forEach((record) => {
      // precedence: subscription scoped service map > service_wise_service_bot_traffic > service_wise_bot_traffic > cp_wise_service_bot_traffic
      let serviceSource = null;

      if (
        selectedSubscription &&
        selectedSubscription !== 'ALL' &&
        record.subscription_wise_service_bot_traffic
      ) {
        serviceSource = getFilteredData(
          record.subscription_wise_service_bot_traffic,
          'subscription',
        );
      } else if (record.service_wise_service_bot_traffic) {
        serviceSource = getFilteredData(record.service_wise_service_bot_traffic, 'service');
      } else if (record.service_wise_bot_traffic) {
        serviceSource = getFilteredData(record.service_wise_bot_traffic, 'service');
      } else if (record.cp_wise_service_bot_traffic) {
        serviceSource = getFilteredData(record.cp_wise_service_bot_traffic, 'cp');
      } else if (record.service_wise_bot_traffic) {
        serviceSource = getFilteredData(record.service_wise_bot_traffic, 'service');
      } else {
        serviceSource = {};
      }

      Object.entries(serviceSource || {}).forEach(([svcId, val]) => {
        if (val == null) return;
        if (typeof val === 'number' || (!isNaN(Number(val)) && typeof val !== 'object')) {
          acc[svcId] = (acc[svcId] || 0) + Number(val);
        } else if (typeof val === 'object') {
          // flatten nested object
          Object.values(val).forEach((nested) => {
            if (nested == null) return;
            if (typeof nested === 'number' || !isNaN(Number(nested))) {
              acc[svcId] = (acc[svcId] || 0) + Number(nested);
            } else if (typeof nested === 'object') {
              const possible = Number(
                (nested as any).count ?? (nested as any).value ?? (nested as any).total ?? 0,
              );
              if (!isNaN(possible) && possible !== 0) {
                acc[svcId] = (acc[svcId] || 0) + possible;
              }
            }
          });
        }
      });
    });

    // Create a map from serviceId to serviceIdName for quick lookup
    const serviceIdToName: Record<string, string> = {};
    console.log('ServiceList for mapping:', serviceList);
    (serviceList || []).forEach((svc: any) => {
      if (svc.serviceId) {
        serviceIdToName[String(svc.serviceId)] = svc.serviceIdName || String(svc.serviceId);
      }
    });
    console.log('ServiceIdToName mapping:', serviceIdToName);

    let result = Object.entries(acc).map(([serviceId, value]) => {
      // Map service ID to service name
      const serviceName = serviceIdToName[serviceId] || serviceId;
      return { serviceName, count: value, serviceId };
    });

    // Filter by selected CP if active
    if (selectedCp && selectedCp !== 'ALL') {
      console.log('Filtering by selected CP:', selectedCp);
      console.log('Services before CP filtering:', result);

      result = result.filter((r) => {
        // Find the service in serviceList to check its CP association
        const serviceInfo = (serviceList || []).find(
          (svc: any) => String(svc.serviceId) === String(r.serviceId),
        );

        if (serviceInfo) {
          const belongsToCP =
            serviceInfo.cpId === selectedCp ||
            serviceInfo.associatedCp === selectedCp ||
            serviceInfo.cp_id === selectedCp;
          console.log(
            `Service ${r.serviceName} (${r.serviceId}) belongs to CP ${selectedCp}:`,
            belongsToCP,
            serviceInfo,
          );
          return belongsToCP;
        }

        console.log(`Service ${r.serviceName} (${r.serviceId}) not found in serviceList`);
        // If service not found in serviceList, exclude it when CP filter is active
        return false;
      });

      console.log('Services after CP filtering:', result);
    }

    // if selectedServiceId is active, limit to that
    if (selectedServiceId && selectedServiceId !== 'ALL') {
      result = result.filter((r) => {
        const mappedServiceId = Object.keys(serviceIdToName).find(
          (id) => serviceIdToName[id] === r.serviceName,
        );
        return mappedServiceId === selectedServiceId || r.serviceName === selectedServiceId;
      });
    }

    result.sort((a, b) => b.count - a.count);
    const dbDate = formatDateISO(data[0]?.dbDate || startDate);
    const finalResult = result
      .slice(0, 5)
      .map((r) => ({ dbDate, serviceName: r.serviceName, count: r.count }));
    console.log('Final Top5BlockedServices result:', finalResult);
    return finalResult;
  };

  const computeTop5BlockedCPs = () => {
    // Return type : { dbDate: string; cpId: string; cpName: string; count: number }[]
    const acc: Record<string, number> = {};

    if (!data || data.length === 0) return [];

    data.forEach((record) => {
      let cpSource: Record<string, number> | null = null;

      if (
        selectedSubscription &&
        selectedSubscription !== 'ALL' &&
        record.subscription_wise_cp_bot_traffic
      ) {
        cpSource = getFilteredData(record.subscription_wise_cp_bot_traffic, 'subscription');
      } else if (
        selectedServiceId &&
        selectedServiceId !== 'ALL' &&
        record.service_wise_cp_bot_traffic
      ) {
        cpSource = getFilteredData(record.service_wise_cp_bot_traffic, 'service');
      } else if (record.cp_wise_bot_traffic) {
        cpSource = getFilteredData(record.cp_wise_bot_traffic, 'cp');
      } else if (record.cp_wise_service_bot_traffic) {
        // cp_wise_service_bot_traffic may be { cpId: { svcId: count } }
        cpSource = {} as Record<string, number>;
        Object.entries(record.cp_wise_service_bot_traffic).forEach(([cpId, nested]) => {
          const sum = Object.values(nested || {}).reduce(
            (s: number, nv: any) => s + parseCount(nv),
            0,
          );
          cpSource![cpId] = (cpSource![cpId] || 0) + sum;
        });
      } else {
        cpSource = {} as Record<string, number>;
      }

      Object.entries(cpSource || {}).forEach(([cpId, val]) => {
        acc[cpId] = (acc[cpId] || 0) + parseCount(val);
      });
    });

    let result = Object.entries(acc).map(([cpId, value]) => ({ cpId, count: value }));
    result.sort((a, b) => b.count - a.count);
    const dbDate = formatDateISO(data[0]?.dbDate || startDate);

    // attempt to resolve cpName from cpList if available
    return result.slice(0, 5).map((r) => {
      const cpMeta = (cpList || []).find(
        (c: any) => String(c.cpId) === String(r.cpId) || String(c.id) === String(r.cpId),
      );
      const cpName = cpMeta?.name || cpMeta?.cpName || String(r.cpId);
      return { dbDate, cpId: String(r.cpId), cpName, count: r.count };
    });
  };

  const computeTop5BlockedTrafficSources = () => {
    // Return type: { dbDate: string; trafficSource: string; count: number }[]
    const acc: Record<string, number> = {};
    if (!data || data.length === 0) return [];

    console.log('computeTop5BlockedTrafficSources - Filters:', {
      selectedCp,
      selectedServiceId,
      selectedSubscription,
    });

    data.forEach((record) => {
      // traffic source data may live in several fields
      let src = null;
      if (
        selectedSubscription &&
        selectedSubscription !== 'ALL' &&
        record.subscription_wise_traffic_source
      ) {
        src = getFilteredData(record.subscription_wise_traffic_source, 'subscription');
      } else if (
        selectedServiceId &&
        selectedServiceId !== 'ALL' &&
        record.service_wise_traffic_source
      ) {
        src = getFilteredData(record.service_wise_traffic_source, 'service');
      } else if (selectedCp && selectedCp !== 'ALL' && record.cp_wise_traffic_source) {
        src = getFilteredData(record.cp_wise_traffic_source, 'cp');
        console.log('Using CP filtered traffic source data:', src);
      } else if (record.cp_wise_traffic_source) {
        src = record.cp_wise_traffic_source;
        console.log('Using unfiltered CP traffic source data:', src);
      } else {
        src = {};
      }

      Object.entries(src || {}).forEach(([serviceId, serviceData]) => {
        if (serviceData == null) return;

        if (typeof serviceData === 'object') {
          // This is nested traffic source data like {"GOOGLE": 1182, "TIKTOK": 1, "INTERNAL": 10}
          Object.entries(serviceData).forEach(([trafficSource, count]) => {
            if (count != null) {
              acc[trafficSource] = (acc[trafficSource] || 0) + parseCount(count);
            }
          });
        } else if (
          typeof serviceData === 'number' ||
          (!isNaN(Number(serviceData)) && typeof serviceData !== 'object')
        ) {
          // Fallback for direct numeric values
          acc[serviceId] = (acc[serviceId] || 0) + Number(serviceData);
        }
      });
    });

    // Create a mapping for traffic source names to make them more readable
    const trafficSourceNameMapping: Record<string, string> = {
      GOOGLE: 'Google',
      TIKTOK: 'TikTok',
      FACEBOOK: 'Facebook',
      INTERNAL: 'Internal',
      DEMOPAGE: 'Demo Page',
      NA: 'Not Available',
      UNKNOWN: 'Unknown Source',
    };

    let result = Object.entries(acc).map(([trafficSource, count]) => {
      const readableName = trafficSourceNameMapping[trafficSource] || trafficSource;
      return { trafficSource: readableName, count, originalId: trafficSource };
    });

    result.sort((a, b) => b.count - a.count);
    const dbDate = formatDateISO(data[0]?.dbDate || startDate);
    const finalResult = result.slice(0, 5).map((r) => ({
      dbDate,
      trafficSource: r.trafficSource,
      count: r.count,
      originalId: r.originalId,
    }));
    console.log('Final Top5BlockedTrafficSources result:', finalResult);
    return finalResult;
  };

  // ---------------------- End New helpers ----------------------

  // Calculate bot traffic statistics from processed data
  const calculateBotStats = () => {
    let totalBotTraffic = 0;
    let totalCleanTraffic = 0;

    chartDataProcessed.dailyBotData.forEach((item) => {
      totalBotTraffic += item.botTraffic;
      totalCleanTraffic += item.legitimateTraffic;
    });

    return {
      totalBotTraffic,
      totalCleanTraffic,
      botReasons: chartDataProcessed.botReasonsData,
      cpBotTraffic: chartDataProcessed.cpBotData,
      totalTraffic: totalBotTraffic + totalCleanTraffic,
      botPercentage:
        totalBotTraffic + totalCleanTraffic > 0
          ? ((totalBotTraffic / (totalBotTraffic + totalCleanTraffic)) * 100).toFixed(2)
          : 0,
    };
  };

  const stats = calculateBotStats();

  // Calculate KPI totals from processed data
  const kpiData = chartDataProcessed.dailyBotData.reduce(
    (totals, item) => {
      totals.totalTraffic += item.totalTraffic;
      totals.cleanTraffic += item.legitimateTraffic;
      totals.botTraffic += item.botTraffic;
      return totals;
    },
    { totalTraffic: 0, cleanTraffic: 0, botTraffic: 0 },
  );

  // Calculate CTA1 from CG1 clicked data
  const cta1Data = chartDataProcessed.dailyBotData.reduce(
    (total, item) => total + item.cg1ClickedCount,
    0,
  );

  console.log('BotAnalysisTab - CTA1 calculation:', {
    dailyBotData: chartDataProcessed.dailyBotData,
    cta1Data,
    cg1ClickedCounts: chartDataProcessed.dailyBotData.map((item) => item.cg1ClickedCount),
  });

  // Calculate bot percentage
  const botPercentage = cta1Data > 0 ? (kpiData.botTraffic / cta1Data) * 100 : 0;
  // Show Top 10 Services only when no specific service is selected
  const showTop10Services = !selectedServiceId || selectedServiceId === 'ALL';

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 lg:grid-cols-5 gap-2">
        <div className="bg-white p-2  rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-blue-500">Total Traffic</div>
          <div className="mt-2 text-xl font-bold text-blue-500">
            {formatNumber(kpiData.totalTraffic)}
          </div>
        </div>

        <div className="bg-white p-2  rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-purple-800">CTA-1</div>
          <div className="mt-2 text-xl font-bold text-purple-800">{formatNumber(cta1Data)}</div>
        </div>

        <div className="bg-white p-2  rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-green-500">Clean Traffic</div>
          <div className="mt-2 text-xl font-bold text-green-500">
            {formatNumber(kpiData.cleanTraffic)}
          </div>
        </div>

        <div className="bg-white p-2  rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-red-600">Bot Traffic</div>
          <div className="mt-2 text-xl font-bold text-red-600">
            {formatNumber(kpiData.botTraffic)}
          </div>
        </div>

        <div className="bg-white p-2  rounded-lg shadow border text-center">
          <div className="text-sm font-medium text-orange-600">Bot Percentage</div>
          <div className="mt-2 text-xl font-bold text-orange-600">{botPercentage.toFixed(2)}%</div>
        </div>
      </div>

      {/* Bot Reasons Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
        <TotalTrafficNewChart data={chartDataProcessed.dailyBotData || []} />
        <PieChartComponent
          data={chartDataProcessed.botReasonsData}
          title="Bot Reason Distribution"
        />

        <Top5BotServicesChart data={computeTop5BlockedServices()} serviceList={serviceList || []} />
        <Top5BlockedCPChart data={computeTop5BlockedCPs()} cpdata={cpList || []} />
        <Top5TrafficSourceChart data={computeTop5BlockedTrafficSources()} />
        {/* Show Top 10 Services only when no specific service is selected */}
        {showTop10Services && <Top10ServicesByTraffic data={data} serviceIdList={serviceList} />}
      </div>
    </div>
  );
}
