import { definePluginEntry } from "openclaw/plugin-sdk/core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

interface CostTrackerConfig {
  dataDir?: string;
  dailyBudget: number;
  warnAtPercent: number;
}

interface UsageRecord {
  timestamp: string;
  sessionKey: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

interface DailySummary {
  date: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  sessions: number;
  byModel: Record<string, { input: number; output: number; cost: number }>;
}

// Approximate pricing per 1M tokens (input/output) as of early 2026
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  default: { input: 3.0, output: 15.0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING.default;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export default definePluginEntry({
  id: "cost-tracker",
  name: "Cost Tracker",
  description: "Track token usage and estimated costs",
  register(api) {
    const config = (api.pluginConfig ?? {}) as CostTrackerConfig;
    const dataDir = config.dataDir ?? path.join(os.homedir(), ".openclaw", "cost-tracker");
    const dailyBudget = config.dailyBudget ?? 0;
    const warnAtPercent = config.warnAtPercent ?? 80;

    async function ensureDataDir() {
      await fs.mkdir(dataDir, { recursive: true });
    }

    function todayFile(): string {
      const date = new Date().toISOString().slice(0, 10);
      return path.join(dataDir, `${date}.jsonl`);
    }

    async function appendRecord(record: UsageRecord) {
      await ensureDataDir();
      await fs.appendFile(todayFile(), JSON.stringify(record) + "\n", "utf-8");
    }

    async function readDaySummary(date?: string): Promise<DailySummary> {
      const targetDate = date ?? new Date().toISOString().slice(0, 10);
      const filePath = path.join(dataDir, `${targetDate}.jsonl`);

      const summary: DailySummary = {
        date: targetDate,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        sessions: 0,
        byModel: {},
      };

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const sessions = new Set<string>();

        for (const line of content.split("\n").filter(Boolean)) {
          const record: UsageRecord = JSON.parse(line);
          summary.totalInputTokens += record.inputTokens;
          summary.totalOutputTokens += record.outputTokens;
          summary.totalCost += record.estimatedCost;
          sessions.add(record.sessionKey);

          if (!summary.byModel[record.model]) {
            summary.byModel[record.model] = { input: 0, output: 0, cost: 0 };
          }
          summary.byModel[record.model].input += record.inputTokens;
          summary.byModel[record.model].output += record.outputTokens;
          summary.byModel[record.model].cost += record.estimatedCost;
        }

        summary.sessions = sessions.size;
      } catch {
        // no data for this day
      }

      return summary;
    }

    // Track costs after each agent turn
    api.on("agent_end", async (event) => {
      const record: UsageRecord = {
        timestamp: new Date().toISOString(),
        sessionKey: event.sessionKey ?? "unknown",
        model: event.model ?? "unknown",
        inputTokens: event.usage?.inputTokens ?? 0,
        outputTokens: event.usage?.outputTokens ?? 0,
        estimatedCost: estimateCost(
          event.model ?? "default",
          event.usage?.inputTokens ?? 0,
          event.usage?.outputTokens ?? 0,
        ),
      };

      await appendRecord(record);

      // Budget warning
      if (dailyBudget > 0) {
        const summary = await readDaySummary();
        const percent = (summary.totalCost / dailyBudget) * 100;
        if (percent >= warnAtPercent) {
          api.logger.warn(
            `Cost Tracker: Daily spend is $${summary.totalCost.toFixed(2)} ` +
              `(${percent.toFixed(0)}% of $${dailyBudget} budget)`,
          );
        }
      }
    });

    api.registerTool(
      () => ({
        name: "cost_summary",
        description:
          "Get a summary of token usage and estimated costs. Shows today's usage by default, or specify a date.",
        parameters: {
          type: "object" as const,
          properties: {
            date: {
              type: "string",
              description: "Date to query (YYYY-MM-DD format, defaults to today)",
            },
          },
        },
        async execute({ date }: { date?: string }) {
          const summary = await readDaySummary(date);
          const lines = [
            `Cost Summary for ${summary.date}`,
            `${"=".repeat(40)}`,
            `Sessions: ${summary.sessions}`,
            `Input tokens:  ${summary.totalInputTokens.toLocaleString()}`,
            `Output tokens: ${summary.totalOutputTokens.toLocaleString()}`,
            `Estimated cost: $${summary.totalCost.toFixed(4)}`,
          ];

          if (dailyBudget > 0) {
            const pct = ((summary.totalCost / dailyBudget) * 100).toFixed(1);
            lines.push(`Budget used: ${pct}% of $${dailyBudget}`);
          }

          if (Object.keys(summary.byModel).length > 0) {
            lines.push("", "By Model:");
            for (const [model, data] of Object.entries(summary.byModel)) {
              lines.push(`  ${model}: ${data.input.toLocaleString()} in / ${data.output.toLocaleString()} out — $${data.cost.toFixed(4)}`);
            }
          }

          return lines.join("\n");
        },
      }),
      { names: ["cost_summary"] },
    );
  },
});
