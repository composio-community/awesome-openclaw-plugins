import { definePluginEntry } from "openclaw/plugin-sdk/core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

interface TimeTrackerConfig {
  dataDir?: string;
}

interface TimeEntry {
  id: string;
  task: string;
  project: string;
  startedAt: string;
  endedAt: string | null;
  tags: string[];
}

interface TimeStore {
  entries: TimeEntry[];
  activeEntry: TimeEntry | null;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function getDuration(entry: TimeEntry): number {
  const start = new Date(entry.startedAt).getTime();
  const end = entry.endedAt ? new Date(entry.endedAt).getTime() : Date.now();
  return end - start;
}

export default definePluginEntry({
  id: "time-tracker",
  name: "Time Tracker",
  description: "Track time spent on tasks and projects",
  register(api) {
    const config = (api.pluginConfig ?? {}) as TimeTrackerConfig;
    const dataDir = config.dataDir ?? path.join(os.homedir(), ".openclaw", "time-tracker");
    const storeFile = path.join(dataDir, "entries.json");

    async function loadStore(): Promise<TimeStore> {
      try {
        const raw = await fs.readFile(storeFile, "utf-8");
        return JSON.parse(raw);
      } catch {
        return { entries: [], activeEntry: null };
      }
    }

    async function saveStore(store: TimeStore) {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(storeFile, JSON.stringify(store, null, 2));
    }

    api.registerTool(
      () => ({
        name: "time_start",
        description: "Start tracking time for a task. Automatically stops any running timer.",
        parameters: {
          type: "object" as const,
          properties: {
            task: { type: "string", description: "Task description" },
            project: { type: "string", description: "Project name (default: current directory name)" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for categorization (e.g., ['bugfix', 'frontend'])",
            },
          },
          required: ["task"],
        },
        async execute({ task, project, tags = [] }: { task: string; project?: string; tags?: string[] }) {
          const store = await loadStore();
          const projectName = project || path.basename(process.cwd());

          // Auto-stop any running entry
          if (store.activeEntry) {
            store.activeEntry.endedAt = new Date().toISOString();
            store.entries.push(store.activeEntry);
          }

          store.activeEntry = {
            id: generateId(),
            task,
            project: projectName,
            startedAt: new Date().toISOString(),
            endedAt: null,
            tags,
          };

          await saveStore(store);

          return `Timer started: "${task}" [${projectName}]${tags.length > 0 ? ` #${tags.join(" #")}` : ""}`;
        },
      }),
      { names: ["time_start"] },
    );

    api.registerTool(
      () => ({
        name: "time_stop",
        description: "Stop the current timer.",
        parameters: { type: "object" as const, properties: {} },
        async execute() {
          const store = await loadStore();

          if (!store.activeEntry) return "No active timer.";

          store.activeEntry.endedAt = new Date().toISOString();
          const duration = formatDuration(getDuration(store.activeEntry));
          const task = store.activeEntry.task;
          store.entries.push(store.activeEntry);
          store.activeEntry = null;

          await saveStore(store);

          return `Timer stopped: "${task}" — ${duration}`;
        },
      }),
      { names: ["time_stop"] },
    );

    api.registerTool(
      () => ({
        name: "time_status",
        description: "Check the current timer status.",
        parameters: { type: "object" as const, properties: {} },
        async execute() {
          const store = await loadStore();

          if (!store.activeEntry) return "No active timer. Use time_start to begin tracking.";

          const elapsed = formatDuration(getDuration(store.activeEntry));
          return [
            `Active: "${store.activeEntry.task}"`,
            `Project: ${store.activeEntry.project}`,
            `Elapsed: ${elapsed}`,
            `Started: ${new Date(store.activeEntry.startedAt).toLocaleTimeString()}`,
            store.activeEntry.tags.length > 0 ? `Tags: #${store.activeEntry.tags.join(" #")}` : "",
          ].filter(Boolean).join("\n");
        },
      }),
      { names: ["time_status"] },
    );

    api.registerTool(
      () => ({
        name: "time_report",
        description:
          "Generate a time report. Filter by date range, project, or tags. Shows total time per project and task.",
        parameters: {
          type: "object" as const,
          properties: {
            period: {
              type: "string",
              description: "Report period: 'today', 'week', 'month', or a date (YYYY-MM-DD)",
              enum: ["today", "week", "month"],
            },
            project: { type: "string", description: "Filter by project name" },
            tag: { type: "string", description: "Filter by tag" },
          },
        },
        async execute({ period = "today", project, tag }: { period?: string; project?: string; tag?: string }) {
          const store = await loadStore();

          // Determine date range
          const now = new Date();
          let startDate: Date;

          switch (period) {
            case "week": {
              startDate = new Date(now);
              startDate.setDate(now.getDate() - now.getDay());
              startDate.setHours(0, 0, 0, 0);
              break;
            }
            case "month": {
              startDate = new Date(now.getFullYear(), now.getMonth(), 1);
              break;
            }
            default: {
              startDate = new Date(now);
              startDate.setHours(0, 0, 0, 0);
            }
          }

          let entries = store.entries.filter(
            (e) => new Date(e.startedAt) >= startDate,
          );

          // Include active entry if in range
          if (store.activeEntry && new Date(store.activeEntry.startedAt) >= startDate) {
            entries.push({ ...store.activeEntry, endedAt: null });
          }

          if (project) entries = entries.filter((e) => e.project === project);
          if (tag) entries = entries.filter((e) => e.tags.includes(tag));

          if (entries.length === 0) {
            return `No time entries found for ${period}${project ? ` in ${project}` : ""}.`;
          }

          // Group by project
          const byProject = new Map<string, { entries: TimeEntry[]; totalMs: number }>();
          let grandTotal = 0;

          for (const entry of entries) {
            const duration = getDuration(entry);
            grandTotal += duration;

            const proj = byProject.get(entry.project) ?? { entries: [], totalMs: 0 };
            proj.entries.push(entry);
            proj.totalMs += duration;
            byProject.set(entry.project, proj);
          }

          const lines = [
            `Time Report — ${period}`,
            `${"=".repeat(40)}`,
            `Total: ${formatDuration(grandTotal)} across ${entries.length} entries`,
            "",
          ];

          for (const [projName, data] of [...byProject.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)) {
            lines.push(`## ${projName} (${formatDuration(data.totalMs)})`);
            for (const entry of data.entries.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())) {
              const dur = formatDuration(getDuration(entry));
              const time = new Date(entry.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const active = !entry.endedAt ? " (active)" : "";
              lines.push(`  ${time} ${entry.task} — ${dur}${active}`);
            }
            lines.push("");
          }

          // Tag summary
          const byTag = new Map<string, number>();
          for (const entry of entries) {
            const duration = getDuration(entry);
            for (const t of entry.tags) {
              byTag.set(t, (byTag.get(t) ?? 0) + duration);
            }
          }

          if (byTag.size > 0) {
            lines.push("By Tag:");
            for (const [t, ms] of [...byTag.entries()].sort((a, b) => b[1] - a[1])) {
              lines.push(`  #${t}: ${formatDuration(ms)}`);
            }
          }

          return lines.join("\n");
        },
      }),
      { names: ["time_report"] },
    );
  },
});
