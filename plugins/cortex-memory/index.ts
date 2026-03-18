import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

interface CortexConfig {
  dbPath: string;
  binaryPath?: string;
  autoCapture: boolean;
  autoRecall: boolean;
  topK: number;
}

function resolvePath(p: string): string {
  return p.replace(/^~/, os.homedir());
}

function findBinary(config: CortexConfig): string {
  if (config.binaryPath) return resolvePath(config.binaryPath);

  // Try to find on PATH
  try {
    const which = execSync("which cortex-mcp-server", { encoding: "utf-8" }).trim();
    if (which) return which;
  } catch {
    // not found
  }

  // Common install locations
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "cortex-mcp-server"),
    path.join(os.homedir(), ".cargo", "bin", "cortex-mcp-server"),
    "/usr/local/bin/cortex-mcp-server",
  ];

  for (const c of candidates) {
    try {
      execSync(`test -x ${c}`);
      return c;
    } catch {
      continue;
    }
  }

  return "cortex-mcp-server";
}

function runCortex(binary: string, dbPath: string, args: string[]): string {
  try {
    return execSync(
      `${binary} --db "${dbPath}" ${args.join(" ")}`,
      { encoding: "utf-8", timeout: 15_000 },
    ).trim();
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stderr" in err) {
      return `Error: ${(err as { stderr: string }).stderr}`.trim();
    }
    return "Error: cortex-mcp-server command failed. Is it installed?";
  }
}

export default definePluginEntry({
  id: "cortex-memory",
  name: "Cortex Memory",
  description: "4-tier persistent memory with Bayesian beliefs and people graph",
  kind: "memory",
  register(api) {
    const config = (api.pluginConfig ?? {}) as CortexConfig;
    const dbPath = resolvePath(config.dbPath ?? "~/.cortex/memory.db");
    const binary = findBinary(config);
    const topK = config.topK ?? 10;
    const autoCapture = config.autoCapture ?? true;
    const autoRecall = config.autoRecall ?? true;

    // Auto-recall: inject relevant memories before each agent turn
    if (autoRecall) {
      api.on("before_prompt_build", async (event) => {
        try {
          const context = event.messages?.slice(-3).map((m: any) => m.content).join(" ") ?? "";
          if (!context.trim()) return event;

          const memories = runCortex(binary, dbPath, [
            "search",
            "--query", `"${context.slice(0, 500).replace(/"/g, '\\"')}"`,
            "--top-k", String(topK),
            "--format", "json",
          ]);

          if (memories && !memories.startsWith("Error")) {
            return {
              ...event,
              injectedContext: `<cortex-memories>\n${memories}\n</cortex-memories>`,
            };
          }
        } catch {
          // silent fail — don't block the agent
        }
        return event;
      });
    }

    // Auto-capture: store conversation context after each turn
    if (autoCapture) {
      api.on("agent_end", async (event) => {
        try {
          const lastMessage = event.messages?.slice(-1)[0]?.content ?? "";
          if (lastMessage.trim().length > 20) {
            runCortex(binary, dbPath, [
              "store",
              "--text", `"${lastMessage.slice(0, 2000).replace(/"/g, '\\"')}"`,
              "--tier", "episodic",
            ]);
          }
        } catch {
          // silent fail
        }
      });
    }

    api.registerTool(
      () => ({
        name: "memory_search",
        description:
          "Search persistent memory across all tiers (Working, Episodic, Semantic, Procedural). Results ranked by similarity, recency, and salience.",
        parameters: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Search query" },
            topK: { type: "number", description: `Max results (default: ${topK})` },
            tier: {
              type: "string",
              enum: ["working", "episodic", "semantic", "procedural", "all"],
              description: "Memory tier to search (default: all)",
            },
          },
          required: ["query"],
        },
        async execute({ query, topK: k, tier = "all" }: { query: string; topK?: number; tier?: string }) {
          const args = [
            "search",
            "--query", `"${query.replace(/"/g, '\\"')}"`,
            "--top-k", String(k ?? topK),
          ];
          if (tier !== "all") args.push("--tier", tier);

          return runCortex(binary, dbPath, args);
        },
      }),
      { names: ["memory_search"] },
    );

    api.registerTool(
      () => ({
        name: "memory_store",
        description: "Save information to persistent memory. Specify a tier for proper categorization.",
        parameters: {
          type: "object" as const,
          properties: {
            text: { type: "string", description: "Information to store" },
            tier: {
              type: "string",
              enum: ["working", "episodic", "semantic", "procedural"],
              description: "Memory tier (default: semantic)",
            },
          },
          required: ["text"],
        },
        async execute({ text, tier = "semantic" }: { text: string; tier?: string }) {
          return runCortex(binary, dbPath, [
            "store",
            "--text", `"${text.replace(/"/g, '\\"')}"`,
            "--tier", tier,
          ]);
        },
      }),
      { names: ["memory_store"] },
    );

    api.registerTool(
      () => ({
        name: "memory_get",
        description: "Get comprehensive context from all memory tiers — beliefs, facts, preferences, and recent episodes.",
        parameters: { type: "object" as const, properties: {} },
        async execute() {
          return runCortex(binary, dbPath, ["context"]);
        },
      }),
      { names: ["memory_get"] },
    );

    api.registerTool(
      () => ({
        name: "belief_observe",
        description: "Update a belief with Bayesian evidence. Provide an observation that supports or contradicts a hypothesis.",
        parameters: {
          type: "object" as const,
          properties: {
            hypothesis: { type: "string", description: "The belief/hypothesis" },
            observation: { type: "string", description: "Evidence observed" },
            strength: {
              type: "number",
              description: "Evidence strength 0.0-1.0 (default: 0.7)",
            },
          },
          required: ["hypothesis", "observation"],
        },
        async execute({ hypothesis, observation, strength = 0.7 }: { hypothesis: string; observation: string; strength?: number }) {
          return runCortex(binary, dbPath, [
            "belief-observe",
            "--hypothesis", `"${hypothesis.replace(/"/g, '\\"')}"`,
            "--observation", `"${observation.replace(/"/g, '\\"')}"`,
            "--strength", String(strength),
          ]);
        },
      }),
      { names: ["belief_observe"] },
    );

    api.registerTool(
      () => ({
        name: "fact_add",
        description: "Store a structured fact as a subject-predicate-object triple.",
        parameters: {
          type: "object" as const,
          properties: {
            subject: { type: "string", description: "Subject entity" },
            predicate: { type: "string", description: "Relationship" },
            object: { type: "string", description: "Object entity" },
          },
          required: ["subject", "predicate", "object"],
        },
        async execute({ subject, predicate, object }: { subject: string; predicate: string; object: string }) {
          return runCortex(binary, dbPath, [
            "fact-add",
            "--subject", `"${subject}"`,
            "--predicate", `"${predicate}"`,
            "--object", `"${object}"`,
          ]);
        },
      }),
      { names: ["fact_add"] },
    );

    api.registerTool(
      () => ({
        name: "person_resolve",
        description: "Cross-channel identity resolution — link mentions of the same person across different contexts.",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Person name or identifier" },
            context: { type: "string", description: "Context where this person was mentioned" },
          },
          required: ["name"],
        },
        async execute({ name, context }: { name: string; context?: string }) {
          const args = ["person-resolve", "--name", `"${name}"`];
          if (context) args.push("--context", `"${context.replace(/"/g, '\\"')}"`);
          return runCortex(binary, dbPath, args);
        },
      }),
      { names: ["person_resolve"] },
    );

    // CLI commands
    api.registerCli(
      ({ program }) => {
        const cortex = program.command("cortex").description("Cortex memory management");

        cortex.command("search <query>").description("Search memories").action((query: string) => {
          console.log(runCortex(binary, dbPath, ["search", "--query", `"${query}"`]));
        });

        cortex.command("context").description("Show full memory context").action(() => {
          console.log(runCortex(binary, dbPath, ["context"]));
        });

        cortex.command("beliefs").description("List current beliefs").action(() => {
          console.log(runCortex(binary, dbPath, ["beliefs"]));
        });

        cortex.command("store <text>").description("Store a memory").action((text: string) => {
          console.log(runCortex(binary, dbPath, ["store", "--text", `"${text}"`]));
        });
      },
      { commands: ["cortex"] },
    );
  },
});
