import {
  DATASOURCE_ID,
  DB,
  notion,
  getRecursion,
  getStatus,
  getDeadline,
  getTitle,
  addDays,
  toBeRecurred,
  escealatePriority,
  getPriority,
} from "./utils.js";
import logger from "./logger.js";
import { type PageObjectResponse } from "@notionhq/client";
import { type ResultSetHeader, type RowDataPacket } from "mysql2";
interface page extends RowDataPacket {
  page_id: string;
  last_changed: string;
  deadline: string;
  recurrByDays: number;
}

// <--------------------------------Data Base logic ------------->
// <--------------------------------Data Base logic ------------->
// <--------------------------------Data Base logic ------------->
// <--------------------------------Data Base logic ------------->

// syncs entire database for already existing tasks and for
// initializing
export async function syncDataBase() {
  logger.info("Deleting all DB entries for resync");
  // Delete entire tasks for resync
  await DB.query(`DELETE FROM tasks`);

  const response = await notion.dataSources.query({
    data_source_id: DATASOURCE_ID as string,
  });

  const pages = response.results.filter(
    (item): item is PageObjectResponse => item.object === "page"
  );

  for (const task of pages) {
    let isRecurring = 0;
    let recurrByDays = 0;

    // Get Recurring property
    const recurring = task.properties["Recurring"];
    if (
      recurring &&
      "type" in recurring &&
      recurring.type === "number" &&
      "number" in recurring &&
      recurring.number != null
    ) {
      recurrByDays = recurring.number;
      isRecurring = 1;
    }

    // Get Task Name
    const taskName = task.properties["Task Name"];
    let name = "";
    if (
      taskName &&
      "type" in taskName &&
      taskName.type === "title" &&
      "title" in taskName &&
      Array.isArray(taskName.title) &&
      taskName.title.length > 0
    ) {
      name = taskName.title[0]?.plain_text as string;
    }

    // Get Due Date
    const dueDate = task.properties["Due Date"];
    let deadline: Date | null = null;
    if (
      dueDate &&
      "type" in dueDate &&
      dueDate.type === "date" &&
      "date" in dueDate
    ) {
      deadline = new Date(dueDate.date?.start as string) || null;
    }

    // Get Status
    const status = task.properties["Status"];
    let statusName = "";
    if (
      status &&
      "type" in status &&
      status.type === "status" &&
      "status" in status &&
      status.status?.name
    ) {
      statusName = status.status.name;
    }
    logger.info("inserting the following object into the DB", {
      title: name,
      isrecurring: isRecurring,
      recurrDays: recurrByDays,
      status: statusName,
      deadline: deadline,
    });
    // Insert into database
    const [result] = await DB.query<ResultSetHeader>(
      `
          INSERT INTO tasks (name, page_ID, deadline, page_status, last_changed, isRecurring, recurrByDays)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      [
        name,
        task.id,
        deadline,
        statusName,
        task.last_edited_time,
        isRecurring,
        recurrByDays,
      ]
    );

    logger.info("DB Insert result in affected rows", result.affectedRows);
  }
}

export async function addTaskToDB(pageID: string, creationTime: string) {
  let isRecurring = 0;
  let recurrByDays = getRecursion(pageID);
  if (recurrByDays != undefined) {
    isRecurring = 1;
  }
  logger.debug("get recurr results", {
    isRecurring: isRecurring,
    recurrByDays: recurrByDays,
  });
  let status = await getStatus(pageID);
  let deadline = await getDeadline(pageID);
  let title = await getTitle(pageID);
  logger.info("adding single page to DB", {
    title: title,
    status: status,
    deadline: deadline,
    isRecurring: isRecurring,
    recurrByDays: recurrByDays,
  });
  let [query] = await DB.query<ResultSetHeader>(
    `
          INSERT INTO tasks (name, page_ID, deadline, page_status, last_changed, isRecurring, recurrByDays)
          Values(?, ?, ?, ?, ?, ?, ?)
        `,
    [title, pageID, deadline, status, creationTime, isRecurring, recurrByDays]
  );
  logger.info("insert result:", query.affectedRows);
  if (isRecurring) {
    logger.debug("isRecurring, calling handleRecursion");
    await handleRecursionChange(pageID);
  }

  if (deadline != null) {
    logger.debug("page has deadline, calling addToDueDateChangeList");
    await addToDueDateList(pageID);
  }
  if (status == "Done") {
    logger.debug("page status is done, callig addToArchiveList");
    addToArchiveList(pageID, creationTime);
  }
}

// <--------------------------------Archive logic ------------->
// <--------------------------------Archive logic ------------->
// <--------------------------------Archive logic ------------->
// <--------------------------------Archive logic ------------->

// initializes the projects that need to be moved to the
// archive column from the Done column from the database,
// changes this status a week after it was moved to done
// dont have to call it other than during init, add and update already
// handle archiving with addToArchiveList function
export async function getToArchiveList() {
  logger.info("initializing archive list");
  let [query] = await DB.query<page[]>(
    `
    SELECT page_id, last_changed FROM tasks
    WHERE page_status = "DONE"
    `,
    []
  );
  for (let task of query) {
    logger.info("setting archive schedule for", {
      page_id: task.page_id,
      last_changed: task.last_changed,
    });
    scheduleArchive(task.page_id, task.last_changed);
  }
}
// changes task status to Done and adds to the to be archived timeouts
// will have to figure out when to call this on the event handler page
export async function addToArchiveList(pageID: string, lastModified: string) {
  //double check status
  let status = await getStatus(pageID);
  if (status == "Done") {
    let [query] = await DB.query<ResultSetHeader>(
      `
      UPDATE tasks
      SET last_changed = ?,
      page_status = "Done"
      WHERE page_id = ?
    `,
      [lastModified, pageID]
    );
    logger.info("update task last_changed for adding to archive list", {
      rows: query.affectedRows,
    });
    scheduleArchive(pageID, lastModified);
  }
}

// schedules the timeout for being archived,
// negative timeout is basically immediate execution so thats fine
async function scheduleArchive(pageID: string, lastModified: string) {
  let lastModifiedDate = new Date(lastModified);
  let dateToBeArchived = new Date(addDays(lastModifiedDate.toISOString(), 7));
  let now = new Date();
  logger.info("setting archive time for page", {
    pageID: pageID,
    dateToBeArchived: dateToBeArchived,
    now: now,
    difference: dateToBeArchived.getTime() - now.getTime(),
  });
  setTimeout(async () => {
    await notion.pages.update({
      page_id: pageID,
      properties: {
        Status: {
          status: { name: "Archived" },
        },
      },
    });
    const [archiveQuery] = await DB.query<ResultSetHeader>(
      `
            UPDATE tasks
            SET page_status = "Archived"
            WHERE page_id = ?`,
      [pageID]
    );
    logger.info("in timeout, successfully archived page:", {
      pageID: pageID,
      numberOfRows: archiveQuery.affectedRows,
    });
  }, dateToBeArchived.getTime() - now.getTime());
}

// <--------------------------------Clean up logic ------------->
// <--------------------------------Clean up logic ------------->
// <--------------------------------Clean up logic ------------->
// <--------------------------------Clean up logic ------------->

// query when the last clean up of the archive column was
// and schedule the next weekly cleanup
export async function clearOutArchive() {
  interface ArchiveRes extends RowDataPacket {
    date: string;
  }
  let [query] = await DB.query<ArchiveRes[]>(
    `
            SELECT date FROM LastArchive
            WHERE id = '1'
        `,
    []
  );

  if (!query || query.length === 0) {
    logger.warn("No last archive record found");
    return;
  }
  logger.info("Last archive date", { date: query[0] });

  const dateString = query[0]?.date;

  let now = new Date();
  let lastArchived = new Date(dateString as string);
  let nextArchive = new Date(addDays(lastArchived.toISOString(), 7));
  setTimeout(async () => {
    let [toBeDeleted] = await DB.query<page[]>(
      `
            SELECT page_id FROM tasks
            WHERE page_status = "Archived"`,
      []
    );
    for (let p of toBeDeleted) {
      const response = await notion.pages.update({
        page_id: p.page_id,
        archived: true, // or in_trash: true
      });
      let deleteQuery = await DB.query(
        `
              DELETE FROM tasks
              WEHRE page_id = ?
          `,
        [p.page_id]
      );
      logger.info("successfully archived page: ", {
        id: p.page_id,
        response: response,
        dQeury: deleteQuery,
      });
    }
    let [res] = await DB.query<ResultSetHeader>(
      `
                UPDATE LastArchive
                SET date = ?
                WHERE id = '1'`,
      [nextArchive]
    );
    if (res.affectedRows != 1) {
      throw new Error("did not update correct archive removal time");
    }
  }, nextArchive.getTime() - now.getTime());
}
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
export async function getDueDatesList() {
  let [query] = await DB.query<page[]>(
    `
        SELECT page_id, deadline FROM tasks
        WHERE page_status IN ("In Progress", "To-Do", "Long Term To-Do", "Long Term In Progress")
        AND deadline IS NOT NULL`
  );
  logger.info("addToDueDateChangeList", query);
  for (let task of query) {
    await scheduleDueDateChange(task.page_id, task.deadline);
  }
}

/////////////////////// arent using this currently///////////
// figure it out after drawing out the flowchart and actually
// planning it
export async function addToDueDateList(pageID: string) {
  let deadline = await getDeadline(pageID);
  let [query] = await DB.query<ResultSetHeader>(
    `
      UPDATE tasks
      SET deadline = ?
      WHERE page_id = ?
        `,
    [deadline, pageID]
  );
  if (query.affectedRows != 1) {
    throw new Error("could not update deadline in DB");
  }
  if (deadline != null) await scheduleDueDateChange(pageID, deadline);
  logger.info("updating task with new deadline", {
    ID: pageID,
    deadline: deadline,
  });
}
export async function scheduleDueDateChange(pageID: string, dueDate: string) {
  // check if status is not done first, if it is update database?
  // if not done then extend database with notion SDK and then
  // update database?
  let deadline = new Date(dueDate);
  let now = new Date();
  logger.info("scheduling due date extension for", pageID, deadline);
  setTimeout(async () => {
    //get status and current deadline
    let status = await getStatus(pageID);
    let retrievedDeadline = await getDeadline(pageID);
    let retrievedDateObject = new Date(retrievedDeadline);
    let currPriority = await getPriority(pageID)
    logger.info("scheudle due date extension timeout:", {
      pageID: pageID,
      status: status,
      retrievedDateObject: retrievedDateObject,
      datestring: retrievedDeadline,
    });
    // check if not done and the deadline is same as was scheduled
    if (
      status != "Done" &&
      retrievedDateObject.toISOString() == deadline.toISOString()
    ) {
      let endDate;
      if (status == "To Do" || status == "In Progress") {
        endDate = addDays(retrievedDeadline, 2);
      } else {
        // if a long term task push back by 2 weeks
        endDate = addDays(retrievedDeadline, 14);
      }
      let dateupdate = await notion.pages.update({
        page_id: pageID,
        properties: {
          "Due Date": {
            date: {
              // push it back only by 2 for now, add custom functionality later?
              start: endDate,
            },
          },
          "ZGmH": {
            select: {
              name: escealatePriority(currPriority)
            }
          }
        },
      });
      logger.info("successfully extended deadline for page: ", {
        ID: pageID,
        dateUpdate: dateupdate,
      });
    }
    // if the deadline has been extended or changed
    else if (status != "Done" && retrievedDateObject != deadline) {
      let [updateDeadline] = await DB.query<ResultSetHeader>(
        `
            UPDATE tasks
            SET deadline = ?
            WHERE page_id = ?
          `,
        [retrievedDateObject, pageID]
      );
      if (updateDeadline.affectedRows != 1) {
        throw new Error("could not update new deadline in db");
      }
      logger.warn(
        "deadline was changed, updating DB from scheduleDueDateChange"
      );
      scheduleDueDateChange(pageID, retrievedDeadline);
    }
  }, deadline.getTime() - now.getTime());
}

// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->

export async function getRecurringTasks() {
  let [query] = await DB.query<page[]>(
    `
    SELECT page_id, recurrByDays FROM tasks
    WHERE isRecurring = 1
    `,
    []
  );
  for (let recurringTask of query) {
    toBeRecurred.set(recurringTask.page_id, recurringTask.recurrByDays);
  }
  logger.info("toBeRecurred", { value: toBeRecurred });
}

// low level give it pageID, will find the status and
// change it back to to-do with a new deadline
export async function RecurTask(pageID: string, recurrByDays: number) {
  // get the title here, instead of ID
  let title = await getTitle(pageID);
  let status = await getStatus(pageID);
  let date = new Date(await getDeadline(pageID));
  let now = new Date()
  if (date.getTime() > now.getTime()) {
    date = now
  }
  let newDeadline = addDays(date.toISOString(), recurrByDays);
  logger.info("logging recur task", {
    title: title,
    status: status,
    DueDate: date,
  });
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
        "ZGmH": {
          select: {
            name: "Low"
          }
        }
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
    logger.debug("event successfully altered", { query: query });
  } else {
    logger.info("status not done, not updating");
  }
}

// if recursion status changes change in DB and memory
export async function handleRecursionChange(pageID: string) {
  let query;
  let recurrByDays = await getRecursion(pageID);

  //add to recursion
  if (recurrByDays != null) {
    [query] = await DB.query<ResultSetHeader>(
      `
          UPDATE tasks
          SET isRecurring = 1, recurrByDays = ?
          WHERE page_id = ?
        `,
      [recurrByDays, pageID]
    );
    toBeRecurred.set(pageID, recurrByDays);
    logger.info("successfully changed recursion for page", {
      ID: pageID,
      recurr: toBeRecurred,
      affected: query.affectedRows,
    });
  }
  // if no recursion set up, delete from recursion list
  else {
    if (toBeRecurred.get(pageID) != null) {
      [query] = await DB.query<ResultSetHeader>(
        `
          UPDATE tasks
          SET isRecurring = 0, recurrByDays = 0
          WHERE page_id = ?
        `,
        [pageID]
      );
      toBeRecurred.delete(pageID);
      logger.info("successfully deleted recursion for page", {
        ID: pageID,
        recurred: toBeRecurred,
        affectedRows: query.affectedRows,
      });
    }
  }
}
