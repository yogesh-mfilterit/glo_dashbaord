const fs = require('fs');
const path = require('path');
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

// Initialize DynamoDB client
// take from environment variable
// Import dotenv to read environment variables

console.log(process.env.AWS_ACCESS_KEY_ID);
console.log(process.env.AWS_SECRET_ACCESS_KEY);
console.log(process.env.AWS_REGION);

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Read configuration file
function readConfig() {
  try {
    const configPath = path.join(__dirname, 'tool_config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('Error reading config file:', error.message);
    process.exit(1);
  }
}

// Generate array of dates from startDate to endDate
function generateDateArray(startDate, endDate) {
  const dates = [];
  
  // Parse dates in YYYYMMDD format
  const start = new Date(
    parseInt(startDate.substring(0, 4)), // year
    parseInt(startDate.substring(4, 6)) - 1, // month (0-indexed)
    parseInt(startDate.substring(6, 8)) // day
  );
  
  const end = new Date(
    parseInt(endDate.substring(0, 4)), // year
    parseInt(endDate.substring(4, 6)) - 1, // month (0-indexed)
    parseInt(endDate.substring(6, 8)) // day
  );
  
  const currentDate = new Date(start);
  
  while (currentDate <= end) {
    // Format as YYYYMMDD
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    dates.push(`${year}${month}${day}`);
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return dates;
}

// Query DynamoDB for a specific date
async function queryDynamoDB(date) {
  try {
    const params = {
      TableName: 'mtn-nigeria-prod-realtime-dashboard-counters',
      KeyConditionExpression: 'dbDate = :dbDate',
      ExpressionAttributeValues: {
        ':dbDate': { S: date }
      }
    };

    const command = new QueryCommand(params);
    const result = await dynamoClient.send(command);
    
    return result.Items ? result.Items.map(item => unmarshall(item)) : [];
  } catch (error) {
    console.error(`Error querying DynamoDB for date ${date}:`, error.message);
    return [];
  }
}

// Normalize data according to specifications
function normalizeData(data, counterKeyPrefix, idField) {
  return data.filter(item => {
    // Check if counterKey starts with the specified prefix
    if (!item.counterKey || !item.counterKey.startsWith(counterKeyPrefix)) {
      return false; // Remove items that don't match prefix
    }
    
    // Split counterKey by "#"
    const parts = item.counterKey.split('#');
    if (parts.length < 2) {
      return false; // Remove items that don't have at least 2 parts
    }
    
    // Update the object with normalized data
    item.counterKey = parts[0]; // First part becomes the new counterKey
    item[idField] = parts[1]; // Second part becomes the specified id field
    
    return true; // Keep this item
  });
}

// Main processing function
async function processData() {
  console.log('Starting data processing...');
  
  // Read configuration
  const config = readConfig();
  console.log('Configuration loaded:', config);
  
  // Generate date array
  const dates = generateDateArray(config.startDate, config.endDate);
  console.log(`Generated ${dates.length} dates from ${config.startDate} to ${config.endDate}`);
  
  // Process each date
  let allData = [];
  
  for (const date of dates) {
    console.log(`Processing date: ${date}`);
    
    // Query DynamoDB for this date
    const dateData = await queryDynamoDB(date);
    console.log(`Retrieved ${dateData.length} records for ${date}`);
    
    // Normalize the data
    const normalizedData = normalizeData(dateData, config.counterKeyPrefix, config.id);
    console.log(`After normalization: ${normalizedData.length} records for ${date}`);
    
    // Add to overall data array
    allData = allData.concat(normalizedData);
  }
  
  console.log(`Total records after processing: ${allData.length}`);
  
  // Save to output file
  const outputPath = path.join(__dirname, 'output.json');
  try {
    fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2));
    console.log(`Data saved to: ${outputPath}`);
  } catch (error) {
    console.error('Error saving output file:', error.message);
    process.exit(1);
  }
  
  console.log('Data processing completed successfully!');
}

// Run the tool
if (require.main === module) {
  processData().catch(error => {
    console.error('Error in main process:', error.message);
    process.exit(1);
  });
}

module.exports = {
  readConfig,
  generateDateArray,
  queryDynamoDB,
  normalizeData,
  processData
}; 