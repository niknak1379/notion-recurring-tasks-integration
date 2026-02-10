import {
  DATASOURCE_ID,
  notion,
  getRecursion,
  getStatus,
  getDeadline,
  getTitle,
  addDays,
  toBeRecurred,
  escealatePriority,
  getPriority,
  getTask,
  setTask,
  getAllTasks,
  deleteTask,
} from "./utils.js";
import logger from "./logger.js";
import { type PageObjectResponse } from "@notionhq/client";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { DB } from "./utils.js";


// <--------------------------------Data Base logic ------------->
// <--------------------------------Data Base logic ------------->
// <--------------------------------Data Base logic ------------->
// <--------------------------------Data Base logic ------------->

// syncs entire in-memory store for already existing tasks and for initializing
export async function syncDataBase() {
  logger.info("Clearing all in-memory entries for resync");
  
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
      const startDate = dueDate.date?.start;
      if (startDate) {
        const parsedDate = new Date(startDate);
        if (!isNaN(parsedDate.getTime())) {
          deadline = parsedDate;
        }
      }
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
    
    logger.info("storing task in memory", {
      title: name,
      isrecurring: isRecurring,
      recurrDays: recurrByDays,
      status: statusName,
      deadline: deadline,
    });

    // Store in memory
    setTask(task.id, {
      name,
      page_id: task.id,
      deadline: deadline?.toISOString() || null,
      page_status: statusName,
      last_changed: task.last_edited_time,
      isRecurring,
      recurrByDays,
    });

    logger.info("Stored task in memory:", task.id);
  }
}

export async function addTaskToDB(pageID: string, creationTime: string) {
  let isRecurring = 0;
  let recurrByDays = await getRecursion(pageID);
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
  logger.info("adding single page to memory", {
    title: title,
    status: status,
    deadline: deadline,
    isRecurring: isRecurring,
    recurrByDays: recurrByDays,
  });
  
  setTask(pageID, {
    name: title,
    page_id: pageID,
    deadline: deadline,
    page_status: status,
    last_changed: creationTime,
    isRecurring,
    recurrByDays,
  });
  
  logger.info("stored task in memory:", pageID);
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
  let allTasks = getAllTasks();
  let doneTasks = allTasks.filter(task => task.page_status === "Done");
  
  for (let task of doneTasks) {
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
    let task = getTask(pageID);
    if (task) {
      task.last_changed = lastModified;
      task.page_status = "Done";
      setTask(pageID, task);
      logger.info("updated task in memory for archive list");
    }
    scheduleArchive(pageID, lastModified);
  }
}

// schedules the timeout for being archived,
// negative timeout is basically immediate execution so thats fine
async function scheduleArchive(pageID: string, lastModified: string) {
  let lastModifiedDate = new Date(lastModified);
  if (isNaN(lastModifiedDate.getTime())) {
    logger.warn("Invalid lastModified date, skipping archive scheduling", { pageID, lastModified });
    return;
  }
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
    let task = getTask(pageID);
    if (task) {
      task.page_status = "Archived";
      setTask(pageID, task);
      logger.info("in timeout, successfully archived page in memory:", {
        pageID: pageID,
      });
    }
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
    let allTasks = getAllTasks();
    let archivedTasks = allTasks.filter(task => task.page_status === "Archived");
    
    for (let task of archivedTasks) {
      const response = await notion.pages.update({
        page_id: task.page_id,
        archived: true,
      });
      deleteTask(task.page_id);
      logger.info("successfully archived page: ", {
        id: task.page_id,
        response: response,
      });
    }
    
    let [res] = await DB.query<ResultSetHeader>(
      `
                UPDATE LastArchive
                SET date = ?
                WHERE id = '1'`,
      [nextArchive.toISOString()]
    );
    if (res.affectedRows != 1) {
      throw new Error("did not update correct archive removal time");
    }
    logger.info("Updated last archive date");
  }, nextArchive.getTime() - now.getTime());
}
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
export async function getDueDatesList() {
  let allTasks = getAllTasks();
  let activeTasks = allTasks.filter(task => 
    ["In Progress", "To-Do", "Long Term To-Do", "Long Term In Progress"].includes(task.page_status) &&
    task.deadline !== null
  );
  
  logger.info("found tasks with deadlines", activeTasks);
  for (let task of activeTasks) {
    await scheduleDueDateChange(task.page_id, task.deadline!);
  }
}

/////////////////////// arent using this currently///////////
// figure it out after drawing out the flowchart and actually
// planning it
export async function addToDueDateList(pageID: string) {
  let deadline = await getDeadline(pageID);
  let task = getTask(pageID);
  if (task) {
    task.deadline = deadline;
    setTask(pageID, task);
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
  if (isNaN(deadline.getTime())) {
    logger.warn("Invalid due date, skipping deadline scheduling", { pageID, dueDate });
    return;
  }
  let now = new Date();
  logger.info("scheduling due date extension for", pageID, deadline);
  setTimeout(async () => {
    //get status and current deadline
    let status = await getStatus(pageID);
    let retrievedDeadline = await getDeadline(pageID);
    let retrievedDateObject = new Date(retrievedDeadline);
    if (isNaN(retrievedDateObject.getTime())) {
      logger.warn("Invalid retrieved deadline, skipping due date change", { pageID, retrievedDeadline });
      return;
    }
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
      } else if (status == "Long Term To-Do" || status == "Long Term In Progress") {
        // if a long term task push back by 2 weeks
        endDate = addDays(retrievedDeadline, 14);
      } else {
        return
      }
      let dateupdate = await notion.pages.update({
        page_id: pageID,
        properties: {
          "Due Date": {
            date: {
              // push it back only by 2 for now, add custom functionality later?
              start: endDate as string,
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
    else if (status != "Done" && retrievedDateObject.getTime() !== deadline.getTime()) {
      let task = getTask(pageID);
      if (task) {
        task.deadline = retrievedDateObject.toISOString();
        setTask(pageID, task);
      }
      logger.warn(
        "deadline was changed, updating memory from scheduleDueDateChange"
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
  let allTasks = getAllTasks();
  let recurringTasks = allTasks.filter(task => task.isRecurring === 1);
  
  for (let task of recurringTasks) {
    toBeRecurred.set(task.page_id, task.recurrByDays);
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
  if (isNaN(date.getTime())) {
    logger.warn("Invalid date in RecurTask, using current time", { pageID });
    date = now;
  } else if (date.getTime() < now.getTime()) {
    date = now;
  }
  let newDeadline = addDays(date.toISOString(), recurrByDays);
  logger.info("logging recur task", {
    title: title,
    status: status,
    DueDate: date,
    NewDeadline: newDeadline,
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
    let task = getTask(pageID);
    if (task) {
      task.page_status = "To-Do";
      task.deadline = newDeadline;
      setTask(pageID, task);
      logger.debug("event successfully altered in memory");
    }
  } else {
    logger.info("status not done, not updating");
  }
}

// if recursion status changes change in DB and memory
export async function handleRecursionChange(pageID: string) {
  let recurrByDays = await getRecursion(pageID);
  let task = getTask(pageID);

  if (!task) return;

  //add to recursion
  if (recurrByDays != null) {
    task.isRecurring = 1;
    task.recurrByDays = recurrByDays;
    setTask(pageID, task);
    toBeRecurred.set(pageID, recurrByDays);
    logger.info("successfully changed recursion for page", {
      ID: pageID,
      recurr: toBeRecurred,
    });
  }
  // if no recursion set up, delete from recursion list
  else {
    if (toBeRecurred.get(pageID) != null) {
      task.isRecurring = 0;
      task.recurrByDays = 0;
      setTask(pageID, task);
      toBeRecurred.delete(pageID);
      logger.info("successfully deleted recursion for page", {
        ID: pageID,
        recurred: toBeRecurred,
      });
    }
  }
}
