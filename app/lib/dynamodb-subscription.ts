import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
export interface SubscriptionItem {
  subscriptionId_subscriptionDescription: string;
  subscriptionName?: string;
  subscriptionDescription?: string;
  serviceId?: string;
  isLive?: boolean;
  bannerUrl?: string;
  price?: number;
  currency?: string;
  subscriptionValidityDuration?: number;
  subscriptionValidityUnit?: string;
  [key: string]: any;
}
const client = new DynamoDBClient({
  region: "ap-south-1",
});

const ddb = DynamoDBDocumentClient.from(client);

export async function getSubscriptionsBySubscriptionId(
  subscriptionId: string
): Promise<SubscriptionItem[]> {
  const params: ScanCommandInput = {
    TableName: "mtn-nigeria-prod-cp-products",
    FilterExpression:
      "begins_with(subscriptionId_subscriptionDescription, :pk) AND isLive = :isLive",
    ExpressionAttributeValues: {
      ":pk": `${subscriptionId}_`,
      ":isLive": true,
    },
  };

  const result = await ddb.send(new ScanCommand(params));
  return (result.Items as SubscriptionItem[]) || [];
}