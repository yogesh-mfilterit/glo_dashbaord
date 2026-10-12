// app/lib/cp/s3.server.ts
// cp-packages/<folder>/Raw/...      -> ZIP contents as uploaded
// cp-packages/<folder>/Standard/... -> same files, index.html replaced by EJS template
import { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export const BUCKET = process.env.CP_PACKAGES_BUCKET || 'globacom-cp-packages';
export const RAW_DIR = 'Raw';
export const STANDARD_DIR = 'Standard';

// ProcessUi.js reads this bucket with CP_PACKAGES_REGION (default us-west-2)
const s3 = new S3Client({ region: process.env.CP_PACKAGES_REGION  || 'us-west-2' });

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function guessContentType(filename: string) {
  const ext = '.' + (filename.split('.').pop() || '').toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

export type PackageFile = { relPath: string; buffer: Buffer };

async function uploadFile(folder: string, subDir: string, relPath: string, buffer: Buffer) {
  const key = `cp-packages/${folder}/${subDir}/${relPath}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: guessContentType(relPath) }));
  return { bucket: BUCKET, key };
}

export async function uploadPackage(folder: string, files: PackageFile[], standardPages: Record<string, string> = {}) {
  const jobs: { subDir: string; relPath: string; buffer: Buffer }[] = [];
  files.forEach((f) => jobs.push({ subDir: RAW_DIR, relPath: f.relPath, buffer: f.buffer }));
  files.forEach((f) => {
    const buffer = f.relPath in standardPages ? Buffer.from(standardPages[f.relPath], 'utf8') : f.buffer;
    jobs.push({ subDir: STANDARD_DIR, relPath: f.relPath, buffer });
  });

  const CONCURRENCY = 8;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + CONCURRENCY).map((j) => uploadFile(folder, j.subDir, j.relPath, j.buffer)));
  }

  const standardKeys: Record<string, string> = {};
  Object.keys(standardPages).forEach((p) => (standardKeys[p] = `cp-packages/${folder}/${STANDARD_DIR}/${p}`));

  return {
    rawIndexKey: `cp-packages/${folder}/${RAW_DIR}/index.html`,
    standardIndexKey: `cp-packages/${folder}/${STANDARD_DIR}/index.html`,
    standardKeys,
  };
}

export async function deleteFolder(folder: string) {
  const prefix = `cp-packages/${folder}/`;
  let ContinuationToken: string | undefined;
  do {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken }));
    const objects = (list.Contents || []).map((o) => ({ Key: o.Key! }));
    if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } }));
    ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (ContinuationToken);
}
