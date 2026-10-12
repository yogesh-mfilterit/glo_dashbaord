import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AWS_REGION } from "./config";

const client = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuotaAction =
  | "create_cp"
  | "create_service_id"
  | "create_service_description"
  | "update";

interface QuotaConfig {
  limits: Record<QuotaAction, number>;
  bypassEmails: string[];
  fetchedAt: number;
}

interface CounterRecord {
  count: number;
  date: string; // "YYYY-MM-DD" — resets when date changes
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

// Config cache — fetched from DynamoDB every 1 hrs, but can be invalidated manually
const CONFIG_CACHE_TTL_MS = 60 * 60 * 1000;
let cachedConfig: QuotaConfig | null = null;

// Counter store — purely in-memory, resets on server restart or new UTC day
const counterStore = new Map<string, CounterRecord>();

// ─── Default limits ───────────────────────────────────────────────────────────

const DEFAULT_LIMITS: Record<QuotaAction, number> = {
  create_cp: 2,
  create_service_id: 2,
  create_service_description: 6,
  update: 5,
};

const CONFIG_TABLE = "mtn-nigeria-prod-dashboard-config-rate-limit";
const CONFIG_PK = "nigeria_rate_limit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function counterKey(email: string, action: QuotaAction): string {
  return `${email.toLowerCase()}::${action}`;
}

// ─── Config fetch (DynamoDB, cached 10 min) ───────────────────────────────────

async function getConfig(): Promise<QuotaConfig> {
  if (cachedConfig && Date.now() - cachedConfig.fetchedAt < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const { Item } = await docClient.send(
      new GetCommand({
        TableName: CONFIG_TABLE,
        Key: { nigeria_rate_limit: CONFIG_PK },
      })
    );

    if (Item?.limits && Item?.bypassEmails) {
      cachedConfig = {
        limits: { ...DEFAULT_LIMITS, ...Item.limits },
        bypassEmails: (Item.bypassEmails as string[]).map((e: string) => e.toLowerCase()),
        fetchedAt: Date.now(),
      };
      return cachedConfig;
    }
  } catch (err) {
    console.error("[QuotaLimiter] Failed to fetch config:", err);
  }

  // Fallback to defaults
  cachedConfig = { limits: DEFAULT_LIMITS, bypassEmails: [], fetchedAt: Date.now() };
  return cachedConfig;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check if the user has exceeded their daily quota for the given action.
 */
export async function checkQuota(
  email: string,
  action: QuotaAction
): Promise<{ allowed: boolean; message?: string }> {
  const config = await getConfig();

  if (config.bypassEmails.includes(email.toLowerCase())) {
    return { allowed: true };
  }

  const limit = config.limits[action];
  const key = counterKey(email, action);
  const today = todayUTC();
  const record = counterStore.get(key);

  const count = record?.date === today ? record.count : 0;

  if (count >= limit) {
    return {
      allowed: false,
      message: `Daily limit reached for this action (${limit} per day). Please try again tomorrow.`,
    };
  }

  return { allowed: true };
}

/**
 * Increment the in-memory usage counter for the given action.
 * Call this AFTER a successful create/update.
 */
export function incrementQuota(email: string, action: QuotaAction): void {
  const key = counterKey(email, action);
  const today = todayUTC();
  const record = counterStore.get(key);

  if (!record || record.date !== today) {
    counterStore.set(key, { count: 1, date: today });
  } else {
    record.count += 1;
  }
}

/**
 * Force refresh the cached config.
 */
export function invalidateQuotaCache(): void {
  cachedConfig = null;
}
