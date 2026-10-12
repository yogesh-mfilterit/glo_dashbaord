# MySQL Service Documentation

## Overview

The MySQL service provides a connection pool for server-side MySQL operations in the Remix application. It's designed to be initialized once at application startup and reused across all server actions and loaders.

## Features

- ✅ **Connection Pool Management** - Efficient connection reuse
- ✅ **Singleton Pattern** - Single instance across the application
- ✅ **Auto-initialization** - Connects automatically when imported
- ✅ **TypeScript Support** - Full type safety
- ✅ **Error Handling** - Comprehensive error management
- ✅ **Transaction Support** - Full transaction capabilities
- ✅ **Server-side Only** - Secure, never exposed to client

## Quick Start

### 1. Import the Service

```typescript
import mysqlService from '~/lib/mysql.server';
```

### 2. Basic Usage

```typescript
// Simple query
const records = await mysqlService.query('SELECT * FROM live_data LIMIT 10');

// Query with parameters
const user = await mysqlService.queryOne(
  'SELECT * FROM live_data WHERE mfId = ?',
  ['user123']
);

// Insert record
const result = await mysqlService.insert('live_data', {
  mfId: 'user123',
  status: 'active',
  created_at: new Date()
});

// Update record
const updateResult = await mysqlService.update(
  'live_data',
  { status: 'completed' },
  { mfId: 'user123' }
);

// Delete record
const deleteResult = await mysqlService.delete('live_data', { mfId: 'user123' });

// Check if record exists
const exists = await mysqlService.exists('live_data', { mfId: 'user123' });
```

## API Reference

### Core Methods

#### `query<T>(sql: string, params?: any[]): Promise<T[]>`
Execute a query and return multiple rows.

```typescript
const records = await mysqlService.query<LiveDataRecord>(
  'SELECT * FROM live_data WHERE status = ?',
  ['active']
);
```

#### `queryOne<T>(sql: string, params?: any[]): Promise<T | null>`
Execute a query and return a single row.

```typescript
const record = await mysqlService.queryOne<LiveDataRecord>(
  'SELECT * FROM live_data WHERE mfId = ?',
  ['user123']
);
```

#### `insert(table: string, data: Record<string, any>): Promise<ResultSetHeader>`
Insert a new record.

```typescript
const result = await mysqlService.insert('live_data', {
  mfId: 'user123',
  status: 'active',
  created_at: new Date()
});
console.log('Insert ID:', result.insertId);
```

#### `update(table: string, data: Record<string, any>, where: Record<string, any>): Promise<ResultSetHeader>`
Update existing records.

```typescript
const result = await mysqlService.update(
  'live_data',
  { status: 'completed' },
  { mfId: 'user123' }
);
console.log('Affected rows:', result.affectedRows);
```

#### `delete(table: string, where: Record<string, any>): Promise<ResultSetHeader>`
Delete records.

```typescript
const result = await mysqlService.delete('live_data', { mfId: 'user123' });
console.log('Affected rows:', result.affectedRows);
```

#### `exists(table: string, where: Record<string, any>): Promise<boolean>`
Check if a record exists.

```typescript
const exists = await mysqlService.exists('live_data', { mfId: 'user123' });
```

### Utility Methods

#### `getPool(): mysql.Pool`
Get the underlying connection pool for advanced operations.

#### `getStatus(): { isConnected: boolean; poolSize?: number }`
Get connection status information.

#### `close(): Promise<void>`
Close the connection pool (usually not needed in Remix).

## Usage in Remix

### Server Actions

```typescript
// app/routes/api.users.ts
import { ActionFunctionArgs } from '@remix-run/node';
import mysqlService from '~/lib/mysql.server';

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const mfId = formData.get('mfId') as string;
  
  try {
    const result = await mysqlService.insert('live_data', {
      mfId,
      status: 'active',
      created_at: new Date()
    });
    
    return json({ success: true, insertId: result.insertId });
  } catch (error) {
    return json({ success: false, error: 'Failed to create record' }, { status: 500 });
  }
}
```

### Loaders

```typescript
// app/routes/dashboard.tsx
import { LoaderFunctionArgs } from '@remix-run/node';
import mysqlService from '~/lib/mysql.server';

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const records = await mysqlService.query(`
      SELECT * FROM live_data 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY created_at DESC
      LIMIT 50
    `);
    
    return json({ records });
  } catch (error) {
    throw new Error('Failed to load dashboard data');
  }
}
```

### Transactions

```typescript
export async function performComplexOperation() {
  const pool = mysqlService.getPool();
  const connection = await pool.getConnection();
  
  await connection.beginTransaction();
  
  try {
    // Multiple operations
    await connection.execute('INSERT INTO live_data (mfId, status) VALUES (?, ?)', ['user1', 'active']);
    await connection.execute('UPDATE live_data SET status = ? WHERE mfId = ?', ['completed', 'user1']);
    
    await connection.commit();
    connection.release();
    
    return { success: true };
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
}
```

## Configuration

The MySQL service uses configuration from `server-config.ts`:

```typescript
export const MYSQL_CONFIG = {
  HOST: "database-1.cwwjhfm2gg2l.ap-south-1.rds.amazonaws.com",
  USER: "admin",
  PASSWORD: "HWasok4h4VHRPzz065tx",
  DATABASE: "nigeria_data",
  TABLE: "live_data",
  CONNECTION_LIMIT: 10,
  QUEUE_LIMIT: 0,
  ACQUIRE_TIMEOUT: 60000,
  TIMEOUT: 60000,
  RECONNECT: true
};
```

## Security Notes

- ✅ The service is server-side only (`.server.ts` extension)
- ✅ Credentials are never exposed to the client
- ✅ Uses parameterized queries to prevent SQL injection
- ✅ Connection pool limits prevent resource exhaustion

## Error Handling

The service includes comprehensive error handling:

```typescript
try {
  const records = await mysqlService.query('SELECT * FROM live_data');
  return { success: true, data: records };
} catch (error) {
  console.error('MySQL error:', error);
  return { success: false, error: 'Database operation failed' };
}
```

## Best Practices

1. **Always use parameterized queries** to prevent SQL injection
2. **Handle errors gracefully** in your server actions and loaders
3. **Use transactions** for operations that modify multiple tables
4. **Limit query results** to prevent memory issues
5. **Monitor connection pool usage** in production

## Example Files

- `mysql.server.ts` - Main service implementation
- `mysql-example.server.ts` - Usage examples
- `server-config.ts` - Configuration (server-side only) 