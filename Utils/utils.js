// --- Utils ---------------------------------------------------------

/**
 * Verify Notion webhook signature using HMAC-SHA256 and verification token.
 * Docs: https://developers.notion.com/reference/webhooks
 */

import { createHmac, timingSafeEqual } from "crypto";
import { Client } from "@notionhq/client";
import mysql from "mysql2";
import dotenv from "dotenv";
import { add } from "date-fns";
export let verificationToken = null;
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
    let deleteQuery = await DB.query(`
        DELETE FROM tasks
      `);
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

// initializes the projects that need to be moved to the
// archive from the database
export async function getToArchiveList() {
  let query = await DB.query(
    `
    SELECT page_id, last_changed FROM tasks
    WHERE page_status = "DONE"
    `,
    []
  );
  console.log("gettoArchiveList", query[0]);
  for (let task of query[0]) {
    scheduleArchive(task.page_id, task.last_changed);
  }
  try {
  } catch (e) {
    console.log(e);
  }
}
// changes task status to Done and adds to the to be archived timeouts
// will have to figure out when to call this on the event handler page
export async function addToArchiveList(pageID, lastModified) {
  try {
    let status = await getStatus(pageID);
    console.log(status);
    if (status == "Done") {
      let query = await DB.query(
        `
      UPDATE tasks
      SET last_changed = ?,
      page_status = "Done"
      WHERE page_id = ?
    `,
        [lastModified, pageID]
      );
      console.log("addtoArchiveList", query[0]);
      scheduleArchive(pageID, lastModified);
    }
  } catch (e) {
    console.log(e);
  }
}

// schedules the timeout for being archived,
// negative timeout is basically immediate execution so thats fine
async function scheduleArchive(pageID, lastModified) {
  let lastModifiedDate = new Date(lastModified);
  let dateToBeArchived = new Date(addDays(lastModifiedDate, 7));
  let now = new Date();
  console.log(dateToBeArchived, now, dateToBeArchived - now);
  console.log("setting archive timeout for pageID: ", pageID);
  setTimeout(async () => {
    try {
      const response = await notion.pages.update({
        page_id: pageID,
        properties: {
          Status: {
            status: { name: "Archived" },
          },
        },
      });
      const archiveQuery = DB.query(
        `
        UPDATE tasks
        SET page_status = "Archived"
        WHERE page_id = ?`,
        [pageID]
      );
      console.log(
        "in timeout, successfully archived page:",
        pageID,
        archiveQuery[0],
        response
      );
    } catch (e) {
      console.log(e);
    }
  }, dateToBeArchived - now);
}

// <--------------------------------Clean up logic ------------->
// <--------------------------------Clean up logic ------------->
// <--------------------------------Clean up logic ------------->
// <--------------------------------Clean up logic ------------->

// query when the last clean up of the archive column was
// and schedule the next weekly cleanup
export async function clearOutArchive() {
  let query = await DB.query(
    `
      SELECT date FROM LastArchive
      WHERE id = '1'
  `,
    []
  );
  console.log(query[0]);
  let now = new Date();
  let lastArchived = new Date(query[0][0].date);
  let nextArchive = new Date(addDays(lastArchived, 7));
  setTimeout(async () => {
    try {
      let toBeDeleted = DB.query(
        `
      SELECT page_id FROM tasks
      WHERE page_status = "Archived"`,
        []
      );
      for (pageID of toBeDeleted[0][0]) {
        const response = await notion.pages.update({
          page_id: pageID,
          archived: true, // or in_trash: true
        });
        let deleteQuery = await DB.query(
          `
              DELETE FROM tasks
              WEHRE page_id = ?
          `,
          [pageID]
        );
        console.log(
          "successfully archived page: ",
          pageID,
          response,
          deleteQuery
        );
      }
    } catch (e) {
      console.log(e);
    }
  }, nextArchive - now);
}
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
export async function getToDueDateChangeList() {
  try {
    let query = await DB.query(
      `
    SELECT page_id, deadline FROM tasks
    WHERE page_status IN ("In Progress", "To-Do")
    AND deadline IS NOT NULL`
    );
    console.log("addToDueDateChangeList", query[0]);
    for (let task of query[0]) {
      await scheduleDueDateChange(task.page_id, task.deadline);
    }
  } catch (e) {
    console.log(e);
  }
}

/////////////////////// arent using this currently///////////
// figure it out after drawing out the flowchart and actually
// planning it
export async function addToDueDateChangeList(pageID, deadline) {
  try {
    let query = await DB.query(`
      INSERT INTO tasks
      WHERE page
        `);
  } catch (e) {
    console.log(e);
  }
}
export async function scheduleDueDateChange(pageID, dueDate) {
  // check if status is not done first, if it is update database?
  // if not done then extend database with notion SDK and then
  // update database?
  let deadline = new Date(dueDate);
  let now = new Date();
  console.log("scheduling due date extension for", pageID, deadline);
  setTimeout(async () => {
    try {
      //get status and current deadline
      let status = getStatus(pageID);
      let retrievedDeadline = await getDeadline(pageID);
      console.log(retrievedDeadline);
      let retrievedDateObject = new Date(retrievedDeadline);
      console.log(
        "scheudle due date extension timeout:",
        pageID,
        status,
        retrievedDateObject
      );
      // check if not done and the deadline is same as was scheduled
      console.log(
        "checking if the date objects are the same",
        retrievedDateObject,
        deadline,
        retrievedDateObject == deadline
      );
      if (
        status != "Done" &&
        retrievedDateObject.toISOString() == deadline.toISOString()
      ) {
        let dateupdate = await notion.pages.update({
          page_id: pageID,
          properties: {
            "Due Date": {
              date: {
                // push it back only by 2 for now, add custom functionality later?
                start: addDays(retrievedDateObject, 2),
              },
            },
          },
        });
        console.log(
          "successfully extended deadline for page: ",
          pageID,
          dateupdate
        );
      }
      // if the deadline has been extended or changed
      else if (status != "Done" && retrievedDateObject != deadline) {
        let updateDeadline = await DB.query(
          `
            UPDATE tasks
            SET deadline = ?
            WHERE page_id = ?
          `,
          [retrievedDateObject, pageID]
        );
        console.log(
          "deadline was changed, updating DB from scheduleDueDateChange",
          updateDeadline[0]
        );
        scheduleDueDateChange(pageID, retrievedDateObject);
      }
    } catch (e) {
      console.log(e);
    }
  }, deadline - now);
}

// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->

export async function getToBeRecurred() {
  try {
    let query = await DB.query(
      `
    SELECT page_id, recurrByDays FROM tasks
    WHERE isRecurring = 1
    `,
      []
    );
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
    let title = await getTitle(pageID);
    console.log("logging title of retrieved page:", title);
    let status = await getStatus(pageID);
    let date = await getDeadline(pageID);
    let newDeadline = addDays(date, recurrByDays);
    console.log("status: ", status, " Due Date: ", date);
    if (status == "Done") {
      await notion.pages.update({
        page_id: pageID,
        properties: {
          Status: {
            status: { name: "To-Do" },
          },
          "Due Date": {
            date: {
              start: newDeadline,
            },
          },
        },
      });
      let query = await DB.query(
        `
              UPDATE tasks
              SET page_status = "To-Do",
              deadline = ?
              WHERE page_id = ?
              `,
        [newDeadline, pageID]
      );
      console.log("event successfully altered");
    } else {
      console.log("correct page, conditions for change not met");
    }
  } catch (e) {
    console.log(e);
  }
}

async function getStatus(pageID) {
  let status = await notion.pages.properties.retrieve({
    page_id: pageID,
    property_id: "blD%7D", //this is hard coded for now but its the Status ID property
  });
  return status.status.name;
}
async function getDeadline(pageID) {
  let date = await notion.pages.properties.retrieve({
    page_id: pageID,
    property_id: "G%5Db%3B", //this is hard coded for now but its the Date ID property
  });
  return date.date.start;
}
async function getTitle(pageID) {
  let title = await notion.pages.properties.retrieve({
    page_id: pageID,
    property_id: "title", //this is hard coded for now but its the Date ID property
  });
  return title.results[0].title.plain_text;
}
