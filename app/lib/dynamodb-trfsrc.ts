import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "ap-south-1" });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "nigeria-prod-trfsrcUrlMapping";

interface SaveTrfSrcMappingInput {
  trfSrcName: string;
  trfSrcUrls: string[];
  callbackType: "CAPTIVE" | "NON_CAPTIVE";
}

export async function saveTrfSrcMapping({
  trfSrcName,
  trfSrcUrls,
  callbackType,
}: SaveTrfSrcMappingInput) {
  const trfSrcKey = `${trfSrcName}_${callbackType}`;
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        trfSrc: trfSrcKey,   // PK
        trfSrcName,      
        trfSrcUrls,
        callbackType,
      },
      ConditionExpression: "attribute_not_exists(trfSrc)",
    })
  );
}

