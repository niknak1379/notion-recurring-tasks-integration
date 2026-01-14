// --- Utils ---------------------------------------------------------
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import {
	Client,
	type PageObjectResponse,
	type PropertyItemObjectResponse,
} from "@notionhq/client";
import mysql, {
	type FieldPacket,
	type ResultSetHeader,
	type RowDataPacket,
} from "mysql2";
import dotenv from "dotenv";

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
}
interface page extends RowDataPacket {
	page_id: string;
	last_changed: string;
	deadline: string;
	recurrByDays: number;
}
// ----------------------DB and notion Client Init ---------->
// ----------------------DB and notion Client Init ---------->
// ----------------------DB and notion Client Init ---------->
// ----------------------DB and notion Client Init ---------->
export let verificationToken = "";
export let toBeDueDateChanged = [];
export let toBeRecurred = new Map();
dotenv.config();

//environment variables initialization and validation
const refreshTokenId = process.env["REFRESH_TOKEN_ID"];
const MYSQL_HOST = process.env["MYSQL_HOST"];
const MYSQL_USER = process.env["MYSQL_USER"];
const MYSQL_PASSWORD = process.env["MYSQL_PASSWORD"];
const MYSQL_DATABASE = process.env["MYSQL_DATABASE"];
const INTERNAL_INTEGRATION_SECRET = process.env["INTERNAL_INTEGRATION_SECRET"];
const REFRESH_TOKEN_ID = process.env["REFRESH_TOKEN_ID"];
const DATASOURCE_ID = process.env["DATASOURCE_ID"];
if (
	!refreshTokenId ||
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

const DB = mysql
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
	try {
		if (verificationToken == "") {
			verificationToken = await getValidationToken(req);
			console.log("token", verificationToken);
		}
		const rawBody = req.rawBody || JSON.stringify(req.body);
		const calculatedSignature = `sha256=${createHmac(
			"sha256",
			verificationToken
		)
			.update(rawBody)
			.digest("hex")}`;
		let { "x-notion-signature": notion_header } = req.headers;
		// console.log(calculatedSignature, notion_header);
		return timingSafeEqual(
			Buffer.from(calculatedSignature),
			Buffer.from(notion_header as string)
		);
	} catch (e) {
		console.warn(e);
		return false;
	}
}

export async function getValidationToken(req: Request): Promise<string> {
	try {
		interface TokenRow extends RowDataPacket {
			refreshToken: string;
		}

		const [rows] = await DB.query<TokenRow[]>(
			`SELECT refreshToken FROM Tokens WHERE id = ?`,
			[refreshTokenId]
		);

		if (!rows || rows.length === 0) {
			const { "x-notion-signature": notion_header } = req.headers;

			if (notion_header && typeof notion_header === "string") {
				await updateValidationToken(notion_header);
				return notion_header;
			}

			throw new Error("No token found and no header provided");
		}

		const tokenRow = rows[0];

		if (
			!tokenRow ||
			!tokenRow.refreshToken ||
			tokenRow.refreshToken === "NULL" ||
			tokenRow.refreshToken === ""
		) {
			const { "x-notion-signature": notion_header } = req.headers;

			if (!notion_header) {
				throw new Error("No valid token or header");
			}

			const token = Array.isArray(notion_header)
				? notion_header[0]
				: notion_header;
			updateValidationToken(token as string);
			return token as string;
		}

		return tokenRow.refreshToken;
	} catch (e) {
		console.warn("Error getting validation token:", e);
		return "";
	}
}

//idk what this returns for now i have to make a new connection
// and test it out
export async function updateValidationToken(token: string): Promise<void> {
	try {
		let [updated] = await DB.query<ResultSetHeader>(
			`
        UPDATE Tokens
        SET refreshToken = ?
        WHERE id = ?`,
			[token, REFRESH_TOKEN_ID]
		);
		if (updated.affectedRows != 1) {
			throw new Error("Could not update refresh token");
		}
		// console.log("update token results", query, query[0]);
	} catch (e) {
		console.warn(e);
	}
}

// --------------------------Helper Functions-------------------------//
// --------------------------Helper Functions-------------------------//
// --------------------------Helper Functions-------------------------//
// --------------------------Helper Functions-------------------------//

async function getStatus(pageID: string): Promise<string> {
	try {
		const status = (await notion.pages.properties.retrieve({
			page_id: pageID,
			property_id: "blD%7D",
		})) as unknown as notoinPageProperty;

		if (!status.status || !status.status.name) {
			throw new Error("Status property not found or has no name");
		}

		return status.status.name;
	} catch (e) {
		console.error("Error retrieving page status:", e);
		throw e;
	}
}
async function getDeadline(pageID: string): Promise<string> {
	let date = (await notion.pages.properties.retrieve({
		page_id: pageID,
		property_id: "G%5Db%3B", //this is hard coded for now but its the Date ID property
	})) as unknown as notoinPageProperty;
	return date.date.start;
}
async function getTitle(pageID: string) {
	let title = (await notion.pages.properties.retrieve({
		page_id: pageID,
		property_id: "title", //this is hard coded for now but its the Date ID property
	})) as unknown as notoinPageProperty;
	return title.results[0].title.plain_text;
}
export async function getRecursion(pageID: string): Promise<number> {
	let recurrByDays = (await notion.pages.properties.retrieve({
		page_id: pageID,
		property_id: "jSyh", //this is hard coded for now but its the recursion ID
	})) as unknown as notoinPageProperty;
	return recurrByDays.number;
}
/**
 * Add days to an ISO date string
 */
export function addDays(isoString: string, days: number): string {
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

			// Insert into database
			const result = await DB.query(
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

			console.log("Inserted task:", result[0]);
		}
	} catch (e) {
		console.error("Error syncing database:", e);
	}
}

export async function addToDB(pageID: string, creationTime: string) {
	try {
		let isRecurring = 0;
		let recurrByDays = getRecursion(pageID);
		if (recurrByDays != null) {
			isRecurring = 1;
		}
		let status = await getStatus(pageID);
		let deadline = await getDeadline(pageID);
		let title = await getTitle(pageID);
		let query = await DB.query(
			`
          INSERT INTO tasks (name, page_ID, deadline, page_status, last_changed, isRecurring, recurrByDays)
          Values(?, ?, ?, ?, ?, ?, ?)
        `,
			[title, pageID, deadline, status, creationTime, isRecurring, recurrByDays]
		);
		console.log("successfully added new task to DB", query[0]);
		if (isRecurring) {
			await handleRecursionChange(pageID);
		}

		if (deadline != null) {
			await addToDueDateChangeList(pageID);
		}
		if (status == "Done") {
			addToArchiveList(pageID, creationTime);
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
	try {
		let [query] = await DB.query<page[]>(
			`
    SELECT page_id, last_changed FROM tasks
    WHERE page_status = "DONE"
    `,
			[]
		);
		console.log("gettoArchiveList", query);
		for (let task of query) {
			scheduleArchive(task.page_id, task.last_changed);
		}
	} catch (e) {
		console.log(e);
	}
}
// changes task status to Done and adds to the to be archived timeouts
// will have to figure out when to call this on the event handler page
export async function addToArchiveList(pageID: string, lastModified: string) {
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
async function scheduleArchive(pageID: string, lastModified: string) {
	let lastModifiedDate = new Date(lastModified);
	let dateToBeArchived = new Date(addDays(lastModifiedDate.toISOString(), 7));
	let now = new Date();
	console.log(
		"date to be archived, now, difference",
		dateToBeArchived,
		now,
		dateToBeArchived.getTime() - now.getTime()
	);
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
			const archiveQuery = await DB.query(
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
		console.warn("No archive record found");
		return;
	}
	console.log("Last archive date", query[0]);

	const dateString = query[0]?.date;

	let now = new Date();
	let lastArchived = new Date(dateString as string);
	let nextArchive = new Date(addDays(lastArchived.toISOString(), 7));
	setTimeout(async () => {
		try {
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
				console.log(
					"successfully archived page: ",
					p.page_id,
					response,
					deleteQuery
				);
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
		} catch (e) {
			console.log(e);
		}
	}, nextArchive.getTime() - now.getTime());
}
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
// <--------------------------------DueDate Extension logic ------------->
export async function getToDueDateChangeList() {
	try {
		let [query] = await DB.query<page[]>(
			`
    SELECT page_id, deadline FROM tasks
    WHERE page_status IN ("In Progress", "To-Do")
    AND deadline IS NOT NULL`
		);
		console.log("addToDueDateChangeList", query[0]);
		for (let task of query) {
			await scheduleDueDateChange(task.page_id, task.deadline);
		}
	} catch (e) {
		console.log(e);
	}
}

/////////////////////// arent using this currently///////////
// figure it out after drawing out the flowchart and actually
// planning it
export async function addToDueDateChangeList(pageID: string) {
	try {
		let deadline = await getDeadline(pageID);
		let [query] = await DB.query<ResultSetHeader>(
			`
      UPDATE tasks
      SET deadline = ?
      WHERE page = ?
        `,
			[deadline, pageID]
		);
		if (query.affectedRows != 1) {
			throw new Error("could not update deadline in DB");
		}
		if (deadline != null) await scheduleDueDateChange(pageID, deadline);
		console.log("updating task with new deadline", pageID, deadline);
	} catch (e) {
		console.log(e);
	}
}
export async function scheduleDueDateChange(pageID: string, dueDate: string) {
	// check if status is not done first, if it is update database?
	// if not done then extend database with notion SDK and then
	// update database?
	let deadline = new Date(dueDate);
	let now = new Date();
	console.log("scheduling due date extension for", pageID, deadline);
	setTimeout(async () => {
		try {
			//get status and current deadline
			let status = await getStatus(pageID);
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
								start: addDays(retrievedDeadline, 2),
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
				console.log(
					"deadline was changed, updating DB from scheduleDueDateChange"
				);
				scheduleDueDateChange(pageID, retrievedDeadline);
			}
		} catch (e) {
			console.log(e);
		}
	}, deadline.getTime() - now.getTime());
}

// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->
// <--------------------------------recurring tasks logic ------------->

export async function getToBeRecurred() {
	try {
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
		console.log("toBeRecurred", toBeRecurred);
	} catch (e) {
		console.log(e);
	}
}

// low level give it pageID, will find the status and
// change it back to to-do with a new deadline
export async function RecurTask(pageID: string, recurrByDays: number) {
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
			console.log("event successfully altered", query);
		} else {
			console.log("correct page, conditions for change not met");
		}
	} catch (e) {
		console.log(e);
	}
}

export async function handleRecursionChange(pageID: string) {
	let query;
	try {
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
			console.log(
				"successfully changed recursion for page",
				pageID,
				toBeRecurred,
				query.affectedRows
			);
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
				console.log(
					"successfully deleted recursion for page",
					pageID,
					toBeRecurred,
					query.affectedRows
				);
			}
		}
	} catch (e) {
		console.log(e);
	}
}
