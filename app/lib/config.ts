// Environment-aware configuration loader
import * as devConfig from './dev-config';
import * as prodConfig from './prod-config';

// Get environment from environment variable, default to 'dev'

const environment = typeof process !== 'undefined' && process.env && process.env.NODE_ENV
    ? process.env.NODE_ENV
    : 'development';

console.log(process.env.environment, process.env.NODE_ENV);
// Select the appropriate configuration based on environment
const config = environment === 'production' ? prodConfig : devConfig;

// Export all configuration values
export const { DYNAMODB_TABLES, S3_BUCKET_NAME, S3_VERSION_BUCKET_NAME, AWS_REGION, SESSION_SECRET } = config;

export const isProd = environment === 'production';
// Export the current environment for debugging purposes
export const CURRENT_ENVIRONMENT = environment;
