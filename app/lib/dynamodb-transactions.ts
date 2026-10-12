import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DYNAMODB_TABLES, AWS_REGION } from "./config";
import { getServiceIdsByCpid } from "./dynamodb-serviceid";
import mysqlService from '~/lib/mysql.server';

const client = new DynamoDBClient({ region: AWS_REGION });
 export const docClient = DynamoDBDocumentClient.from(client);

function mapTransactionRow(tx: any) {
  let formattedDbDate = '';
  if (tx.dbDate instanceof Date) {
    const year = tx.dbDate.getFullYear();
    const month = String(tx.dbDate.getMonth() + 1).padStart(2, '0');
    const day = String(tx.dbDate.getDate()).padStart(2, '0');
    formattedDbDate = `${year}${month}${day}`;
  } else {
    formattedDbDate = String(tx.dbDate ?? '').replace(/-/g, '');
  }

  const tstamp = tx.tstamp !== undefined && tx.tstamp !== null
    ? Number(tx.tstamp)
    : null;

  let sdpResponse = null;
  if (tx.sdpResponse) {
    sdpResponse = typeof tx.sdpResponse === 'string'
      ? (() => { try { return JSON.parse(tx.sdpResponse); } catch { return null; } })()
      : tx.sdpResponse;
  } else {
    const sdpMessage = tx.sdp_message;
    const hasValidSdp =
      sdpMessage &&
      sdpMessage !== 'NA' &&
      sdpMessage !== 'null' &&
      sdpMessage !== 'NULL';
    sdpResponse = hasValidSdp
      ? { message: sdpMessage, success: sdpMessage === 'Success' }
      : null;
  }

  let callbackData = null;
  if (tx.callbackData) {
    callbackData = typeof tx.callbackData === 'string'
      ? (() => { try { return JSON.parse(tx.callbackData); } catch { return null; } })()
      : tx.callbackData;
  }

  const normaliseCg = (val: any): string | null => {
    if (val === 1 || val === '1' || val === true) return 'yes';
    if (val === 0 || val === '0' || val === false) return 'no';
    if (val === 'yes' || val === 'no') return val;
    return null;
  };

  return {
    mfId: tx.mfId,
    tstamp,
    msisdn: tx.msisdn,
    verifiedThrough: tx.verifiedThrough,
    dbDate: formattedDbDate,
    ipAddress: tx.ipAddress,
    trafficSource: tx.trafficSource,
    serviceId: tx.serviceId,
    serviceIdName: tx.serviceName ?? tx.serviceIdName ?? null,
    subscriptionDescription: tx.subscriptionDescription,
    botStatus: tx.botStatus !== undefined ? Number(tx.botStatus) : null,
    botReason: tx.botReason,
    cg1Clicked: normaliseCg(tx.cg1Clicked),
    cg2Clicked: normaliseCg(tx.cg2Clicked),
    cpId: tx.cpId,
    sdpResponse,
    callbackData,
  };
}


export async function getTransactionByMfId(mfId: string) {

  const query = `
    SELECT
      mfId,

      CAST(
        JSON_UNQUOTE(
          JSON_EXTRACT(fullRecord,'$.tstamp')
        ) AS UNSIGNED
      ) AS tstamp,

      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.msisdn'))          AS msisdn,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.verifiedThrough')) AS verifiedThrough,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.dbDate'))          AS dbDate,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.ipAddress'))       AS ipAddress,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.trafficSource'))   AS trafficSource,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.serviceId'))       AS serviceId,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.serviceIdName'))   AS serviceName,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.subscriptionDescription')) AS subscriptionDescription,

      CAST(
        JSON_UNQUOTE(
          JSON_EXTRACT(fullRecord,'$.botStatus')
        ) AS SIGNED
      ) AS botStatus,

      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.botReason'))  AS botReason,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.cg1Clicked')) AS cg1Clicked,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.cg2Clicked')) AS cg2Clicked,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.cpId'))       AS cpId,
      JSON_EXTRACT(fullRecord,'$.sdpResponse')              AS sdpResponse,
      JSON_EXTRACT(fullRecord,'$.callbackData')             AS callbackData

    FROM nigeria_fullRecord
    WHERE mfId = ?
    LIMIT 1
  `;

  const rows = await mysqlService.query(query, [mfId]);

  if (rows.length === 0) return null;

  const tx: any = rows[0];

  return mapTransactionRow(tx);
}
export async function getTransactionsByMsisdnAndDate(msisdn: string, dbDate: string) {


  const allTransactions: any[] = [];
  let lastEvaluatedKey: any = undefined;

  do {
    const queryParams: any = {
      TableName: DYNAMODB_TABLES.TRANSACTIONS,
      IndexName: "msisdn-dbDate-index",
      KeyConditionExpression: "msisdn = :msisdn",
      FilterExpression: "dbDate = :dbDate",
      ExpressionAttributeValues: {
        ":msisdn": msisdn,
        ":dbDate": dbDate,
      },
      ProjectionExpression: "mfId, tstamp, msisdn, verifiedThrough, dbDate, ipAddress, trafficSource, serviceId, serviceIdName, subscriptionDescription, botStatus, botReason, cg1Clicked, cg2Clicked, sdpResponse, callbackData",
    };

    if (lastEvaluatedKey) {
      queryParams.ExclusiveStartKey = lastEvaluatedKey;
    }

    const { Items, LastEvaluatedKey } = await docClient.send(new QueryCommand(queryParams));

    if (Items) {
      allTransactions.push(...Items);
    }

    lastEvaluatedKey = LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return allTransactions.sort((a, b) => b.tstamp - a.tstamp);
}

export async function getTransactionsByMsisdnAndDateRange(msisdn: string, startDate: string, endDate: string) {


  const allTransactions: any[] = [];
  let lastEvaluatedKey: any = undefined;

  do {
    const queryParams: any = {
      TableName: DYNAMODB_TABLES.TRANSACTIONS,
      IndexName: "msisdn-dbDate-index",
      KeyConditionExpression: "msisdn = :msisdn",
      FilterExpression: "dbDate BETWEEN :startDate AND :endDate",
      ExpressionAttributeValues: {
        ":msisdn": msisdn,
        ":startDate": startDate,
        ":endDate": endDate,
      },
      ProjectionExpression: "mfId, tstamp, msisdn, verifiedThrough, dbDate, ipAddress, trafficSource, serviceId, serviceIdName, subscriptionDescription, botStatus, botReason, cg1Clicked, cg2Clicked, sdpResponse, callbackData",
    };

    if (lastEvaluatedKey) {
      queryParams.ExclusiveStartKey = lastEvaluatedKey;
    }

    const { Items, LastEvaluatedKey } = await docClient.send(new QueryCommand(queryParams));

    if (Items) {
      allTransactions.push(...Items);
    }

    lastEvaluatedKey = LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return allTransactions.sort((a, b) => b.tstamp - a.tstamp);
}

export async function getTransactionsByMsisdnAndDateRangeWithCpidFilter(
  msisdn: string,
  startDate: string,
  endDate: string,
  cpid: string | null
) {

  let allowedServiceIds: string[] = [];

  if (cpid) {
    const servicesFromDynamo = await getServiceIdsByCpid(cpid);
    allowedServiceIds = servicesFromDynamo.map((s: any) => s.serviceId);

    if (allowedServiceIds.length === 0) return [];
  }

  let query = `
    SELECT
      mfId,

      CAST(
        JSON_UNQUOTE(
          JSON_EXTRACT(fullRecord,'$.tstamp')
        ) AS UNSIGNED
      ) AS tstamp,

      msisdn,
      dbDate,

      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.verifiedThrough')) AS verifiedThrough,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.ipAddress'))       AS ipAddress,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.trafficSource'))   AS trafficSource,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.serviceId'))       AS serviceId,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.serviceIdName'))   AS serviceName,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.subscriptionDescription')) AS subscriptionDescription,

      CAST(
        JSON_UNQUOTE(
          JSON_EXTRACT(fullRecord,'$.botStatus')
        ) AS SIGNED
      ) AS botStatus,

      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.botReason'))  AS botReason,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.cg1Clicked')) AS cg1Clicked,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.cg2Clicked')) AS cg2Clicked,
      JSON_UNQUOTE(JSON_EXTRACT(fullRecord,'$.cpId'))       AS cpId,

      JSON_EXTRACT(fullRecord,'$.sdpResponse')  AS sdpResponse,
      JSON_EXTRACT(fullRecord,'$.callbackData') AS callbackData

    FROM nigeria_fullRecord FORCE INDEX (idx_msisdn)

    WHERE
      msisdn = ?
      AND dbDate BETWEEN ? AND ?
  `;

  const params: any[] = [msisdn, startDate, endDate];

  if (allowedServiceIds.length > 0) {

    const placeholders =
      allowedServiceIds.map(() => '?').join(',');

    query += `
      AND JSON_UNQUOTE(
            JSON_EXTRACT(fullRecord,'$.serviceId')
          )
      IN (${placeholders})
    `;

    params.push(...allowedServiceIds);
  }

  query += `
    ORDER BY
    CAST(
      JSON_UNQUOTE(
        JSON_EXTRACT(fullRecord,'$.tstamp')
      ) AS UNSIGNED
    ) DESC
  `;




  const rows = await mysqlService.query(query, params);

  return rows.map((tx: any) => {

    let sdpResponse = null;
    let callbackData = null;

    if (tx.sdpResponse) {
      try {
        sdpResponse =
          typeof tx.sdpResponse === 'string'
            ? JSON.parse(tx.sdpResponse)
            : tx.sdpResponse;
      } catch {
        sdpResponse = null;
      }
    }

    if (tx.callbackData) {
      try {
        callbackData =
          typeof tx.callbackData === 'string'
            ? JSON.parse(tx.callbackData)
            : tx.callbackData;
      } catch {
        callbackData = null;
      }
    }

    return mapTransactionRow({
      ...tx,
      sdpResponse,
      callbackData
    });

  });
}
export async function updateTransaction(mfId: string, updateData: any) {


  try {
    // Build the update expression and attribute values
    const updateExpressions: string[] = [];
    const expressionAttributeValues: any = {};
    const expressionAttributeNames: any = {};

    // Handle callbackData update
    if (updateData.callbackData !== undefined) {
      updateExpressions.push('#callbackData = :callbackData');
      expressionAttributeNames['#callbackData'] = 'callbackData';
      expressionAttributeValues[':callbackData'] = updateData.callbackData;
    }

    // Add more fields here if needed in the future
    // if (updateData.someOtherField !== undefined) {
    //   updateExpressions.push('#someOtherField = :someOtherField');
    //   expressionAttributeNames['#someOtherField'] = 'someOtherField';
    //   expressionAttributeValues[':someOtherField'] = updateData.someOtherField;
    // }

    if (updateExpressions.length === 0) {
      throw new Error('No valid fields to update');
    }

    const updateExpression = 'SET ' + updateExpressions.join(', ');

    // Add callbackUpdated = 'manual' to the update expression
    updateExpressions.push('#callbackUpdated = :callbackUpdated');
    expressionAttributeNames['#callbackUpdated'] = 'callbackUpdated';
    expressionAttributeValues[':callbackUpdated'] = 'manual';

    const updateParams = {
      TableName: DYNAMODB_TABLES.TRANSACTIONS,
      Key: { mfId },
      UpdateExpression: 'SET ' + updateExpressions.join(', '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW' as const
    };


    const result = await docClient.send(new UpdateCommand(updateParams));


    return result.Attributes;
  } catch (error) {
    console.error('[DYNAMODB] Error updating transaction:', error);
    throw error;
  }
} 