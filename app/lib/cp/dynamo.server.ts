// app/lib/cp/dynamo.server.ts
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

export const TABLE = process.env.CP_TABLE || 'cp-onboarding';

export type CpRecord = {
  id: string;
  cpId: string;
  method: 'A' | 'B';
  status: 'draft' | 'uat' | 'live';
  cpName: string;
  serviceName: string;
  serviceText?: string;
  price?: string;
  period?: string;
  trial?: number;
  banner?: string;
  support?: string;
  shortcode?: string;
  consent?: string;
  folder?: string;
  pages?: string[];
  s3Prefix?: string | null;
  rawIndexKey?: string;
  standardIndexKey?: string;
  standardKeys?: Record<string, string>;
  warnings?: string[];
  createdAt: number;
  updatedAt: number;
  [k: string]: unknown;
};

const client = new DynamoDBClient({ region: 'us-west-2' });
const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

const toMs = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v ?? '')) || 0);

export async function putCp(item: Partial<CpRecord>): Promise<CpRecord> {
  const id = item.id || item.cpId || randomUUID();
  const cpItem = { ...item, id, cpId: item.cpId || id } as CpRecord;
  await doc.send(new PutCommand({ TableName: TABLE, Item: cpItem }));
  return cpItem;
}

export async function getCp(id: string): Promise<CpRecord | null> {
  const res = await doc.send(new GetCommand({ TableName: TABLE, Key: { id } }));
  return (res.Item as CpRecord) || null;
}

export async function listCps(): Promise<CpRecord[]> {
  const items: CpRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    items.push(...((res.Items as CpRecord[]) || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
}

export async function updateCp(id: string, patch: Record<string, unknown>): Promise<CpRecord | null> {
  const keys = Object.keys(patch).filter((k) => k !== 'id');
  if (!keys.length) return getCp(id);

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  keys.forEach((k, i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = patch[k];
  });

  const res = await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { id },
      UpdateExpression: 'SET ' + keys.map((_, i) => `#k${i} = :v${i}`).join(', '),
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return res.Attributes as CpRecord;
}

export async function deleteCp(id: string) {
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
}
