// --- Utils ---------------------------------------------------------

/**
 * Verify Notion webhook signature using HMAC-SHA256 and verification token.
 * Docs: https://developers.notion.com/reference/webhooks
 */

import { createHmac, timingSafeEqual } from "crypto";
import mysql from "mysql2";
import dotenv from "dotenv";
export let verificationToken = null;

dotenv.config();

export async function isTrustedNotionRequest(req) {
  if (validationToken == null) {
    verificationToken = await getValidationToken(req);
  }
  // This body should come from your request body for subsequent validations

  const calculatedSignature = `sha256=${createHmac("sha256", verificationToken)
    .update(JSON.stringify(req.body))
    .digest("hex")}`;

  return timingSafeEqual(
    Buffer.from(calculatedSignature),
    Buffer.from(headers["X-Notion-Signature"])
  );
}

export async function getValidationToken(req) {
  const DB = mysql
    .createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    })
    .promise();

  let query = await DB.query(
    `
        SELECT refreshToken FROM Users
        WHERE name = ?`,
    [user]
  );
  DB.end();
  console.log("get token results", query, query[0], query[0][0]);
  if (query[0][0].refreshToken == null) {
    let notion_header = req.get("x-notion-header");
    console.log(notion_header);
    await updateValidationToken(notion_header);
    return notion_header;
  }
  return query[0][0].refreshToken;
}

//idk what this returns for now i have to make a new connection
// and test it out
export async function updateValidationToken(token) {
  const DB = mysql
    .createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    })
    .promise();

  let query = await DB.query(
    `
        UPDATE Tokens
        SET refreshToken = ?
        WHERE id = ?`,
    [token, process.env.REFRESH_TOKEN_ID]
  );
  console.log("update token results", query, query[0]);
  DB.end();
}

/**
 * Add days to an ISO date string
 */
export function addDays(isoString, days) {
  const date = new Date(isoString);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}
