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
export let toBeRecurred = new Map();
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
// <--------------------------------Data Base logic ------------->
// <--------------------------------Data Base logic ------------->
// <--------------------------------Data Base logic ------------->

// syncs entire database for already existing tasks and for
// initializing
export async function syncDataBase() {
  try {
    console.log("datasource id", process.env.DATASOURCE_ID);
    const response = await notion.dataSources.query({
      data_source_id: process.env.DATASOURCE_ID,
    });
    console.log(response.results[0].properties);
    for (let task of response.results) {
      let query = await DB.query(
        `
      INSERT INTO tasks (name, page_ID, deadline, page_status, last_changed)
      Values(?, ?, ?, ?, ?)
    `,
        [
          task.properties["Task Name"].title[0].plain_text,
          task.id,
          task.properties["Due Date"].date?.start,
          task.properties.Status.status.name,
          task.last_edited_time,
        ]
      );
      console.log(query[0]);
    }
  } catch (e) {
    console.log(e);
  }
}

// <--------------------------------Archive logic ------------->
// <--------------------------------Archive logic ------------->
// <--------------------------------Archive logic ------------->
// <--------------------------------Archive logic ------------->

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
  try {
  } catch (e) {
    console.log(e);
  }
}
// last modified ie status change
export async function addToArchiveList(pageID, lastModified) {
  let query = await DB.query(
    `
      INSERT INTO tasks (page_id, deadline, page_status)
      Values(?, ?, "Done")
    `,
    [pageID, lastModified]
  );
  console.log("addtoArchiveList", query[0]);
  try {
  } catch (e) {
    console.log(e);
  }
}

// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
export async function getToDueDateChangeList() {
  let query = await DB.query(
    `
    SELECT * FROM tasks
    WHERE page_status IN ("In Progress", "To-Do")`
  );
  console.log("addToDueDateChangeList", query[0]);
  try {
  } catch (e) {
    console.log(e);
  }
}
export async function addToDueDateChangeList(pageID, dueDate, status) {
  let query = await DB.query(
    `
      INSERT INTO tasks (page_id, deadline, page_status)
      Values(?, ?, ?)
    `,
    [pageID, dueDate, status]
  );
  console.log("addtoArchiveList", query[0]);
  try {
  } catch (e) {
    console.log(e);
  }
}
export async function getToBeRecurred() {
  try {
    let query = await DB.query(
      `
    SELECT page_id, recurrByDays FROM tasks
    WHERE isRecurring = 1 AND page_status = "DONE"
    `,
      []
    );
    //console.log("toBeRecurred", query[0]);
    for (let recurringTask of query[0]) {
      toBeRecurred.set(recurringTask.page_id, recurringTask.recurrByDays);
    }
    console.log("toBeRecurred", toBeRecurred);
  } catch (e) {
    console.log(e);
  }
}

// low level give it pageID, will find the status
export async function RecurTask(pageID, recurrByDays) {
  try {
    // get the title here, instead of ID
    let title = await notion.pages.properties.retrieve({
      page_id: pageID,
      property_id: "title", //this is hard coded for now but its the Date ID property
    });
    console.log(
      "logging title of retrieved page:",
      title.results[0].title.plain_text
    );
    let status = await notion.pages.properties.retrieve({
      page_id: page.id,
      property_id: "blD%7D", //this is hard coded for now but its the Status ID property
    });
    let date = await notion.pages.properties.retrieve({
      page_id: page.id,
      property_id: "G%5Db%3B", //this is hard coded for now but its the Date ID property
    });
    console.log("status: ", status, " Due Date: ", date);
    if (status.status.name == "Done") {
      // since i dont want a billion tasks in the dashboard ill just
      // change the status and push up the date instead of archving
      // and then creating a new one.
      await notion.pages.update({
        page_id: page.id,
        properties: {
          Status: {
            status: { name: "To-Do" },
          },
          "Due Date": {
            date: {
              start: addDays(date.date.start, recurrByDays),
            },
          },
        },
      });
      console.log("event successfully altered");
    } else {
      console.log("correct page, conditions for change not met");
    }
  } catch (e) {
    console.log(e);
  }
}
