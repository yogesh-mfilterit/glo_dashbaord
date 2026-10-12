import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getSession } from "../lib/session.server";
import { AWS_REGION } from "../lib/config";
import { fullAuthGuard } from "~/util/authGuard";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = await fullAuthGuard(request);
  if (!isAuthenticated) {
    return redirect("/login?message=login%20required");
  }

  const userRole = session.get("role") || null;
  if (userRole !== "cp") {
    return redirect("/download-reports?message=access%20denied");
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get("filename");
  const dbDate = url.searchParams.get("dbDate");
  
  if (!filename || !dbDate) {
    return redirect("/cp-download-reports?error=Missing filename or date");
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
    return redirect("/cp-download-reports?error=Failed to download file");
  }
} 