// --- Utils ---------------------------------------------------------

/**
 * Verify Notion webhook signature using HMAC-SHA256 and verification token.
 * Docs: https://developers.notion.com/reference/webhooks
 */

import { createHmac, timingSafeEqual } from "crypto";
import { Client } from "@notionhq/client";
import mysql from "mysql2";
import dotenv from "dotenv";
export let verificationToken = null;
export let toBeArchived = [];
export let toBeDueDateChanged = [];
export let toBeRecurred = [];
dotenv.config();
const DB = mysql
  .createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  })
  .promise();
const notion = new Client({ auth: process.env.INTERNAL_INTEGRATION_SECRET });
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
    let query = await DB.query(
      `
        SELECT refreshToken FROM Tokens
        WHERE id = ?`,
      [process.env.REFRESH_TOKEN_ID]
    );
    //console.log("get token results", query[0][0]);
    if (
      (query[0][0].refreshToken == "NULL") |
      (query[0][0].refreshToken == "")
    ) {
      let { "x-notion-signature": notion_header } = req.headers;
      //console.log("headers", req.headers);
      //console.log("notion sent header", notion_header);
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
    let query = await DB.query(
      `
        UPDATE Tokens
        SET refreshToken = ?
        WHERE id = ?`,
      [token, process.env.REFRESH_TOKEN_ID]
    );
    // console.log("update token results", query, query[0]);
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

// <--------------------------------Data Base logic ------------->
export async function syncDataBase() {
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
  });
/*   for (task of response.results) {
    const page = notion.pages.retrieve({ page_id: task.id });
    let query = await DB.query(
      `
      INSERT INTO tasks (page_ID, dueDate, page_status)
      Values(?, ?, ?)
    `,
      [page.id, page.properties["Due Date"].date, page.properties.Status]
    ); */
    console.log("addtoArchiveList", query[0]);
  }
}

export async function getToArchiveList() {
  let query = await DB.query(
    `
    SELECT * FROM tasks
    WHERE page_status = "DONE"
    `,
    []
  );
  console.log("gettoArchiveList", query[0]);
  toBeArchived = query[0][0];
}
// last modified ie status change
export async function addToArchiveList(pageID, lastModified) {
  let query = await DB.query(
    `
      INSERT INTO tasks (page_ID, dueDate, page_status)
      Values(?, ?, "Done")
    `,
    [pageID, lastModified]
  );
  console.log("addtoArchiveList", query[0]);
}
export async function getToDueDateChangeList() {
  let query = await DB.query(
    `
    SELECT * FROM tasks
    WHERE page_status IN ("In Progress", "To-Do")`
  );
  console.log("addToDueDateChangeList", query[0]);
}
export async function addToDueDateChangeList(pageID, dueDate, status) {
  let query = await DB.query(
    `
      INSERT INTO tasks (page_ID, dueDate, page_status)
      Values(?, ?, ?)
    `,
    [pageID, dueDate, status]
  );
  console.log("addtoArchiveList", query[0]);
}
export async function getToBeRecurred() {
  let query = await DB.query(
    `
    SELECT * FROM tasks
    `
  );
  console.log("addToDueDateChangeList", query[0]);
}
export async function RecurTask(pageID) {
  // check if pageID.status is done, if it is then recurr task
}
