import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

interface ApplePimConfig {
  binDir?: string;
  profile?: string;
  domains?: {
    calendars?: boolean;
    reminders?: boolean;
    contacts?: boolean;
    mail?: boolean;
  };
}

function findBin(name: string, binDir?: string): string {
  if (binDir) return path.join(binDir, name);

  // Check ~/.local/bin first
  const localBin = path.join(os.homedir(), ".local", "bin", name);
  try {
    execSync(`test -x ${localBin}`);
    return localBin;
  } catch {
    // fall through
  }

  return name; // rely on PATH
}

function runCli(bin: string, args: string[], profile?: string): string {
  const profileFlag = profile ? `--profile ${profile}` : "";
  try {
    return execSync(`${bin} ${profileFlag} ${args.join(" ")}`, {
      encoding: "utf-8",
      timeout: 15_000,
    }).trim();
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stderr" in err) {
      return `Error: ${(err as { stderr: string }).stderr}`.trim();
    }
    return `Error: ${bin} command failed. Are the Swift CLIs installed? Run ./setup.sh --install`;
  }
}

export default definePluginEntry({
  id: "apple-pim",
  name: "Apple PIM",
  description: "Native macOS Calendar, Reminders, Contacts, and Mail.app",
  register(api) {
    if (process.platform !== "darwin") {
      api.logger.warn("Apple PIM plugin is macOS-only. Skipping registration.");
      return;
    }

    const config = (api.pluginConfig ?? {}) as ApplePimConfig;
    const binDir = config.binDir;
    const profile = config.profile;
    const domains = config.domains ?? {};

    // Calendar tools
    if (domains.calendars !== false) {
      const calendarBin = findBin("calendar-cli", binDir);

      api.registerTool(
        () => ({
          name: "apple_pim_calendar",
          description:
            "Manage macOS Calendar — list calendars, create/read/update/delete events, search by date or title. Supports recurring events.",
          parameters: {
            type: "object" as const,
            properties: {
              action: {
                type: "string",
                enum: ["list-calendars", "list-events", "create-event", "get-event", "update-event", "delete-event", "search"],
                description: "Calendar action",
              },
              calendar: { type: "string", description: "Calendar name" },
              title: { type: "string", description: "Event title" },
              startDate: { type: "string", description: "Start date (ISO 8601)" },
              endDate: { type: "string", description: "End date (ISO 8601)" },
              eventId: { type: "string", description: "Event ID for get/update/delete" },
              query: { type: "string", description: "Search query" },
              location: { type: "string", description: "Event location" },
              notes: { type: "string", description: "Event notes" },
              recurrence: { type: "string", description: "Recurrence rule (daily, weekly, monthly, yearly)" },
            },
            required: ["action"],
          },
          async execute(params: Record<string, unknown>) {
            const args: string[] = [params.action as string];
            if (params.calendar) args.push("--calendar", `"${params.calendar}"`);
            if (params.title) args.push("--title", `"${params.title}"`);
            if (params.startDate) args.push("--start", params.startDate as string);
            if (params.endDate) args.push("--end", params.endDate as string);
            if (params.eventId) args.push("--id", params.eventId as string);
            if (params.query) args.push("--query", `"${params.query}"`);
            if (params.location) args.push("--location", `"${params.location}"`);
            if (params.notes) args.push("--notes", `"${params.notes}"`);
            if (params.recurrence) args.push("--recurrence", params.recurrence as string);
            return runCli(calendarBin, args, profile);
          },
        }),
        { names: ["apple_pim_calendar"] },
      );
    }

    // Reminders tools
    if (domains.reminders !== false) {
      const reminderBin = findBin("reminder-cli", binDir);

      api.registerTool(
        () => ({
          name: "apple_pim_reminder",
          description:
            "Manage macOS Reminders — list reminder lists, create/complete/update/delete reminders, search, and set due dates.",
          parameters: {
            type: "object" as const,
            properties: {
              action: {
                type: "string",
                enum: ["list-lists", "list-reminders", "create", "complete", "update", "delete", "search"],
                description: "Reminder action",
              },
              list: { type: "string", description: "Reminder list name" },
              title: { type: "string", description: "Reminder title" },
              dueDate: { type: "string", description: "Due date (ISO 8601)" },
              reminderId: { type: "string", description: "Reminder ID" },
              query: { type: "string", description: "Search query" },
              notes: { type: "string", description: "Reminder notes" },
              priority: { type: "number", description: "Priority (1=high, 5=medium, 9=low)" },
            },
            required: ["action"],
          },
          async execute(params: Record<string, unknown>) {
            const args: string[] = [params.action as string];
            if (params.list) args.push("--list", `"${params.list}"`);
            if (params.title) args.push("--title", `"${params.title}"`);
            if (params.dueDate) args.push("--due", params.dueDate as string);
            if (params.reminderId) args.push("--id", params.reminderId as string);
            if (params.query) args.push("--query", `"${params.query}"`);
            if (params.notes) args.push("--notes", `"${params.notes}"`);
            if (params.priority) args.push("--priority", String(params.priority));
            return runCli(reminderBin, args, profile);
          },
        }),
        { names: ["apple_pim_reminder"] },
      );
    }

    // Contacts tools
    if (domains.contacts !== false) {
      const contactBin = findBin("contact-cli", binDir);

      api.registerTool(
        () => ({
          name: "apple_pim_contact",
          description:
            "Manage macOS Contacts — list groups, create/read/update/delete contacts, search by name/email/phone.",
          parameters: {
            type: "object" as const,
            properties: {
              action: {
                type: "string",
                enum: ["list-groups", "list-contacts", "create", "get", "update", "delete", "search"],
                description: "Contact action",
              },
              group: { type: "string", description: "Contact group name" },
              name: { type: "string", description: "Contact name" },
              email: { type: "string", description: "Email address" },
              phone: { type: "string", description: "Phone number" },
              contactId: { type: "string", description: "Contact ID" },
              query: { type: "string", description: "Search query" },
            },
            required: ["action"],
          },
          async execute(params: Record<string, unknown>) {
            const args: string[] = [params.action as string];
            if (params.group) args.push("--group", `"${params.group}"`);
            if (params.name) args.push("--name", `"${params.name}"`);
            if (params.email) args.push("--email", params.email as string);
            if (params.phone) args.push("--phone", params.phone as string);
            if (params.contactId) args.push("--id", params.contactId as string);
            if (params.query) args.push("--query", `"${params.query}"`);
            return runCli(contactBin, args, profile);
          },
        }),
        { names: ["apple_pim_contact"] },
      );
    }

    // Mail tools
    if (domains.mail !== false) {
      const mailBin = findBin("mail-cli", binDir);

      api.registerTool(
        () => ({
          name: "apple_pim_mail",
          description:
            "Manage macOS Mail.app — list accounts/mailboxes, read/search/send/reply messages, update flags. Requires Mail.app to be running.",
          parameters: {
            type: "object" as const,
            properties: {
              action: {
                type: "string",
                enum: ["list-accounts", "list-mailboxes", "list-messages", "get", "search", "send", "reply", "move", "delete", "flag"],
                description: "Mail action",
              },
              account: { type: "string", description: "Mail account name" },
              mailbox: { type: "string", description: "Mailbox name (e.g., INBOX)" },
              messageId: { type: "string", description: "Message ID" },
              to: { type: "string", description: "Recipient email (for send)" },
              subject: { type: "string", description: "Email subject (for send)" },
              body: { type: "string", description: "Email body (for send/reply)" },
              query: { type: "string", description: "Search query" },
              flag: { type: "string", description: "Flag to set (read, unread, flagged, unflagged)" },
            },
            required: ["action"],
          },
          async execute(params: Record<string, unknown>) {
            const args: string[] = [params.action as string];
            if (params.account) args.push("--account", `"${params.account}"`);
            if (params.mailbox) args.push("--mailbox", `"${params.mailbox}"`);
            if (params.messageId) args.push("--id", params.messageId as string);
            if (params.to) args.push("--to", params.to as string);
            if (params.subject) args.push("--subject", `"${params.subject}"`);
            if (params.body) args.push("--body", `"${params.body}"`);
            if (params.query) args.push("--query", `"${params.query}"`);
            if (params.flag) args.push("--flag", params.flag as string);
            return runCli(mailBin, args, profile);
          },
        }),
        { names: ["apple_pim_mail"] },
      );
    }
  },
});
