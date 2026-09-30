/**
 * Shared DynamoDB helper for all four Lambda functions.
 *
 * This plays the same role in the AWS-deployed version that
 * shared/db.js (the JSON-file "database") played in the local
 * microservices version: every Lambda calls put()/scanFiltered() the
 * same way, so switching data stores again in the future (e.g. to a
 * real MongoDB/DocumentDB cluster) only means changing this one file.
 *
 * Table names come from environment variables set on each Lambda
 * function, so the same code works for
 * every table without hard-coding names.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

async function put(tableName, item) {
  await doc.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

/**
 * A plain Scan + in-memory filter. For a class project's data volumes
 * this is fine and keeps the Lambda code easy to follow; a production
 * system handling many machines would instead add a Global Secondary
 * Index (e.g. on machine_id and sensor_type) and use Query instead of
 * Scan, which is called out as a known scaling limitation in the
 * final report.
 */
async function scanFiltered(tableName, predicate) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await doc.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey })
    );
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.filter(predicate);
}

module.exports = { put, scanFiltered };
