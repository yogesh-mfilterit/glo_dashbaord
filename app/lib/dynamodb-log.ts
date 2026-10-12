import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand,ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DYNAMODB_TABLES } from "./config";
import { docClient } from "./aws.server";
import { isProd } from "./config";



export interface DashboardLogEntry {
  dbDate: string;
  tstamp: number; 
  tablename: string;
  action: string;
  payload: any; 
  ipAddress: string;
  email: string; 
}

  export async function getDashboardLogs(): Promise<DashboardLogEntry[]> {
    try {
      // const envPrefix = isProd ? 'mtn-nigeria-prod' : 'mtn-nigeria-dev';

      // const result = await docClient.send(
      //   new ScanCommand({
      //     TableName: DYNAMODB_TABLES.DASHBOARD_LOG,
      //     FilterExpression: 'contains(tablename, :envPrefix)',
      //     ExpressionAttributeValues: {
      //       ':envPrefix': envPrefix,
      //     },
      //   })
      // );
      const envPrefix = isProd ? 'prod' : 'dev';

  let items: DashboardLogEntry[] = [];
      let lastEvaluatedKey: any = undefined;

      do {
        const result = await docClient.send(
          new ScanCommand({
            TableName: DYNAMODB_TABLES.DASHBOARD_LOG,
            FilterExpression:
              'tablename = :cpDetails OR tablename = :cpProducts OR tablename = :serviceIds OR tablename = :dashboardLogins',
            ExpressionAttributeValues: {
              ':cpDetails':  `mtn-nigeria-${envPrefix}-cp-details`,
              ':cpProducts': `mtn-nigeria-${envPrefix}-cp-products`,
              ':serviceIds': `mtn-nigeria-${envPrefix}-serviceId-details`,
              ':dashboardLogins': `mtn-nigeria-${envPrefix}-dashboard-logins`,
            },
            ExclusiveStartKey: lastEvaluatedKey,
          })
        );

        items.push(...(result.Items as DashboardLogEntry[] || []));
        lastEvaluatedKey = result.LastEvaluatedKey;

      } while (lastEvaluatedKey);

      return items;
    } catch (error) {
      console.error(`[DASHBOARD_LOG] Error fetching logs:`, error);
      return [];
    }
  }

export async function logDashboardActivity(
  tablename: string,
  action: string,
  payload: any,
  ipAddress: string,
  email: string
): Promise<void> {
  try {
    const now = new Date();
    const dbDate = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0');

    const tstamp = Math.floor(now.getTime() / 1000); // Unix epoch in seconds
    const logEntry: DashboardLogEntry = {
      dbDate,
      tstamp,
      tablename,
      action,
      payload,
      ipAddress,
      email,
    };




    await docClient.send(
      new PutCommand({
        TableName: DYNAMODB_TABLES.DASHBOARD_LOG,
        Item: logEntry,
      })
    );


  } catch (error) {
    console.error(`[DASHBOARD_LOG] Error logging activity:`, error);
    console.error(`[DASHBOARD_LOG] Error details:`, {
      message: error instanceof Error ? error.message : 'Unknown error',
      code: (error as any)?.code,
      statusCode: (error as any)?.statusCode,
      tableName: DYNAMODB_TABLES.DASHBOARD_LOG
    });
    // Don't throw error to avoid breaking the main operation
  }
}



export interface CpOnboardApprovalLogEntry {
  dbDate: string; // YYYYMMDD format
  tstamp: number; // Unix epoch timestamp
  action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "APPROVE_BULK" | "REJECT_BULK";
  subscriptionId_subscriptionDescription: string;
  payload: any; // The actual record object or {email} for log
  ipAddress: string; // IP address of user
  isLive: any; // Whether the product is live
  email: string; // Email of user performing the action
}

export async function logCpOnboardApprovalActivity(
  action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "APPROVE_BULK" | "REJECT_BULK",
  subscriptionId_subscriptionDescription: string,
  payload: any,
  ipAddress: string,
  isLive: any,
  email: string,
  // email: string,
): Promise<void> {
  try {
    // Only log if action is "CREATE" or "UPDATE"
    if (!["CREATE", "UPDATE", "APPROVE", "REJECT", "APPROVE_BULK", "REJECT_BULK"].includes(action)) {
      return;
    }

    const now = new Date();
    const dbDate = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0');

    const tstamp = Math.floor(now.getTime() / 1000); // Unix epoch in seconds

    const logEntry: CpOnboardApprovalLogEntry = {
      dbDate,
      tstamp,
      action,
      email,
      subscriptionId_subscriptionDescription,
      payload,
      ipAddress,
      isLive
    };

    await docClient.send(
      new PutCommand({
        TableName: DYNAMODB_TABLES.CP_ONBOARD_APPROVAL,
        Item: logEntry,
      })
    );

  } catch (error) {
    console.error(`[CP_ONBOARD_APPROVAL_LOG] Error logging activity:`, error);
    console.error(`[CP_ONBOARD_APPROVAL_LOG] Error details:`, {
      message: error instanceof Error ? error.message : 'Unknown error',
      code: (error as any)?.code,
      statusCode: (error as any)?.statusCode,
      tableName: DYNAMODB_TABLES.CP_ONBOARD_APPROVAL
    });
    // Don't throw error to avoid breaking the main operation
  }
}

export function getClientIP(request: Request): string {
  // Try to get IP from various headers
  const forwarded = request.headers.get("x-forwarded-for");
  const realIP = request.headers.get("x-real-ip");
  const cfConnectingIP = request.headers.get("cf-connecting-ip");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  if (realIP) {
    return realIP;
  }
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  // Fallback to a default value if no IP is found
  return "unknown";
} 