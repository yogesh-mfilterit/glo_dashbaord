// app/lib/cp/serviceids.server.ts
// Reads Service IDs from the existing DynamoDB table (default: glo-nigeria-dev-serviceId-details).
// Attribute names are guessed from your ProcessUi.js fields; override with env if yours differ.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

export const SERVICE_ID_TABLE = process.env.SERVICE_ID_TABLE || 'glo-nigeria-dev-serviceId-details';
const KEY_ATTR = process.env.SERVICE_ID_KEY || 'serviceId'; // attribute that holds the Service ID

const client = new DynamoDBClient({
  region: process.env.SERVICE_ID_REGION || process.env.AWS_REGION || 'us-west-2',
});
const doc = DynamoDBDocumentClient.from(client);

export type ServiceIdOption = { serviceId: string; serviceName: string; cpName: string };

const pick = (it: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (it[k] != null && it[k] !== '') return String(it[k]);
  return '';
};

let cache: { at: number; items: ServiceIdOption[] } | null = null;
const TTL = 60 * 1000;

export async function listServiceIds(force = false): Promise<ServiceIdOption[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.items;

  const raw: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(new ScanCommand({ TableName: SERVICE_ID_TABLE, ExclusiveStartKey }));
    raw.push(...((res.Items as Record<string, unknown>[]) || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const seen = new Set<string>();
  const items: ServiceIdOption[] = [];
  for (const it of raw) {
    const serviceId = pick(it, [KEY_ATTR, 'serviceId', 'serviceID', 'service_id', 'id']);
    if (!serviceId || seen.has(serviceId)) continue;
    seen.add(serviceId);
    items.push({
      serviceId,
      serviceName: pick(it, ['serviceIdName', 'serviceName', 'name']),
      cpName: pick(it, ['cpName', 'cpId', 'contentPartner', 'cp']),
    });
  }
  items.sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  cache = { at: Date.now(), items };
  return items;
}