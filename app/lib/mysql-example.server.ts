import mysqlService from './mysql.server';

/**
 * Example usage of MySQL service in server actions and loaders
 * This file demonstrates how to use the MySQL service in Remix server-side code
 */

// Example: Get all records from a table
export async function getAllRecords() {
  try {
    const records = await mysqlService.query('SELECT * FROM live_data LIMIT 100');
    return { success: true, data: records };
  } catch (error) {
    console.error('Error fetching records:', error);
    return { success: false, error: 'Failed to fetch records' };
  }
}

// Example: Get a single record by ID
export async function getRecordById(id: string) {
  try {
    const record = await mysqlService.queryOne(
      'SELECT * FROM live_data WHERE mfId = ?',
      [id]
    );
    return { success: true, data: record };
  } catch (error) {
    console.error('Error fetching record:', error);
    return { success: false, error: 'Failed to fetch record' };
  }
}

// Example: Check if a record exists
export async function recordExists(id: string) {
  try {
    const exists = await mysqlService.exists('live_data', { mfId: id });
    return { success: true, exists };
  } catch (error) {
    console.error('Error checking record existence:', error);
    return { success: false, error: 'Failed to check record existence' };
  }
}

// Example: Get connection status
export function getConnectionStatus() {
  return mysqlService.getStatus();
}

// Example: Complex query with joins
export async function getRecordsWithDetails() {
  try {
    const records = await mysqlService.query(`
      SELECT 
        l.*,
        u.username,
        u.email
      FROM live_data l
      LEFT JOIN users u ON l.userId = u.id
      WHERE l.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY l.created_at DESC
      LIMIT 50
    `);
    return { success: true, data: records };
  } catch (error) {
    console.error('Error fetching records with details:', error);
    return { success: false, error: 'Failed to fetch records with details' };
  }
}

// Example: Transaction example
export async function performTransaction() {
  try {
    const pool = mysqlService.getPool();
    const connection = await pool.getConnection();
    
    await connection.beginTransaction();
    
    try {
      // Perform multiple operations
      await connection.execute('INSERT INTO live_data (mfId, status) VALUES (?, ?)', ['test123', 'active']);
      await connection.execute('UPDATE live_data SET status = ? WHERE mfId = ?', ['completed', 'test123']);
      
      await connection.commit();
      connection.release();
      
      return { success: true, message: 'Transaction completed successfully' };
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('Transaction failed:', error);
    return { success: false, error: 'Transaction failed' };
  }
} 