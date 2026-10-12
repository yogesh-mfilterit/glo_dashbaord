import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: "ap-south-1" });

const BUCKET = "mtn-nigeria-backups";

// 🔹 Extract version
function extractVersion(key: string): number {
  const fileName = key.split("/").pop(); // v_0.05.json
  const match = fileName?.match(/v_(\d+\.\d+)/);
  return match ? parseFloat(match[1]) : 0;
}

// 🔹 Read file
async function getFileData(key: string) {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );

  const data = await res.Body?.transformToString();
  return data ? JSON.parse(data) : null;
}

// 🔹 Extract entity from payload
function getEntityDetails(payload: any) {
  if (payload?.cpid) {
    return { entityType: "content-partners", entityId: payload.cpid };
  }

   if (payload?.subscriptionId_subscriptionDescription) {
    // const entityId = payload.subscriptionId_subscriptionDescription.split("_")[0];
    return { entityType: "service-description", entityId: payload.subscriptionId_subscriptionDescription };
  }


  if (payload?.serviceId) {
    return { entityType: "service-ids", entityId: payload.serviceId };
  }

  return null;
}

// 🔥 MAIN FUNCTION
export async function getS3Versions(payload: any, isProd: boolean) {
  const env = isProd ? "prod" : "dev";

  const details = getEntityDetails(payload);
  if (!details) return null;

  const { entityType, entityId } = details;

  const prefix = `${env}/${entityType}/${entityId}/`;

  const list = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
    })
  );

  const files = list.Contents || [];

  const sorted = files
    .filter((f) => f.Key)
    .sort((a, b) => {
      const vA = extractVersion(a.Key!);
      const vB = extractVersion(b.Key!);
      return vA - vB;
    });

  const latestKey = sorted.at(-1)?.Key;
  const previousKey = sorted.at(-2)?.Key;

  return {
    latestVersion: latestKey?.split("/").pop(),
    previousVersion: previousKey?.split("/").pop(),
    latestData: latestKey ? await getFileData(latestKey) : null,
    previousData: previousKey ? await getFileData(previousKey) : null,
  };
}