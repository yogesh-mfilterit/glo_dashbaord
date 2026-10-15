// Server-side only configuration (not exposed to client bundle)
// This file should only be imported in server-side code (loaders, actions, etc.)

// MySQL database configuration
export const MYSQL_CONFIG = {
  HOST: "database-1.cwwjhfm2gg2l.ap-south-1.rds.amazonaws.com",
  USER: "admin",
  PASSWORD: "HWasok4h4VHRPzz065tx",
  DATABASE: "globacom_nigeria",
  // TABLE: "live_data",
   TABLE: "glo_transactions_nigeria",
  // Connection pool settings
  CONNECTION_LIMIT: 10,
  QUEUE_LIMIT: 0,
  ACQUIRE_TIMEOUT: 60000,
  TIMEOUT: 60000,
  RECONNECT: true
};

// Session secret for Remix session cookies
export const SESSION_SECRET = (typeof process !== 'undefined' && process.env && process.env.SESSION_SECRET) ? process.env.SESSION_SECRET : "prod_secret"; 