// DynamoDB table names
export const DYNAMODB_TABLES = {
  DASHBOARD_LOGINS: "mtn-nigeria-prod-dashboard-logins",
  CP_DETAILS: "mtn-nigeria-prod-cp-details",
  SERVICE_ID_DETAILS: "mtn-nigeria-prod-serviceId-details",
  CP_PRODUCTS: "mtn-nigeria-prod-cp-products",
  TRANSACTIONS: "mtn-nigeria-prod-transactions",
  DASHBOARD_LOG: "mtn-nigeria-prod-dashboard-logs",
  DASHBOARD_REAL_TIME_COUNTERS: "mtn-nigeria-prod-realtime-dashboard-counters",
  CP_ONBOARD_APPROVAL: "mtn-nigeria-prod-cp-onboard-status",
  // Add other table names here as needed
};

// S3 bucket name for storing assets
export const S3_BUCKET_NAME = "mtn-nigeria-prod-bucket";
export const S3_VERSION_BUCKET_NAME = "mtn-nigeria-backups";

// AWS region for all AWS SDK clients
export const AWS_REGION = (typeof process !== 'undefined' && process.env && process.env.AWS_REGION) ? process.env.AWS_REGION : "ap-south-1";

// Session secret for Remix session cookies
export const SESSION_SECRET = (typeof process !== 'undefined' && process.env && process.env.SESSION_SECRET) ? process.env.SESSION_SECRET : "prod_secret"; 