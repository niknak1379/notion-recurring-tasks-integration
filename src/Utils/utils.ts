// --- Utils ---------------------------------------------------------
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { Client } from "@notionhq/client";
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2";
import dotenv from "dotenv";
import logger from "./logger.js";
// ----------------------Types and Interfaces --------------->
// ----------------------Types and interfaces --------------->
interface notoinPageProperty {
  status: {
    name: string;
  };
  date: {
    start: string;
  };
  number: number; //recursion days
  results: [
    {
      title: {
        plain_text: string;
      };
    }
  ];

  select: {
    name: string,// priority
  }

}

interface TokenRow extends RowDataPacket {
  refreshToken: string;
}
let PriorityArr = ["Low", "Medium", "High"]

// ----------------------DB and notion Client Init ---------->
// ----------------------DB and notion Client Init ---------->
// ----------------------DB and notion Client Init ---------->
// ----------------------DB and notion Client Init ---------->
export let verificationToken = "";
export let toBeDueDateChanged = [];
export let toBeRecurred = new Map<string, number>();
dotenv.config();

//environment variables initialization and validation

const MYSQL_HOST = process.env["MYSQL_HOST"];
const MYSQL_USER = process.env["MYSQL_USER"];
const MYSQL_PASSWORD = process.env["MYSQL_PASSWORD"];
const MYSQL_DATABASE = process.env["MYSQL_DATABASE"];
const INTERNAL_INTEGRATION_SECRET = process.env["INTERNAL_INTEGRATION_SECRET"];
const REFRESH_TOKEN_ID = process.env["REFRESH_TOKEN_ID"];
export const DATASOURCE_ID = process.env["DATASOURCE_ID"];
if (
  !MYSQL_HOST ||
  !MYSQL_USER ||
  !MYSQL_PASSWORD ||
  !MYSQL_DATABASE ||
  !INTERNAL_INTEGRATION_SECRET ||
  !REFRESH_TOKEN_ID ||
  !DATASOURCE_ID
) {
  throw new Error("REFRESH_TOKEN_ID environment variable is missing");
}

export const DB = mysql
  .createPool({
    host: MYSQL_HOST,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
  })
  .promise();
export const notion = new Client({ auth: INTERNAL_INTEGRATION_SECRET });

//  ----------------------Request Verification Logi ------------->
//  ----------------------Request Verification Logi ------------->
//  ----------------------Request Verification Logi ------------->
//  ----------------------Request Verification Logi ------------->

/**
 * Verify Notion webhook signature using HMAC-SHA256 and verification token.
 * Docs: https://developers.notion.com/reference/webhooks
 */

export async function isTrustedNotionRequest(req: Request): Promise<boolean> {
  logger.debug("verifying notion token");
  if (verificationToken == "") {
    verificationToken = await getValidationToken(req);
    logger.debug("initializing notion token", verificationToken);
  }
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const calculatedSignature = `sha256=${createHmac("sha256", verificationToken)
    .update(rawBody)
    .digest("hex")}`;
  let { "x-notion-signature": notion_header } = req.headers;

  return timingSafeEqual(
    Buffer.from(calculatedSignature),
    Buffer.from(notion_header as string)
  );
}

export async function getValidationToken(req: Request): Promise<string> {
  const [rows] = await DB.query<TokenRow[]>(
    `SELECT refreshToken FROM Tokens WHERE id = ?`,
    [REFRESH_TOKEN_ID]
  );

  if (
    !rows ||
    rows.length === 0 ||
    !rows[0] ||
    !rows[0].refreshToken ||
    rows[0].refreshToken === "NULL" ||
    rows[0].refreshToken === ""
  ) {
    logger.debug(
      "refresh token does not exist in DB, initializing from header"
    );
    const { "x-notion-signature": notion_header } = req.headers;

    if (notion_header && typeof notion_header === "string") {
      await updateValidationToken(notion_header);
      return notion_header;
    } else {
      throw new Error("No token found and no header provided");
    }
  }

  return rows[0].refreshToken;
}

//idk what this returns for now i have to make a new connection
// and test it out
export async function updateValidationToken(token: string): Promise<void> {
  let [updated] = await DB.query<ResultSetHeader>(
    `
        UPDATE Tokens
        SET refreshToken = ?
        WHERE id = ?`,
    [token, REFRESH_TOKEN_ID]
  );
  if (updated.affectedRows != 1) {
    throw new Error("Could not update refresh token in updatevalidationtoken");
  }
}

// --------------------------Helper Functions-------------------------//
// --------------------------Helper Functions-------------------------//
// --------------------------Helper Functions-------------------------//
// --------------------------Helper Functions-------------------------//

export async function getStatus(pageID: string): Promise<string> {
  const page = (await notion.pages.properties.retrieve({
    page_id: pageID,
    property_id: "blD%7D",
  })) as unknown as notoinPageProperty;

  if (!page.status || !page.status.name) {
    throw new Error("Status property not found or has no name");
  }
  logger.info("getting status for", {
    page: pageID,
    status: page.status.name,
  });
  return page.status.name;
}
export async function getDeadline(pageID: string): Promise<string> {
  let page = (await notion.pages.properties.retrieve({
    page_id: pageID,
    property_id: "G%5Db%3B", //this is hard coded for now but its the Date ID property
  })) as unknown as notoinPageProperty;
  logger.info("getting deadline for", {
    page: pageID,
    deadline: page.date.start,
  });
  return page.date.start;
}
export async function getTitle(pageID: string) {
  let page = (await notion.pages.properties.retrieve({
    page_id: pageID,
    property_id: "title", //this is hard coded for now but its the Date ID property
  })) as unknown as notoinPageProperty;
  logger.info("getting title for", {
    page: pageID,
    title: page.results[0].title.plain_text,
  });
  return page.results[0].title.plain_text;
}
export async function getRecursion(pageID: string): Promise<number> {
  let page = (await notion.pages.properties.retrieve({
    page_id: pageID,
    property_id: "jSyh", //this is hard coded for now but its the recursion ID
  })) as unknown as notoinPageProperty;
  logger.info("getting recursion days for", {
    page: pageID,
    recursion: page.number,
  });
  return page.number;
}
export async function getPriority(pageID: string): Promise<string> {
  let page = (await notion.pages.properties.retrieve({
    page_id: pageID,
    property_id: "ZGmH", //this is hard coded for now but its the priority
  })) as unknown as notoinPageProperty;
  logger.info("getting priority for", {
    page: pageID,
    priority: page.select.name,
  });
  return page.select.name;
}
/**
 * Add days to an ISO date string
 */
export function addDays(isoString: string, days: number): string {
  const date = new Date(isoString);
  date.setDate(date.getDate() + days);
  logger.debug("add days operation on", {
    date1: isoString,
    days: days,
    result: date,
  });
  return date.toISOString();
}
export function escealatePriority(currPriority: string): string {
  let index = PriorityArr.indexOf(currPriority)
  logger.info("escalating priority", {"currPriority": currPriority})
  if (index == -1) {
    throw new Error("priority not found code has a bug")
  } else if (index == 2) {
    logger.info("priority already high, no more excalation needed")
    return currPriority
  }
  logger.info("escalating priority", { "New Priority": PriorityArr[index + 1] })
  return PriorityArr[index + 1] as string
}
