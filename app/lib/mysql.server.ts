import mysql from 'mysql2/promise';
import { MYSQL_CONFIG } from './server-config';

/**
 * MySQL Service with Connection Pool Management
 * This service is server-side only and provides a connection pool for MySQL operations
 */
class MySQLService {
  private pool: mysql.Pool | null = null;
  private isConnected: boolean = false;
  private static instance: MySQLService;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): MySQLService {
    if (!MySQLService.instance) {
      MySQLService.instance = new MySQLService();
    }
    return MySQLService.instance;
  }

  /**
   * Initialize MySQL connection pool
   */
  async init(): Promise<void> {
    try {
      console.log('Initializing MySQL connection pool...');

      this.pool = mysql.createPool({
        host: MYSQL_CONFIG.HOST,
        user: MYSQL_CONFIG.USER,
        password: MYSQL_CONFIG.PASSWORD,
        database: MYSQL_CONFIG.DATABASE,
        waitForConnections: true,
        connectionLimit: MYSQL_CONFIG.CONNECTION_LIMIT,
        queueLimit: MYSQL_CONFIG.QUEUE_LIMIT,
        acquireTimeout: MYSQL_CONFIG.ACQUIRE_TIMEOUT,
        timeout: MYSQL_CONFIG.TIMEOUT,
        reconnect: MYSQL_CONFIG.RECONNECT,
      });

      // Test the connection
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();

      this.isConnected = true;
      console.log('MySQL connection pool initialized successfully');
    } catch (error) {
      console.error('Failed to initialize MySQL connection pool:', error);
      throw error;
    }
  }

  /**
   * Get connection pool
   */
  getPool(): mysql.Pool {
    if (!this.pool || !this.isConnected) {
      throw new Error('MySQL connection pool not initialized');
    }
    return this.pool;
  }

  /**
   * Execute a query
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    try {
      if (!this.isConnected) {
        await this.init();
      }

      const [rows] = await this.pool!.execute(sql, params);
      return rows as T[];
    } catch (error) {
      console.error('MySQL query execution failed:', error);
      throw error;
    }
  }

  /**
   * Execute a single row query
   */
  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Insert a record
   */
  async insert(table: string, data: Record<string, any>): Promise<mysql.ResultSetHeader> {
    try {
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = columns.map(() => '?').join(', ');

      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
      const [result] = await this.pool!.execute(sql, values);

      return result as mysql.ResultSetHeader;
    } catch (error) {
      console.error('MySQL insert failed:', error);
      throw error;
    }
  }

  /**
   * Update a record
   */
  async update(
    table: string,
    data: Record<string, any>,
    where: Record<string, any>,
  ): Promise<mysql.ResultSetHeader> {
    try {
      const setColumns = Object.keys(data)
        .map((key) => `${key} = ?`)
        .join(', ');
      const whereColumns = Object.keys(where)
        .map((key) => `${key} = ?`)
        .join(' AND ');

      const sql = `UPDATE ${table} SET ${setColumns} WHERE ${whereColumns}`;
      const values = [...Object.values(data), ...Object.values(where)];

      const [result] = await this.pool!.execute(sql, values);
      return result as mysql.ResultSetHeader;
    } catch (error) {
      console.error('MySQL update failed:', error);
      throw error;
    }
  }

  /**
   * Delete a record
   */
  async delete(table: string, where: Record<string, any>): Promise<mysql.ResultSetHeader> {
    try {
      const whereColumns = Object.keys(where)
        .map((key) => `${key} = ?`)
        .join(' AND ');
      const sql = `DELETE FROM ${table} WHERE ${whereColumns}`;
      const values = Object.values(where);

      const [result] = await this.pool!.execute(sql, values);
      return result as mysql.ResultSetHeader;
    } catch (error) {
      console.error('MySQL delete failed:', error);
      throw error;
    }
  }

  /**
   * Check if a record exists
   */
  async exists(table: string, where: Record<string, any>): Promise<boolean> {
    try {
      const whereColumns = Object.keys(where)
        .map((key) => `${key} = ?`)
        .join(' AND ');
      const sql = `SELECT 1 FROM ${table} WHERE ${whereColumns} LIMIT 1`;
      const values = Object.values(where);

      const results = await this.query(sql, values);
      return results.length > 0;
    } catch (error) {
      console.error('MySQL exists check failed:', error);
      throw error;
    }
  }

  /**
   * Get connection status
   */
  getStatus(): { isConnected: boolean; poolSize?: number } {
    return {
      isConnected: this.isConnected,
      poolSize: this.pool?.config.connectionLimit,
    };
  }

  /**
   * Get a connection from the pool
   */
  async getConnection(): Promise<mysql.PoolConnection> {
    if (!this.isConnected) {
      await this.init();
    }

    return this.pool!.getConnection();
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    try {
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
        this.isConnected = false;
        console.log('MySQL connection pool closed successfully');
      }
    } catch (error) {
      console.error('Error closing MySQL connection pool:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const mysqlService = MySQLService.getInstance();

// Initialize the service when this module is imported
mysqlService.init().catch((error) => {
  console.error('Failed to initialize MySQL service:', error);
});

export default mysqlService;
