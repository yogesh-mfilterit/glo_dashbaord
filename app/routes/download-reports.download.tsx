import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { AWS_REGION } from "../lib/config";
import { fullAuthGuard } from "~/util/authGuard";

export async function loader({ request }: LoaderFunctionArgs) {
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get("filename");
  const dbDate = url.searchParams.get("dbDate");
  
  if (!filename || !dbDate) {
    return redirect("/download-reports?error=Missing filename or date");
  }

  try {
    // Download file from S3 and serve to user
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    
    const s3Client = new S3Client({ region: AWS_REGION });

    const command = new GetObjectCommand({
      Bucket: 'mtn-nigeria-prod-data-bucket',
      Key: `data_dump/${filename}`
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('File body is empty');
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const reader = response.Body.transformToWebStream().getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const buffer = Buffer.concat(chunks);

    // Return file as download response with explicit save dialog
    return new Response(buffer, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    return redirect("/download-reports?error=Failed to download file");
  }
} 