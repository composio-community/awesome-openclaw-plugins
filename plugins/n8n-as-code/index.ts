import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

interface N8nAsCodeConfig {
  n8nHost?: string;
  n8nApiKey?: string;
  workspaceDir: string;
}

function resolvePath(p: string): string {
  return p.replace(/^~/, os.homedir());
}

function runN8nac(args: string[], cwd: string, timeout = 30_000): string {
  try {
    return execSync(`npx n8nac ${args.join(" ")}`, {
      cwd,
      encoding: "utf-8",
      timeout,
      env: { ...process.env },
    }).trim();
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stdout" in err) {
      return (err as { stdout: string }).stdout || "Command failed.";
    }
    return "Error: n8nac command failed. Is n8n-as-code installed?";
  }
}

export default definePluginEntry({
  id: "n8nac",
  name: "n8n-as-code",
  description: "Conversational n8n workflow automation with full schema knowledge",
  register(api) {
    const config = (api.pluginConfig ?? {}) as N8nAsCodeConfig;
    const workspaceDir = resolvePath(config.workspaceDir ?? "~/.openclaw/n8nac");

    // Inject n8n-architect context into every conversation
    api.on("before_prompt_build", async (event) => {
      const agentsPath = path.join(workspaceDir, "AGENTS.md");
      try {
        const agentsContent = await fs.readFile(agentsPath, "utf-8");
        return {
          ...event,
          injectedContext: `<n8n-context>\n${agentsContent}\n</n8n-context>`,
        };
      } catch {
        return event;
      }
    });

    api.registerTool(
      () => ({
        name: "n8nac",
        description:
          "Manage n8n workflows — create, pull, push, validate, and list workflows. Conversational editing with full node schema knowledge (537 nodes, 10k+ properties).",
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              enum: ["setup_check", "init_auth", "init_project", "list", "pull", "push", "verify", "validate", "skills"],
              description: "Action to perform",
            },
            workflowId: { type: "string", description: "Workflow ID (for pull/push/verify)" },
            file: { type: "string", description: "Workflow file path (for push/validate)" },
            host: { type: "string", description: "n8n host URL (for init_auth)" },
            apiKey: { type: "string", description: "n8n API key (for init_auth)" },
            skillsArgs: { type: "string", description: "Arguments for skills subcommand" },
          },
          required: ["action"],
        },
        async execute(params: {
          action: string;
          workflowId?: string;
          file?: string;
          host?: string;
          apiKey?: string;
          skillsArgs?: string;
        }) {
          await fs.mkdir(workspaceDir, { recursive: true });

          switch (params.action) {
            case "setup_check":
              return runN8nac(["setup-check"], workspaceDir);

            case "init_auth": {
              const host = params.host || config.n8nHost;
              const key = params.apiKey || config.n8nApiKey;
              if (!host || !key) return "Error: n8n host URL and API key required.";
              return runN8nac(["init-auth", "--host", host, "--api-key", key], workspaceDir);
            }

            case "init_project":
              return runN8nac(["init-project"], workspaceDir);

            case "list":
              return runN8nac(["list"], workspaceDir);

            case "pull":
              if (!params.workflowId) return "Error: workflowId required for pull.";
              return runN8nac(["pull", params.workflowId], workspaceDir);

            case "push":
              if (!params.file) return "Error: file path required for push.";
              return runN8nac(["push", params.file], workspaceDir);

            case "verify":
              if (!params.workflowId) return "Error: workflowId required for verify.";
              return runN8nac(["verify", params.workflowId], workspaceDir);

            case "validate":
              if (!params.file) return "Error: file path required for validate.";
              return runN8nac(["validate", params.file], workspaceDir);

            case "skills":
              return runN8nac(["skills", params.skillsArgs ?? ""], workspaceDir, 60_000);

            default:
              return `Unknown action: ${params.action}`;
          }
        },
      }),
      { names: ["n8nac"] },
    );

    // CLI commands
    api.registerCli(
      ({ program }) => {
        const n8nac = program.command("n8nac").description("n8n-as-code workflow management");

        n8nac.command("setup")
          .description("Interactive setup wizard")
          .option("--host <url>", "n8n host URL")
          .option("--api-key <key>", "n8n API key")
          .action(async (opts: { host?: string; apiKey?: string }) => {
            const host = opts.host || config.n8nHost;
            const key = opts.apiKey || config.n8nApiKey;
            if (host && key) {
              console.log(runN8nac(["init-auth", "--host", host, "--api-key", key], workspaceDir));
              console.log(runN8nac(["init-project"], workspaceDir));
              console.log(runN8nac(["update-ai"], workspaceDir));
              console.log("Setup complete.");
            } else {
              console.log("Please provide --host and --api-key, or configure them in plugin settings.");
            }
          });

        n8nac.command("status").description("Show workspace status").action(() => {
          console.log(runN8nac(["setup-check"], workspaceDir));
        });
      },
      { commands: ["n8nac"] },
    );
  },
});
