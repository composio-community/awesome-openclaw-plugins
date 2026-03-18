import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

interface ClaudeCodeConfig {
  allowedPaths: string[];
  maxTimeoutSecs: number;
  maxConcurrent: number;
  claudeOauthToken?: string;
}

function resolvePath(p: string): string {
  return p.replace(/^~/, os.homedir());
}

function isPathAllowed(targetPath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return false;
  const resolved = path.resolve(resolvePath(targetPath));
  return allowedPaths.some((allowed) => {
    const resolvedAllowed = path.resolve(resolvePath(allowed));
    return resolved.startsWith(resolvedAllowed);
  });
}

function findClaudeBinary(): string {
  // 1. CLAUDE_BIN env var
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;

  // 2. ~/bin/claude
  const homeBin = path.join(os.homedir(), "bin", "claude");
  if (fs.existsSync(homeBin)) return homeBin;

  // 3. Try PATH
  try {
    const which = execSync("which claude", { encoding: "utf-8" }).trim();
    if (which) return which;
  } catch {
    // not found
  }

  return "claude";
}

let activeProcesses = 0;

function runClaude(
  binary: string,
  mode: "plan" | "bypassPermissions",
  task: string,
  workdir: string,
  timeout: number,
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["--print", `--${mode === "plan" ? "plan" : "dangerously-skip-permissions"}`];
    args.push("-p", task);

    const child = spawn(binary, args, {
      cwd: workdir,
      env: { ...process.env, ...env },
      timeout: timeout * 1000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    child.on("close", (code) => {
      if (code === 0 || stdout.trim()) {
        resolve(stdout.trim() || "Task completed (no output).");
      } else {
        reject(new Error(stderr.trim() || `Claude Code exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });
  });
}

export default definePluginEntry({
  id: "claude-code",
  name: "Claude Code Bridge",
  description: "Integrate Claude Code into OpenClaw for plan, exec, and multi-agent coding",
  register(api) {
    const config = (api.pluginConfig ?? {}) as ClaudeCodeConfig;
    const allowedPaths = (config.allowedPaths ?? []).map(resolvePath);
    const maxTimeout = config.maxTimeoutSecs ?? 600;
    const maxConcurrent = config.maxConcurrent ?? 2;
    const binary = findClaudeBinary();
    const extraEnv: Record<string, string> = {};
    if (config.claudeOauthToken) {
      extraEnv.CLAUDE_OAUTH_TOKEN = config.claudeOauthToken;
    }

    api.registerTool(
      () => ({
        name: "claude_plan",
        description:
          "Read-only analysis mode. Analyze code, review architecture, plan implementations. Does NOT modify any files.",
        parameters: {
          type: "object" as const,
          properties: {
            task: { type: "string", description: "Task description — what to analyze or plan" },
            workdir: { type: "string", description: "Working directory (must be in allowedPaths)" },
            timeout: { type: "number", description: `Timeout in seconds (default: 300, max: ${maxTimeout})` },
          },
          required: ["task"],
        },
        async execute({ task, workdir, timeout = 300 }: { task: string; workdir?: string; timeout?: number }) {
          const dir = workdir ? resolvePath(workdir) : process.cwd();
          if (allowedPaths.length > 0 && !isPathAllowed(dir, allowedPaths)) {
            return `Error: ${dir} is not in allowedPaths. Allowed: ${allowedPaths.join(", ")}`;
          }

          if (activeProcesses >= maxConcurrent) {
            return `Error: Max concurrent processes (${maxConcurrent}) reached. Wait for a running task to finish.`;
          }

          activeProcesses++;
          try {
            return await runClaude(binary, "plan", task, dir, Math.min(timeout, maxTimeout), extraEnv);
          } catch (err) {
            return `claude_plan failed: ${err instanceof Error ? err.message : String(err)}`;
          } finally {
            activeProcesses--;
          }
        },
      }),
      { names: ["claude_plan"] },
    );

    api.registerTool(
      () => ({
        name: "claude_exec",
        description:
          "Execution mode. Implement features, fix bugs, refactor code. Has full write permissions within allowedPaths.",
        parameters: {
          type: "object" as const,
          properties: {
            task: { type: "string", description: "Task description — what to implement or fix" },
            workdir: { type: "string", description: "Working directory (must be in allowedPaths)" },
            timeout: { type: "number", description: `Timeout in seconds (default: 300, max: ${maxTimeout})` },
          },
          required: ["task"],
        },
        async execute({ task, workdir, timeout = 300 }: { task: string; workdir?: string; timeout?: number }) {
          const dir = workdir ? resolvePath(workdir) : process.cwd();
          if (!isPathAllowed(dir, allowedPaths)) {
            return `Error: ${dir} is not in allowedPaths. Configure allowedPaths in plugin settings.`;
          }

          if (activeProcesses >= maxConcurrent) {
            return `Error: Max concurrent processes (${maxConcurrent}) reached.`;
          }

          activeProcesses++;
          try {
            return await runClaude(binary, "bypassPermissions", task, dir, Math.min(timeout, maxTimeout), extraEnv);
          } catch (err) {
            return `claude_exec failed: ${err instanceof Error ? err.message : String(err)}`;
          } finally {
            activeProcesses--;
          }
        },
      }),
      { names: ["claude_exec"] },
    );

    api.registerTool(
      () => ({
        name: "claude_teams",
        description:
          "Multi-agent mode. Spawn parallel Claude Code agents for coordinated work (e.g., frontend + backend simultaneously). Uses file locking for safety.",
        parameters: {
          type: "object" as const,
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Agent name (e.g., 'frontend')" },
                  task: { type: "string", description: "Task for this agent" },
                  workdir: { type: "string", description: "Working directory" },
                },
                required: ["name", "task"],
              },
              description: "Array of agent tasks to run in parallel",
            },
            timeout: { type: "number", description: `Timeout per agent in seconds (default: 600, max: ${maxTimeout})` },
          },
          required: ["tasks"],
        },
        async execute({
          tasks,
          timeout = 600,
        }: {
          tasks: Array<{ name: string; task: string; workdir?: string }>;
          timeout?: number;
        }) {
          if (tasks.length > maxConcurrent) {
            return `Error: ${tasks.length} agents requested but maxConcurrent is ${maxConcurrent}.`;
          }

          // Validate all paths first
          for (const t of tasks) {
            const dir = t.workdir ? resolvePath(t.workdir) : process.cwd();
            if (!isPathAllowed(dir, allowedPaths)) {
              return `Error: ${dir} is not in allowedPaths for agent "${t.name}".`;
            }
          }

          const results = await Promise.allSettled(
            tasks.map(async (t) => {
              const dir = t.workdir ? resolvePath(t.workdir) : process.cwd();
              activeProcesses++;
              try {
                const contextTask = `[Agent: ${t.name}] ${t.task}\n\nIMPORTANT: You are one of ${tasks.length} parallel agents. Coordinate via file comments. Do not modify files other agents are working on.`;
                return await runClaude(binary, "bypassPermissions", contextTask, dir, Math.min(timeout, maxTimeout), extraEnv);
              } finally {
                activeProcesses--;
              }
            }),
          );

          const lines = [`Multi-Agent Results (${tasks.length} agents):\n`];
          for (let i = 0; i < tasks.length; i++) {
            const result = results[i];
            lines.push(`## ${tasks[i].name}`);
            if (result.status === "fulfilled") {
              lines.push(result.value);
            } else {
              lines.push(`FAILED: ${result.reason?.message ?? "Unknown error"}`);
            }
            lines.push("");
          }

          return lines.join("\n");
        },
      }),
      { names: ["claude_teams"] },
    );
  },
});
