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
  try {
    if (verificationToken == null) {
      verificationToken = await getValidationToken(req);
      console.log("token", verificationToken);
    }

    const calculatedSignature = `sha256=${createHmac(
      "sha256",
      verificationToken
    )
      .update(JSON.stringify(req.body))
      .digest("hex")}`;
    let { "x-notion-signature": notion_header } = req.headers;
    // console.log(calculatedSignature, notion_header);
    return timingSafeEqual(
      Buffer.from(calculatedSignature),
      Buffer.from(notion_header)
    );
  } catch (e) {
    console.warn(e);
  }
}

export async function getValidationToken(req) {
  try {
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
        SELECT refreshToken FROM Tokens
        WHERE id = ?`,
      [process.env.REFRESH_TOKEN_ID]
    );
    DB.end();
    console.log("get token results", query[0][0]);
    if (
      (query[0][0].refreshToken == "NULL") |
      (query[0][0].refreshToken == "")
    ) {
      let { "x-notion-signature": notion_header } = req.headers;
      console.log("headers", req.headers);
      console.log("notion sent header", notion_header);
      if (notion_header != null) {
        await updateValidationToken(notion_header);
      }

      return notion_header;
    }
    return query[0][0].refreshToken;
  } catch (e) {
    console.warn(e);
  }
}

//idk what this returns for now i have to make a new connection
// and test it out
export async function updateValidationToken(token) {
  try {
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
    // console.log("update token results", query, query[0]);
    DB.end();
  } catch (e) {
    console.warn(e);
  }
}

/**
 * Add days to an ISO date string
 */
export function addDays(isoString, days) {
  const date = new Date(isoString);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}
