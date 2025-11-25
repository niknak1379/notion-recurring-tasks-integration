import express from "express";
import dotenv from "dotenv";
import { Client } from "@notionhq/client";

// import { addDays, addHours, parseISO } from "date-fns";

import {
  isTrustedNotionRequest,
  updateValidationToken,
  addDays,
} from "./utils.js";

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

app.use((req, res, next) => {
  res.setHeader("Notion-Version", "2025-09-03");
  next();
});

const PORT = process.env.PORT || 5000;
const notion = new Client({ auth: process.env.INTERNAL_INTEGRATION_SECRET });

// ROUTES --------------------------------------------------------

app.get("/", (req, res) => {
  res.send("Server is alive 🚀");
});
// Health check
app.get("/health", (req, res) => {
  res.send("healthy");
});
// https://developers.notion.com/reference/webhooks-events-delivery
// https://developers.notion.com/reference/query-a-data-source
// https://developers.notion.com/reference/retrieve-a-page
// https://developers.notion.com/reference/retrieve-a-page-property
// Main webhook endpoint
app.post("/notion-webhook", async (req, res) => {
  try {
    const body = req.body;
    // console.log("logging webhook full request", req);
    console.log("logging webhook body", req.body);

    // handles subsequent verification requests
    if (!isTrustedNotionRequest(req)) {
      console.log("unable to verify, wrong validation token");
      return res.status(401).send("Invalid token");
    }
    console.log("verified, proceeding");

    // log event type
    if (body != null && "type" in body) {
      const eventType = body.type;
      console.log(`Received Notion event: ${eventType}`);

      if (eventType === "page.properties_updated") {
        await handleTaskUpdate(res, body);
      } else {
        console.log("Ignoring event type ", eventType);
      }

      res.status(200).send("OK");
    }
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.status(500).send("Server error");
  }
});

// --- Event handler logic -------------------------------------------

/**
 * See if it the task changed is the
 * recurring task and if so set it up
 * for its next appearance
 */
async function handleTaskUpdate(res, event) {
  console.log(event);

  let page = event?.entity;
  if (page.type != "page") {
    console.warn("No page on event");
    return;
  }
  try {
    if ((page.id = "2b4269f7-2b21-80ce-a7b6-eae879ac1b1b")) {
      //wash id
      let status = await notion.pages.properties.retrieve({
        page_id: page.id,
        property_id: "blD%7D", //this is hard coded for now but its the Status ID property
      });
      let date = await notion.pages.properties.retrieve({
        page_id: page.id,
        property_id: "G%5Db%3B", //this is hard coded for now but its the Date ID property
      });

      if (status == "Done") {
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
        res.send("success").status(200);
      }
      console.log("unrelated event no changes done");
      res.send("success").status(200);
    } else {
      console.log("irrelevent page, ignoring event");
      res.status(200);
    }
  } catch (e) {
    console.log(e);
  }
}

// -------------------------------------------------------------------

app.listen(5000, "0.0.0.0", () => {
  console.log("Server running on port 5000");
});
