// Simple test script for user management functions
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

// Test configuration
const AWS_REGION = "ap-south-1";
const TABLE_NAME = "mtn-nigeria-dev-dashboard-logins"; // Use dev table for testing

const client = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

async function testUserFunctions() {
  console.log("Testing user management functions...");
  
  try {
    // Test 1: Get all users
    console.log("\n1. Testing getAllUsers...");
    const { Items } = await docClient.send(
      new ScanCommand({ TableName: TABLE_NAME })
    );
    console.log(`Found ${Items?.length || 0} users`);
    
    // Test 2: Get specific user
    if (Items && Items.length > 0) {
      const testEmail = Items[0].email;
      console.log(`\n2. Testing getUserByEmail for ${testEmail}...`);
      const { Item } = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { email: testEmail },
        })
      );
      console.log("User found:", Item ? "Yes" : "No");
    }
    
    // Test 3: Create a test user (commented out to avoid creating test data)
    /*
    console.log("\n3. Testing createUser...");
    const testUser = {
      email: "test@example.com",
      password: "TestPass123!",
      role: "cp",
      id: Date.now()
    };
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: testUser,
      })
    );
    console.log("Test user created successfully");
    */
    
    console.log("\n✅ All tests completed successfully!");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the test
testUserFunctions(); 