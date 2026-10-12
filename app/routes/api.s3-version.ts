import { json } from "@remix-run/node";
import { getS3Versions } from "../lib/s3-logs";

export async function action({ request }: any) {
  const body = await request.json();
  // console.log("PAYLOAD RECEIVED:", JSON.stringify(body.payload, null, 2));
  const environment =
    typeof process !== 'undefined' && process.env && process.env.NODE_ENV
      ? process.env.NODE_ENV
      : 'development';
  const isProd = environment === 'production';
  const data = await getS3Versions(body.payload, isProd); // prod/dev
  //console.log("S3 RESULT:", JSON.stringify(data, null, 2));
  return json(data);
}
