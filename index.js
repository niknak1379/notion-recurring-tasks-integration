import express from "express";
import dotenv from "dotenv";
import { Client } from "@notionhq/client";

// import { addDays, addHours, parseISO } from "date-fns";

import {
  isTrustedNotionRequest,
  updateValidationToken,
  addDays,
} from "./Utils/utils.js";

dotenv.config();

const app = express();

// needed for token verification
let rawBodySaver = function (req, res, buf, encoding) {
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

const PORT = process.env.PORT || 5000;
const notion = new Client({ auth: process.env.INTERNAL_INTEGRATION_SECRET });

// ROUTES --------------------------------------------------------

app.get("/", (req, res) => {
  return res.send("Server is alive 🚀");
});
// Health check
app.get("/health", (req, res) => {
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
app.post("/notion-webhook", async (req, res) => {
  try {
    const body = req.body;
    // console.log("logging webhook full request", req);
    console.log("Incoming Notion Event from Web-hook:\n", req.body, "\n");

    // handles subsequent verification requests
    if (!isTrustedNotionRequest(req)) {
      console.log("unable to verify, wrong validation token");
      return res.sendStatus(200);
    }
    console.log("verified notion signature, proceeding");

    // log event type
    if (body != null && "type" in body) {
      const eventType = body.type;
      console.log(`Received Notion event: ${eventType}`);

      if (eventType === "page.properties_updated") {
        await handleTaskUpdate(res, body);
      } else {
        console.log(
          "Ignoring event type, end of processing: ",
          eventType,
          "\n"
        );
      }
    } else {
      console.log("no request body found, still returning 200");
      return res.sendStatus(200);
    }
  } catch (err) {
    console.error("Error handling webhook:", err);
    if (!res.headersSent()) {
      return res.sendStatus(200);
    }
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
async function handleTaskUpdate(res, event) {
  console.log("handleTaskUpdate processing event:", event);

  let page = event?.entity;
  if (page.type != "page") {
    console.warn("No page on event");
    return res.sendStatus(200);
  }
  try {
    // get the title here, instead of ID
    let title = await notion.pages.properties.retrieve({
      page_id: page.id,
      property_id: "title", //this is hard coded for now but its the Date ID property
    });
    console.log(
      "logging title of retrieved page:",
      title.results[0].title.plain_text
    );
    if (title.results[0].title.plain_text == "Wash Bedsheets") {
      //wash id
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
                start: addDays(date.date.start, 2),
              },
            },
          },
        });
        console.log("event successfully altered");
        return res.sendStatus(200);
      } else {
        console.log("correct page, conditions for change not met");
        return res.sendStatus(200);
      }
    } else {
      console.log("irrelevent page, ignoring event");
      return res.sendStatus(200);
    }
  } catch (e) {
    console.log(e);
    return res.sendStatus(200);
  }
}

// -------------------------------------------------------------------

app.listen(5000, "0.0.0.0", async () => {
  console.log("Server running on port 5000");
  // https://www.notion.so/2b4269f72b2181e2a10cdc9bbb74fcce?v=2b4269f72b2181838bef000c0def3ecb
  // https://www.notion.so/Task-Management-Kanban-2b4269f72b2180bab647ea373eac964a

  /* const dataSourceId = process.env.dataSourceId;
  const response = await notion.dataSources.retrieve({
    data_source_id: dataSourceId,
  }); */
  /*   let title = await notion.pages.properties.retrieve({
    page_id: "2b4269f7-2b21-80ce-a7b6-eae879ac1b1b",
    property_id: "title", //this is hard coded for now but its the Date ID property
  }); */
  //console.log("response", title.results[0].title);
});
