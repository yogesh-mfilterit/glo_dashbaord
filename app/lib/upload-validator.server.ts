import type { UploadHandler } from '@remix-run/node';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// Magic bytes signatures for allowed image formats
const MAGIC_SIGNATURES: { bytes: number[]; mime: string }[] = [
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { bytes: [0x47, 0x49, 0x46], mime: 'image/gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' }, // RIFF....WEBP
];

export function detectMimeFromBuffer(buf: Buffer): string | null {
  for (const { bytes, mime } of MAGIC_SIGNATURES) {
    if (bytes.every((b, i) => buf[i] === b)) return mime;
  }
  return null;
}

export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/.*[\\/]/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = base.slice(base.lastIndexOf('.')).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? base : base + '.bin';
}

/**
 * Creates a validated S3 upload handler for banner images.
 * Validates magic bytes, MIME type, file size, and sanitizes filename.
 *
 * @param s3 - S3Client instance
 * @param bucket - S3 bucket name
 * @param keyPrefix - S3 key prefix (e.g. 'service-banners' or 'service-description-banners')
 */
export function createBannerUploadHandler(
  s3: S3Client,
  bucket: string,
  keyPrefix: string,
): UploadHandler {
  return async ({ name, filename, contentType, data }) => {
    if (name !== 'banner' || !filename) return undefined;

    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of data) {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE_BYTES) {
        throw new Error('File size exceeds 5 MB limit');
      }
      chunks.push(chunk);
    }

    const fileBuffer = Buffer.concat(chunks);

    // Validate actual file content via magic bytes — rejects HTML, SVG, etc.
    const detectedMime = detectMimeFromBuffer(fileBuffer);
    if (!detectedMime || !ALLOWED_IMAGE_MIME_TYPES.has(detectedMime)) {
      throw new Error(
        'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.',
      );
    }

    // Secondary check: browser-supplied content-type must also be an image
    if (contentType && !ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
      throw new Error('Invalid content type.');
    }

    const safeFilename = sanitizeFilename(filename);
    const key = `${keyPrefix}/${safeFilename}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: detectedMime,         // use server-detected, not browser-supplied
        ContentDisposition: 'inline',
        Metadata: { 'x-content-type-options': 'nosniff' },
      }),
    );

    return `https://${bucket}.s3.amazonaws.com/${key}`;
  };
}
