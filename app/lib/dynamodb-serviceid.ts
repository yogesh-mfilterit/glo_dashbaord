import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { DYNAMODB_TABLES, AWS_REGION } from "./config";
import { docClient } from "./aws.server";
import { getNextVersion } from "./version";




export async function getAllServiceIds() {
  const { Items } = await docClient.send(
    new ScanCommand({ TableName: DYNAMODB_TABLES.SERVICE_ID_DETAILS })
  );
  return Items || [];
}

export async function getAllServiceIdDeatilsByServiceId(serviceId: string) {
  const { Items } = await docClient.send(
    new ScanCommand({
      TableName: DYNAMODB_TABLES.SERVICE_ID_DETAILS,
      FilterExpression: "serviceId = :serviceId",
      ExpressionAttributeValues:
      {
        ":serviceId": serviceId
      }
    })
  );
  return Items || [];
}

export async function getServiceIdsByCpid(cpid: string) {
  const { Items } = await docClient.send(
    new ScanCommand({
      TableName: DYNAMODB_TABLES.SERVICE_ID_DETAILS,
      FilterExpression: "cpId = :cpid",
      ExpressionAttributeValues: {
        ":cpid": cpid,
      },
    })
  );
  return Items || [];
}

export async function createServiceId(serviceIdData: { serviceId: string; cpId: string; serviceIdName: string; serviceIdText?: string; bannerUrl?: string; scriptTags?: string; bodyScriptTags?: string; }) {
  const createdAt = Math.floor(Date.now() / 1000);
  const newServiceId = { ...serviceIdData, createdAt, version: "v_0.00" };
  await docClient.send(
    new PutCommand({
      TableName: DYNAMODB_TABLES.SERVICE_ID_DETAILS,
      Item: newServiceId,
    })
  );
  return newServiceId;
}

export async function updateServiceId(serviceId: string, serviceIdData: { cpId?: string; serviceIdName?: string; serviceIdText?: string; bannerUrl?: string; scriptTags?: string; bodyScriptTags?: string; isLive?: boolean; rejected?: boolean; }) {

  // remove bannerURL if it is undefined or null
  // banner is a mandatory thing when we create a new serviceID, but it not mandatory when we update a serviceID
  const { Item: existing } = await docClient.send(
    new GetCommand({
      TableName: DYNAMODB_TABLES.SERVICE_ID_DETAILS,
      Key: { serviceId },
    })
  );

  if (!existing) {
    throw new Error("ServiceId not found");
  }
  const newVersion = getNextVersion(existing.version);
  if (serviceIdData.bannerUrl === undefined || serviceIdData.bannerUrl === null || serviceIdData.bannerUrl === '') {
    delete serviceIdData.bannerUrl;
  }
  // Only update provided fields (not undefined or null)
  const updateFields = Object.entries({ ...serviceIdData, version: newVersion }).filter(([_, v]) => v !== undefined && v !== null);
  if (updateFields.length === 0) return existing;
  const updateExpr = "set " + updateFields.map(([k], i) => `#${k} = :v${i}`).join(", ");
  const exprAttrNames = Object.fromEntries(updateFields.map(([k], i) => [`#${k}`, k]));
  const exprAttrValues = Object.fromEntries(updateFields.map(([k, v], i) => [`:v${i}`, v]));
  await docClient.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.SERVICE_ID_DETAILS,
      Key: { serviceId },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    })
  );
  const { Item: updatedServiceId } = await docClient.send(
    new GetCommand({
      TableName: DYNAMODB_TABLES.SERVICE_ID_DETAILS,
      Key: { serviceId },
    })
  );
  return updatedServiceId || null;
} 