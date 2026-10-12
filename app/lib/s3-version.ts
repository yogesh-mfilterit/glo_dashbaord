import { S3Client, PutObjectCommand,ListObjectsV2Command,GetObjectCommand } from '@aws-sdk/client-s3';
import { isProd } from './config';

const s3 = new S3Client({ region: 'ap-south-1' });

export async function saveVersionToS3(
    bucketName: string,
    entityType: string,
    entityId: string,
    data: object
): Promise<string> {

    const version = (data as any).version;
    if (!version) {
        throw new Error(`Missing version field in data for ${entityType}/${entityId}`);
        return "v_0.00";
    }

    console.log(`[VERSION] Saving version ${version} ${isProd} for ${entityType}/${entityId} to S3...`);
    const s3Key = `${isProd ? "prod" : "dev"}/${entityType}/${entityId}/${version}.json`;

    await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: JSON.stringify(
            { ...data, _savedAt: new Date().toISOString() },
            null,
            2
        ),
        ContentType: 'application/json',
    }));

    console.log(`[VERSION] Saved ${s3Key}`);
    return version;
}