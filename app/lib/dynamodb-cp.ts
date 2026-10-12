import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { DYNAMODB_TABLES, AWS_REGION } from "./config";
import { getNextVersion } from "./version";
const client = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

export async function getAllCPs() {
  const { Items } = await docClient.send(
    new ScanCommand({ TableName: DYNAMODB_TABLES.CP_DETAILS })
  );
  return Items || [];
}

export async function getMaxCpid() {
  const items = await getAllCPs();
  const cpids = items
    .map(cp => parseInt(cp.cpid, 10))
    .filter(num => Number.isFinite(num));
  if (cpids.length === 0) return 1000;
  const max = Math.max(...cpids);
  return max;
}

function getNextCpidFromTopTwo(cpids: number[]) {
  if (cpids.length === 0) return 1001;
  if (cpids.length === 1) return cpids[0] + 1;

  const sortedDesc = [...cpids].sort((a, b) => b - a);
  const max = sortedDesc[0];
  const secondMax = sortedDesc[1];

  if (secondMax + 1 === max) return max + 1;
  return secondMax + 1;
}

export async function getCPByEmail(email: string) {
  const { Items } = await docClient.send(
    new ScanCommand({
      TableName: DYNAMODB_TABLES.CP_DETAILS,
      FilterExpression: "cpEmail = :email",
      ExpressionAttributeValues: {
        ":email": email.toLowerCase(),
      },
    })
  );
  return Items && Items.length > 0 ? Items[0] : null;
}

export async function getCPByCpid(cpid: string) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: DYNAMODB_TABLES.CP_DETAILS,
      Key: { cpid },
    })
  );
  return Item || null;
}

export async function createCP(cpData: { cpContact: string; cpEmail: string; cpName: string; aggregator?: string | undefined }) {
  const items = await getAllCPs();
  const cpids = items
    .map(cp => parseInt(cp.cpid, 10))
    .filter(num => Number.isFinite(num));
  const newCpid = getNextCpidFromTopTwo(cpids).toString();
  const createdAt = Math.floor(Date.now() / 1000);
  const newCP = { ...cpData, cpEmail: cpData.cpEmail.toLowerCase(), cpid: newCpid, createdAt, aggregator: cpData.aggregator || "", version: "v_0.00" };
  await docClient.send(
    new PutCommand({
      TableName: DYNAMODB_TABLES.CP_DETAILS,
      Item: newCP,
    })
  );
  return newCP;
}

export async function updateCP(cpid: string, cpData: { cpContact?: string; cpEmail?: string; cpName?: string; }) {
  const existing = await getCPByCpid(cpid);
  if (!existing) {
    throw new Error("CP not found");
  }
  const newVersion = getNextVersion(existing.version);
  const normalizedData = {
    ...cpData,
    ...(cpData.cpEmail && { cpEmail: cpData.cpEmail.toLowerCase() }),
    version: newVersion
  };
  const updateFields = Object.entries(normalizedData).filter(([_, v]) => v !== undefined);
  if (updateFields.length === 0) return;
  const updateExpr = "set " + updateFields.map(([k], i) => `#${k} = :v${i}`).join(", ");
  const exprAttrNames = Object.fromEntries(updateFields.map(([k], i) => [`#${k}`, k]));
  const exprAttrValues = Object.fromEntries(updateFields.map(([k, v], i) => [`:v${i}`, v]));
  await docClient.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.CP_DETAILS,
      Key: { cpid },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    })
  );
  return await getCPByCpid(cpid);
} 