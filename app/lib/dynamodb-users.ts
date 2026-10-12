import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { DYNAMODB_TABLES, AWS_REGION } from "./config";

const client = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

export interface User {
  email: string;
  id: number;
  password: string;
  role: "admin" | "cp" | "operations";
  cpId: string;
  serviceIds?: string[];
}

export async function getAllUsers(): Promise<User[]> {
  const { Items } = await docClient.send(
    new ScanCommand({ TableName: DYNAMODB_TABLES.DASHBOARD_LOGINS })
  );
  return (Items || []) as User[];
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: DYNAMODB_TABLES.DASHBOARD_LOGINS,
      Key: { email: email.toLowerCase() },
    })
  );
  return Item as User || null;
}

export async function createUser(user: Omit<User, "id">): Promise<void> {
  // Generate a unique ID (you might want to use a more sophisticated ID generation)
  const id = Date.now();
  
  await docClient.send(
    new PutCommand({
      TableName: DYNAMODB_TABLES.DASHBOARD_LOGINS,
      Item: {
        ...user,
        email: user.email.toLowerCase(),
        id,
      },
    })
  );
}

export async function updateUser(email: string, updates: Partial<Omit<User, "email" | "id">>): Promise<void> {
  const updateExpression: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  // Build update expression dynamically
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      const attributeName = `#${key}`;
      const attributeValue = `:${key}`;
      updateExpression.push(`${attributeName} = ${attributeValue}`);
      expressionAttributeNames[attributeName] = key;
      expressionAttributeValues[attributeValue] = value;
    }
  });

  if (updateExpression.length === 0) {
    throw new Error("No valid updates provided");
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.DASHBOARD_LOGINS,
      Key: { email: email.toLowerCase() },
      UpdateExpression: `SET ${updateExpression.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

export async function deleteUser(email: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: DYNAMODB_TABLES.DASHBOARD_LOGINS,
      Key: { email: email.toLowerCase() },
    })
  );
}

export async function changeUserPassword(email: string, newPassword: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.DASHBOARD_LOGINS,
      Key: { email: email.toLowerCase() },
      UpdateExpression: "SET password = :password",
      ExpressionAttributeValues: {
        ":password": newPassword,
      },
    })
  );
} 