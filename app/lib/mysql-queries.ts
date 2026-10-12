// MySQL Queries for Dashboard Analytics
// This file contains all the MySQL queries used in the summary dashboard

export interface QueryConfig {
  name: string;
  query: string;
  params: any[];
  processor: (results: any[]) => any[];
}

export interface QueryParams {
  startDateStr: string;
  endDateStr: string;
  cpParam?: string;
  serviceIdParam?: string;
  subDescParam?: string;
}

// Format date for chart display (e.g., "2025-08-01" -> "Aug 01")
function formatDateForChart(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
  });
}

// Bot Status Query - Analyzes bot vs legitimate traffic
export function getBotStatusQuery(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE conditions and parameter list
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?'];
  const queryParams: any[] = [startDateStr, endDateStr];

  // Filter tracking for SELECT/GROUP BY and response
  const selectedFilters: string[] = [];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
    selectedFilters.push('cpId');
  }

  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
    selectedFilters.push('serviceId');
  }

  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
    selectedFilters.push('subscriptionDescription');
  }

  console.log(queryParams);

  return {
    name: 'botStatus',
    query: `
      SELECT 
        dbDate,
        COUNT(*) as totalCount,
        COUNT(CASE WHEN botStatus = 0 THEN 1 END) as legitimateCount,
        COUNT(CASE WHEN botStatus = 1 THEN 1 END) as botCount,
        COUNT(CASE WHEN cg1Clicked = 1 THEN 1 END) as cg1ClickedCount,
        COUNT(CASE WHEN cg2Clicked = 1 THEN 1 END) as cg2ClickedCount
      FROM live_data 
      WHERE dbDate >= ? AND dbDate <= ? ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
      ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
      ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 1
      ORDER BY dbDate
    `,
    params: queryParams,
    processor: (results: any[]) => {
      return results.map((row: any) => {
        const totalTraffic = Number(row.totalCount);
        const legitimateTraffic = Number(row.cg1ClickedCount - row.botCount);
        // const legitimateTraffic = Number(row.legitimateCount);
        const botTraffic = Number(row.botCount);
        const botPercentage = totalTraffic > 0 ? (botTraffic / totalTraffic) * 100 : 0;
        const cg1ClickedCount = Number(row.cg1ClickedCount);
        const cg2ClickedCount = Number(row.cg2ClickedCount);
        // Base response
        const result: any = {
          date: formatDateForChart(row.dbDate),
          cpId: row.cpId,
          serviceId: row.serviceId,
          subscriptionDescription: row.subscriptionDescription,
          totalTraffic,
          legitimateTraffic,
          botTraffic,
          botPercentage: Number(botPercentage.toFixed(2)),
          cg1ClickedCount,
          cg2ClickedCount,
        };

        // Add filters to response only if they were selected
        selectedFilters.forEach((field) => {
          result[field] = row[field];
        });

        return result;
      });
    },
  };
}

// SDP Success/Failure Query - Analyzes SDP message success rates
export function getSDPSuccessFailureQuery(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE conditions and parameter list
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?'];
  const queryParams: any[] = [startDateStr, endDateStr];

  // Filter tracking for SELECT/GROUP BY and response
  const selectedFilters: string[] = [];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
    selectedFilters.push('cpId');
  }

  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
    selectedFilters.push('serviceId');
  }

  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
    selectedFilters.push('subscriptionDescription');
  }

  return {
    name: 'sdpSuccessFailure',
    query: `
      SELECT 
        dbDate,
        COUNT(CASE WHEN sdp_message = 'Success' THEN 1 END) AS sdpSuccess,
        COUNT(CASE WHEN sdp_message != 'Success' AND sdp_message != 'na' THEN 1 END) AS sdpFailure
      FROM live_data 
      WHERE dbDate >= ? AND dbDate <= ? ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
      ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
      ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 1
      ORDER BY dbDate
    `,
    params: queryParams,
    processor: (results: any[]) => {
      return results.map((row: any) => {
        const sdpSuccessTraffic = Number(row.sdpSuccess);
        const sdpFailureTraffic = Number(row.sdpFailure);

        return {
          date: formatDateForChart(row.dbDate),
          cpId: row.cpId,
          serviceId: row.serviceId,
          subscriptionDescription: row.subscriptionDescription,
          sdpSuccess: sdpSuccessTraffic,
          sdpFailure: sdpFailureTraffic,
          total: sdpSuccessTraffic + sdpFailureTraffic,
        };
      });
    },
  };
}

// Subscription Flow Query - Tracks the complete subscription funnel
export function getSubscriptionFlowQuery(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE conditions and parameter list
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?'];
  const queryParams: any[] = [startDateStr, endDateStr];

  // Filter tracking for SELECT/GROUP BY and response
  const selectedFilters: string[] = [];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
    selectedFilters.push('cpId');
  }

  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
    selectedFilters.push('serviceId');
  }

  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
    selectedFilters.push('subscriptionDescription');
  }

  return {
    name: 'subscriptionFlow',
    query: `
      SELECT 
        dbDate,
        COUNT(*) as BannerDisplay,
        COUNT(case WHEN cg1Clicked then 1 end) as CTA1,
        COUNT(case WHEN cg2Clicked then 1 end) as CTA2,
        COUNT(CASE WHEN sdp_message = 'Success' THEN 1 END) AS sdpSuccess,
        COUNT(case WHEN cb_result='Success' THEN 1 end) as CallbackSuccess 
      FROM live_data
      WHERE dbDate >= ? AND dbDate <= ? ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
      ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
      ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 1
      ORDER BY dbDate
    `,
    params: queryParams,
    processor: (results: any[]) => {
      return results.map((row: any) => {
        return {
          date: formatDateForChart(row.dbDate),
          cpId: row.cpId,
          serviceId: row.serviceId,
          subscriptionDescription: row.subscriptionDescription,
          BannerDisplay: Number(row.BannerDisplay),
          CTA1: Number(row.CTA1),
          CTA2: Number(row.CTA2),
          sdpSuccess: Number(row.sdpSuccess),
          CallbackSuccess: Number(row.CallbackSuccess),
        };
      });
    },
  };
}
// Get SDP Error Distribution Query - For pie chart of error types
export function getSDPErrorDistributionQuery(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE conditions and parameter list
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?'];
  const queryParams: any[] = [startDateStr, endDateStr];

  // Filter tracking for SELECT/GROUP BY and response
  const selectedFilters: string[] = [];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
    selectedFilters.push('cpId');
  }

  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
    selectedFilters.push('serviceId');
  }

  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
    selectedFilters.push('subscriptionDescription');
  }

  return {
    name: 'sdpErrorDistribution',
    query: `
      SELECT 
        sdp_message,
        COUNT(*) AS count 
      FROM 
        live_data 
      WHERE 
        sdp_message NOT IN ('NA', 'Success')
        AND dbDate >= ? 
        AND dbDate <= ?
        ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
        ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
      ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 
        sdp_message
    `,
    params: queryParams,

    processor: (results: any[]) => {
      // Merge counts by sdp_message
      const grouped: Record<string, number> = {};

      results.forEach((row: any) => {
        const name = row.sdp_message;
        const count = Number(row.count);

        if (grouped[name]) {
          grouped[name] += count;
        } else {
          grouped[name] = count;
        }
      });

      // Convert back to array format for the pie chart
      return Object.entries(grouped).map(([name, value]) => ({
        name,
        value,
      }));
    },
  };
}

// Get Top 5 Traffic Source Query - For bar chart of top 5 traffic sources
export function getTop5BlockedTrafficSourceQuery(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE conditions and parameter list
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?'];
  const queryParams: any[] = [startDateStr, endDateStr];

  // Filter tracking for SELECT/GROUP BY and response
  const selectedFilters: string[] = [];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
    selectedFilters.push('cpId');
  }

  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
    selectedFilters.push('serviceId');
  }

  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
    selectedFilters.push('subscriptionDescription');
  }

  return {
    name: 'top5BlockedTrafficSource',
    query: `
      SELECT 
        dbDate,
        trafficSource,
        COUNT(*) AS count
      FROM live_data
      WHERE dbDate >= ? AND dbDate <= ? 
        AND botStatus = '1'
        ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
        ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
        ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 2
      ORDER BY 3 DESC
      LIMIT 5
    `,
    params: queryParams,
    processor: (results: any[]) => {
      return results.map((row: any) => ({
        dbDate: formatDateForChart(row.dbDate),
        trafficSource: row.trafficSource,
        count: Number(row.count),
      }));
    },
  };
}

// Get Top 5 Bot Services Query - For bar chart of top 5 services with bot traffic
export function getTop5BotServicesQuery(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE conditions and parameter list
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?'];
  const queryParams: any[] = [startDateStr, endDateStr];

  // Filter tracking for SELECT/GROUP BY and response
  const selectedFilters: string[] = [];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
    selectedFilters.push('cpId');
  }

  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
    selectedFilters.push('serviceId');
  }

  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
    selectedFilters.push('subscriptionDescription');
  }

  return {
    name: 'top5BotServices',
    query: `
      SELECT 
        dbDate,
        serviceName,
        COUNT(*) AS count
      FROM live_data
      WHERE dbDate >= ? AND dbDate <= ? 
        AND botStatus = '1'
        ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
        ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
        ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 2
      ORDER BY 3 DESC
      LIMIT 5
    `,
    params: queryParams,
    processor: (results: any[]) => {
      return results.map((row: any) => ({
        dbDate: formatDateForChart(row.dbDate),
        serviceName: row.serviceName,
        count: Number(row.count),
      }));
    },
  };
}

// Get Top 5 Blocked CP Query - For bar chart of top 5 CPs with blocked traffic
export function getTop5BlockedCPQueryy(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE conditions and parameter list
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?'];
  const queryParams: any[] = [startDateStr, endDateStr];

  // Filter tracking for SELECT/GROUP BY and response
  const selectedFilters: string[] = [];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
    selectedFilters.push('cpId');
  }

  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
    selectedFilters.push('serviceId');
  }

  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
    selectedFilters.push('subscriptionDescription');
  }

  return {
    name: 'top5BlockedCP',
    query: `
      SELECT 
        dbDate,
        cpId,
        COUNT(*) AS count
      FROM live_data
      WHERE dbDate >= ? AND dbDate <= ? 
        AND botStatus = '1' AND cpId != 'na'
        ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
        ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
        ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 2
      ORDER BY 3 DESC
      LIMIT 5
    `,
    params: queryParams,
    processor: (results: any[]) => {
      return results.map((row: any) => ({
        dbDate: formatDateForChart(row.dbDate),
        cpId: row.cpId,
        count: Number(row.count),
      }));
    },
  };
}

// Get Bot Reason Distribution Query - For showing distribution of bot detection reasons
export function getBotReasonQuery(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE conditions and parameter list
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?'];
  const queryParams: any[] = [startDateStr, endDateStr];

  // Filter tracking for SELECT/GROUP BY and response
  const selectedFilters: string[] = [];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
    selectedFilters.push('cpId');
  }

  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
    selectedFilters.push('serviceId');
  }

  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
    selectedFilters.push('subscriptionDescription');
  }

  return {
    name: 'botReason',
    query: `
      SELECT 
        botReason,
        COUNT(*) AS botCount
      FROM live_data 
      WHERE dbDate >= ? AND dbDate <= ?
        AND botReason != 'NA'
        ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
        ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
        ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    params: queryParams,
    processor: (results: any[]) => {
      return results.map((row: any) => ({
        name: row.botReason,
        value: Number(row.botCount),
      }));
    },
  };
}

// Get all queries for a given date range and CP filter
export function getAllQueries(params: QueryParams): QueryConfig[] {
  return [
    getBotStatusQuery(params),
    getSDPSuccessFailureQuery(params),
    getSubscriptionFlowQuery(params),
    getSDPErrorDistributionQuery(params),
    getTop5BlockedTrafficSourceQuery(params),
    getTop5BotServicesQuery(params),
    getTop5BlockedCPQuery(params),
    getBotReasonQuery(params),
  ];
}

// Execute all queries and return processed results
export async function executeAllQueries(
  mysqlService: any,
  params: QueryParams,
): Promise<{
  botStatusData: any[];
  SDPSuccessData: any[];
  SubscriptionFlowData: any[];
  SDPErrorDistributionData: any[];
  top5BlockedTrafficSourceData: any[];
  top5BotServicesData: any[];
  top5BlockedCPData: any[];
  botReasonData: any[];
}> {
  const queries = getAllQueries(params);

  try {
    const mysqlResults = await Promise.all(
      queries.map(async (queryConfig) => {
        try {
          console.log(`[DEBUG] Executing ${queryConfig.name} query`);
          const results = await mysqlService.query(queryConfig.query, queryConfig.params);
          // console.log(`[DEBUG] ${queryConfig.name} MySQL results:`, results);

          const processedData = queryConfig.processor(results);
          // console.log(`[DEBUG] Processed ${queryConfig.name} data:`, processedData);

          return {
            name: queryConfig.name,
            data: processedData,
          };
        } catch (error) {
          console.error(`[DEBUG] Error fetching ${queryConfig.name} data:`, error);
          return {
            name: queryConfig.name,
            data: [],
          };
        }
      }),
    );

    // Assign results to respective variables
    const botStatusResult = mysqlResults.find((result) => result.name === 'botStatus');
    const sdpResult = mysqlResults.find((result) => result.name === 'sdpSuccessFailure');
    const subscriptionFlowResult = mysqlResults.find(
      (result) => result.name === 'subscriptionFlow',
    );
    const sdpErrorDistributionResult = mysqlResults.find(
      (result) => result.name === 'sdpErrorDistribution',
    );
    const top5BlockedTrafficSourceResult = mysqlResults.find(
      (result) => result.name === 'top5BlockedTrafficSource',
    );
    const top5BotServicesResult = mysqlResults.find((result) => result.name === 'top5BotServices');
    const top5BlockedCPResult = mysqlResults.find((result) => result.name === 'top5BlockedCP');
    const botReasonResult = mysqlResults.find((result) => result.name === 'botReason');
    return {
      botStatusData: botStatusResult?.data || [],
      SDPSuccessData: sdpResult?.data || [],
      SubscriptionFlowData: subscriptionFlowResult?.data || [],
      SDPErrorDistributionData: sdpErrorDistributionResult?.data || [],
      top5BlockedTrafficSourceData: top5BlockedTrafficSourceResult?.data || [],
      top5BotServicesData: top5BotServicesResult?.data || [],
      top5BlockedCPData: top5BlockedCPResult?.data || [],
      botReasonData: botReasonResult?.data || [],
    };
  } catch (error) {
    console.error('[DEBUG] Error in MySQL queries execution:', error);
    return {
      botStatusData: [],
      SDPSuccessData: [],
      SubscriptionFlowData: [],
      SDPErrorDistributionData: [],
      top5BlockedTrafficSourceData: [],
      top5BotServicesData: [],
      top5BlockedCPData: [],
      botReasonData: [],
    };
  }
}

export async function getDashboardData(
  mysqlService: any,
  body: { start_date: string; end_date: string },
) {
  console.log('executing dashboard data');
  const { start_date, end_date } = body;
  console.log('the start date is: ', start_date);
  console.log('the end date is: ', end_date);

  // Assuming your table name is stored in process.env.DASHBOARD_TABLE and the date column is named 'date'
  const tableName = 'dashboard_summary';
  if (!tableName) {
    throw new Error('DASHBOARD_TABLE environment variable is not set');
  }

  // Try multiple approaches to handle timezone issues
  // First, let's try a simple date comparison that should work regardless of timezone
  const query = `
    SELECT *
    FROM \`${tableName}\`
    WHERE \`dbDate\` >= CONCAT(?, ' 00:00:00') 
    AND \`dbDate\` < CONCAT(DATE_ADD(?, INTERVAL 1 DAY), ' 00:00:00')
    ORDER BY \`dbDate\` ASC
  `;

  try {
    console.log('[DEBUG] Executing query:', query);
    console.log('[DEBUG] Query parameters:', [start_date, end_date]);
    console.log(
      '[DEBUG] Date types - start_date:',
      typeof start_date,
      'end_date:',
      typeof end_date,
    );

    const rows = await mysqlService.query(query, [start_date, end_date]);
    console.log('[DEBUG] Number of rows returned:', rows.length);

    // Log first row to understand data structure
    if (rows.length > 0) {
      console.log('[DEBUG] First row structure:', Object.keys(rows[0]));
      console.log('[DEBUG] First row dbDate value:', rows[0].dbDate);
      console.log('[DEBUG] First row dbDate type:', typeof rows[0].dbDate);
    }

    return rows;
  } catch (error) {
    console.error('Error fetching dashboard data from MySQL:', error);
    return [];
  }
}

export async function getTop5BlockedServicesQuery(
  mysqlService: any,
  params: QueryParams,
): Promise<{ data: { dbDate: string; serviceName: string; count: number }[] }> {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE clause and params array
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?', "botStatus = '1'"];
  const queryParams: any[] = [startDateStr, endDateStr];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
  }
  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
  }
  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
  }

  const query = `
    SELECT 
      dbDate,
      serviceName,
      COUNT(*) AS count
    FROM live_data
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY serviceName
    ORDER BY count DESC
    LIMIT 5
  `;

  const rows = await mysqlService.query(query, queryParams);

  // Ensure the return type matches the required format: dbDate: string; serviceName: string; count: number
  return (rows || []).map((row: any) => ({
    dbDate: String(row.dbDate),
    serviceName: String(row.serviceName),
    count: Number(row.count),
  }));
}

export function getTop5BlockedCPQuery(params: QueryParams): QueryConfig {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE clause and params array
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?', "botStatus = '1'"];
  const queryParams: any[] = [startDateStr, endDateStr];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
  }
  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
  }
  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
  }

  return {
    name: 'top5BlockedCP',
    query: `
      SELECT 
        dbDate,
        cpId,
        COUNT(*) AS count
      FROM live_data
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY cpId
      ORDER BY count DESC
      LIMIT 5
    `,
    params: queryParams,
    processor: (results: any[]) => {
      return results.map((row: any) => ({
        dbDate: formatDateForChart(row.dbDate),
        cpId: String(row.cpId),
        count: Number(row.count),
      }));
    },
  };
}

export async function getTop5BlockedTrafficSourceQueryy(
  mysqlService: any,
  params: QueryParams,
): Promise<{ data: { dbDate: string; cpId: string; count: number }[] }> {
  const { startDateStr, endDateStr, cpParam, serviceIdParam, subDescParam } = params;

  // Build dynamic WHERE clause and params array
  const whereClauses = ['dbDate >= ?', 'dbDate <= ?', "botStatus = '1'"];
  const queryParams: any[] = [startDateStr, endDateStr];

  if (cpParam && cpParam !== 'ALL') {
    whereClauses.push('cpId = ?');
    queryParams.push(cpParam);
  }
  if (serviceIdParam && serviceIdParam !== 'ALL') {
    whereClauses.push('serviceId = ?');
    queryParams.push(serviceIdParam);
  }
  if (subDescParam && subDescParam !== 'ALL') {
    whereClauses.push('subscriptionDescription = ?');
    queryParams.push(subDescParam);
  }

  const query = `
      SELECT 
        dbDate,
        trafficSource,
        COUNT(*) AS count
      FROM live_data
      WHERE dbDate >= ? AND dbDate <= ? ${cpParam && cpParam !== 'ALL' ? 'AND cpId = ?' : ''}
      ${serviceIdParam && serviceIdParam !== 'ALL' ? 'AND serviceId = ?' : ''}
      ${subDescParam && subDescParam !== 'ALL' ? 'AND subscriptionDescription = ?' : ''}
      GROUP BY 2
      ORDER BY 3 DESC
      LIMIT 5
  `;

  const rows = await mysqlService.query(query, queryParams);
  console.log('the rows are: ', rows);

  // Ensure the return type matches the required format: dbDate: string; serviceName: string; count: number
  return (rows || []).map((row: any) => ({
    dbDate: String(row.dbDate),
    trafficSource: row.trafficSource,
    count: Number(row.count),
  }));
}

export async function getFullTransactionByMfId(mysqlService: any, mfId: string) {
  const query = `
    SELECT * FROM nigeria_fullRecord WHERE mfId = ?
  `;
  const results = await mysqlService.query(query, [mfId]);

  console.log('the results are: ', results);
  return results[0];
}

export async function getFullTransactionBySequenceNo(
  mysqlService: any,
  sequenceNo: string,
  where: undefined | string = undefined,
) {
  let query = `
    SELECT * FROM nigeria_fullRecord WHERE sdp_transaction_id = ?
  `;
  if (where) {
    query += ` AND ${where}`;
  }

  const results = await mysqlService.query(query, [sequenceNo]);
  return results[0]?.fullRecord;
}

export async function updateManualCallback(mysqlService: any, mfId: string, cb: any) {
  try {
    // Use a MySQL transaction for both updates.
    // Assumes mysqlService has getConnection() (returns a connection with beginTransaction, commit, rollback, and query)

    const connection = await mysqlService.getConnection();
    let results;
    try {
      await connection.beginTransaction();
      // First update nigeria_fullRecord
      const updateFullRecordQuery = `
        UPDATE nigeria_fullRecord  
        SET fullRecord = CAST(? AS JSON)
        WHERE mfId = ?
      `;

      // cb is a JSON object, so we need to stringify it before storing in the DB
      results = await connection.query(updateFullRecordQuery, [JSON.stringify(cb), mfId]);

      // If the first update was successful, update transactions_nigeria as well.
      if (results.affectedRows === 0) {
        throw new Error('Failed to update nigeria_fullRecord');
      }
      const cb_sequenceNo = cb?.callbackData?.sequenceNo;
      const updateTxnQuery = `
          UPDATE transactions_nigeria 
          SET cb_sequenceNo = ?, cb_result = 'success'
          WHERE mfId = ?
        `;

      await connection.query(updateTxnQuery, [cb_sequenceNo, mfId]);
      await connection.commit();

      return results;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release && connection.release();
    }
  } catch (error) {
    console.error('[DEBUG] Error in MySQL query:', error);
    throw error;
  }
}

export async function getMfIdBySequenceNo(mysqlService: any, sId: string) {
  const query = `
    SELECT mfId FROM live_data WHERE sId = ? and cg2Clicked='1' and sdp_message='success'
  `;
  const results = await mysqlService.query(query, [sId]);
  console.log('the results are: ', results);
  return results[0].mfId;
}
