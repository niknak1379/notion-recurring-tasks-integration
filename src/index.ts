import express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";

// import { addDays, addHours, parseISO } from "date-fns";

import { isTrustedNotionRequest, toBeRecurred } from "./Utils/utils.js";
import {
  addTaskToDB,
  handleRecursionChange,
  RecurTask,
  getRecurringTasks,
  syncDataBase,
  addToArchiveList,
  clearOutArchive,
  getToArchiveList,
  getDueDatesList,
  addToDueDateList,
} from "./Utils/taskUpdate.js";
import logger from "./Utils/logger.js";
dotenv.config();

const app = express();

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}
interface webhook {
  type: string,
  timestamp: string,
  data: {
    updated_properties: [string],
  },
  entity: {
    id: string,
    type: string,
  }
}
const rawBodySaver = (
  req: Request,
  _res: Response,
  buf: Buffer,
  encoding: BufferEncoding
): void => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  }
};

app.use(
  express.json({
    verify: rawBodySaver,
  })
);
/* app.use((req, res, next) => {
  res.setHeader("Notion-Version", "2025-09-03");
  next();
}); */

// ROUTES --------------------------------------------------------

app.get("/", (_req: Request, res: Response) => {
  return res.send("Server is alive 🚀");
});
// Health check
app.get("/health", (_req: Request, res: Response) => {
  return res.send("healthy");
});
// https://developers.notion.com/reference/webhooks-events-delivery
// https://developers.notion.com/reference/query-a-data-source
// https://developers.notion.com/reference/retrieve-a-page
// https://developers.notion.com/reference/retrieve-a-page-property
// Main webhook endpoint
// sample incoming event structure:
/*
    logging webhook body {
      id: '084e4f4d-5766-43f3-b1fb-7cf07557601a',
      timestamp: '2025-12-01T18:46:20.822Z',
      workspace_id: '25528fac-c6f3-4290-b1b6-c951b07b82a1',
      workspace_name: "nikan ostovan's Notion",
      subscription_id: '2b6d872b-594c-819d-a73b-00991c118585',
      integration_id: '2b4d872b-594c-8052-abba-00370826bb42',
      authors: [ { id: '155b14e0-922a-4b1a-be25-3363d7bc4594', type: 'person' } ],
      attempt_number: 6,
      api_version: '2025-09-03',
      entity: { id: '2bc269f7-2b21-80c9-b373-e810c6b0ab68', type: 'page' },
      type: 'page.deleted',
      data: {
        parent: {
          id: '2b4269f7-2b21-81e2-a10c-dc9bbb74fcce',
          type: 'database',
          data_source_id: '2b4269f7-2b21-8123-9dd0-000bdddf3adf'
        }
      }
    }
  */
app.post("/notion-webhook", async (req: Request, res: Response) => {
  const body = req.body;
  logger.info("Incoming Notion Event from Web-hook:\n", { body: req.body });

  // handles subsequent verification requests
  if (!isTrustedNotionRequest(req)) {
    logger.error("unable to verify, wrong validation token");
    res.sendStatus(200);
    return;
  }
  logger.info("verified notion signature, proceeding");

  // log event type
  if (body != null && "type" in body) {
    const eventType = body.type;
    logger.info(`Received Notion event: ${eventType}`);
    if (
      eventType === "page.properties_updated" ||
      eventType === "page.created"
    ) {
      handleTaskUpdate(body as webhook);
      res.sendStatus(200);
      return;
    } else {
      logger.info("Ignoring event type, end of processing: ", {
        eventType: eventType,
      });
      res.sendStatus(200);
      return;
    }
  } else {
    logger.error("no request body found, still returning 200");
    res.sendStatus(200);
    return;
  }
});

// --- Event handler logic -------------------------------------------

/**
 * See if it the task changed is the
 * recurring task and if so set it up
 * for its next appearance
 * 
 *     // Sample response type from Notion API
    /*     response {
              object: 'list',
              results: [
                {
                  object: 'property_item',
                  type: 'title',
                  id: 'title',
                  title: [Object]
                }
              ],
              next_cursor: null,
              has_more: false,
              type: 'property_item',
              property_item: { id: 'title', next_url: null, type: 'title', title: {} },
              request_id: '8f8d2b03-a85d-4aaa-a722-a7042bae4158'
            } 


            title object format:  
            response {
              type: 'text',
              text: { content: 'Wash Bedsheets', link: null },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: 'default'
              },
              plain_text: 'Wash Bedsheets',
              href: null
            }
            
 */

// handle change in tasks and new tasks
async function handleTaskUpdate(event: webhook) {
  logger.info("logging webhook object", { object: event })
  if (event.type === "page.properties_updated") {

    // check if it is a recurring task
    switch (true) {
      case event.data.updated_properties.includes("G%5Db%3B"): //due date
        await addToDueDateList(event.entity.id);
        break;
      case event.data.updated_properties.includes("blD%7D"): //status
        if (toBeRecurred.get(event.entity.id) != null) {
          // checks if it is done or not and recurrs and changes the deadline
          // if it is
          logger.info("recurring task", { id: event.entity.id });
          await RecurTask(
            event.entity.id,
            toBeRecurred.get(event.entity.id) as number
          );
        } else {
          logger.info("adding to archive list", { id: event.entity.id });
          await addToArchiveList(event.entity.id, event.timestamp);
        }
        break;
      case event.data.updated_properties.includes("jSyh"): //recurring
        await handleRecursionChange(event.entity.id);
        break;
    }
  } else if (event.type === "page.created") {
    await addTaskToDB(event.entity.id, event.timestamp);
  }
}

// -------------------------------------------------------------------

app.listen(5000, "0.0.0.0", async () => {
  logger.info("Server running on port 5000");
  await syncDataBase();
  await getRecurringTasks();
  clearOutArchive();
  setInterval(() => {
    clearOutArchive();
  }, 604800000); //weekly cleanup

  await getToArchiveList();
  await getDueDatesList();
});
