import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { DYNAMODB_TABLES, AWS_REGION } from "./config";
import { getNextVersion } from "./version";

const client = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

export async function getAllProducts() {
  const { Items } = await docClient.send(
    new ScanCommand({ TableName: DYNAMODB_TABLES.CP_PRODUCTS })
  );
  return Items || [];
}

export async function getProductsByCpid(cpid: string, serviceIds: any[]) {
  // Get all service IDs that belong to this CPID
  const cpServiceIds = serviceIds
    .filter((sid: any) => sid.cpId === cpid)
    .map((sid: any) => sid.serviceId);

  if (cpServiceIds.length === 0) {
    return [];
  }

  // Get all products and filter by service IDs that belong to this CPID
  const { Items } = await docClient.send(
    new ScanCommand({ TableName: DYNAMODB_TABLES.CP_PRODUCTS })
  );

  const allProducts = Items || [];
  return allProducts.filter((product: any) =>
    cpServiceIds.includes(product.serviceId)
  );
}

export async function createProduct(productData: any) {
  await docClient.send(
    new PutCommand({
      TableName: DYNAMODB_TABLES.CP_PRODUCTS,
      Item: productData,
    })
  );
  return productData;
}

export async function updateProduct(subscriptionId_subscriptionDescription: string, updateData: any) {
  const { Item: existing } = await docClient.send(
    new GetCommand({
      TableName: DYNAMODB_TABLES.CP_PRODUCTS,
      Key: { subscriptionId_subscriptionDescription },
    })
  );


  if (!existing) {
    throw new Error("Product not found");
  }
  const newVersion = getNextVersion(existing.version);
  // remove bannerUrl if it is undefined or null
  if (updateData.bannerUrl === undefined || updateData.bannerUrl === null || updateData.bannerUrl.size === 0) {
    delete updateData.bannerUrl;
  }

  // Only update provided fields that are not undefined or null
  const updateFields = Object.entries({ ...updateData, version: newVersion }).filter(([_, v]) => v !== undefined && v !== null);

  // If no fields to update, return early
  if (updateFields.length === 0) {

    return existing;
  }

  const updateExpr = "set " + updateFields.map(([k], i) => `#${k} = :v${i}`).join(", ");
  const exprAttrNames = Object.fromEntries(updateFields.map(([k], i) => [`#${k}`, k]));
  const exprAttrValues = Object.fromEntries(updateFields.map(([k, v], i) => [`:v${i}`, v]));



  await docClient.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.CP_PRODUCTS,
      Key: { subscriptionId_subscriptionDescription },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    })
  );
  const { Item: updatedProduct } = await docClient.send(
    new GetCommand({
      TableName: DYNAMODB_TABLES.CP_PRODUCTS,
      Key: { subscriptionId_subscriptionDescription },
    })
  );
  return updatedProduct || null;
}
export async function deleteProduct(subscriptionId_subscriptionDescription: string) {
  await docClient.send(
    new DeleteCommand({
      TableName: DYNAMODB_TABLES.CP_PRODUCTS,
      Key: { subscriptionId_subscriptionDescription },
    })
  );
}