import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

interface DockerHelperConfig {
  composeFile: string;
}

function runDocker(cmd: string, timeout = 15_000): string {
  try {
    return execSync(`docker ${cmd}`, { encoding: "utf-8", timeout }).trim();
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stderr" in err) {
      return `Error: ${(err as { stderr: string }).stderr}`.trim();
    }
    return "Error: Docker command failed. Is Docker running?";
  }
}

interface DockerfileLint {
  line: number;
  severity: "warning" | "info";
  message: string;
}

function lintDockerfile(content: string): DockerfileLint[] {
  const lines = content.split("\n");
  const lints: DockerfileLint[] = [];

  let hasFrom = false;
  let lastInstruction = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const instruction = line.split(/\s+/)[0].toUpperCase();

    if (instruction === "FROM") {
      hasFrom = true;
      if (line.includes(":latest")) {
        lints.push({ line: i + 1, severity: "warning", message: "Avoid :latest tag — pin a specific version for reproducibility" });
      }
      if (!line.includes(":") && !line.includes("@sha256")) {
        lints.push({ line: i + 1, severity: "warning", message: "No tag specified — image will default to :latest" });
      }
    }

    if (instruction === "RUN") {
      if (line.includes("apt-get install") && !line.includes("--no-install-recommends")) {
        lints.push({ line: i + 1, severity: "info", message: "Consider --no-install-recommends to reduce image size" });
      }
      if (line.includes("apt-get install") && !content.includes("apt-get clean") && !content.includes("rm -rf /var/lib/apt")) {
        lints.push({ line: i + 1, severity: "warning", message: "Clean apt cache after install to reduce layer size" });
      }
      if (line.includes("pip install") && !line.includes("--no-cache-dir")) {
        lints.push({ line: i + 1, severity: "info", message: "Consider --no-cache-dir for pip install to reduce image size" });
      }
      if (line.includes("curl") && line.includes("|") && line.includes("sh")) {
        lints.push({ line: i + 1, severity: "warning", message: "Piping curl to shell is a security risk — download then verify" });
      }
    }

    if (instruction === "ADD" && !line.includes(".tar") && !line.includes("http")) {
      lints.push({ line: i + 1, severity: "info", message: "Prefer COPY over ADD for simple file copies" });
    }

    if (instruction === "EXPOSE" && line.includes("22")) {
      lints.push({ line: i + 1, severity: "warning", message: "Exposing SSH port (22) in a container is usually not recommended" });
    }

    if (instruction === "ENV" && /(?:PASSWORD|SECRET|KEY|TOKEN)\s*=\s*\S+/i.test(line)) {
      lints.push({ line: i + 1, severity: "warning", message: "Secrets in ENV are visible in image history — use build secrets instead" });
    }

    if (instruction === "USER" && line.includes("root")) {
      lints.push({ line: i + 1, severity: "info", message: "Running as root — consider creating a non-root user" });
    }

    lastInstruction = instruction;
  }

  if (!hasFrom) {
    lints.push({ line: 1, severity: "warning", message: "No FROM instruction found" });
  }

  if (lastInstruction === "RUN") {
    lints.push({ line: lines.length, severity: "info", message: "Last instruction is RUN — consider ending with CMD or ENTRYPOINT" });
  }

  return lints;
}

export default definePluginEntry({
  id: "docker-helper",
  name: "Docker Helper",
  description: "Docker container management and Dockerfile analysis",
  register(api) {
    const config = (api.pluginConfig ?? {}) as DockerHelperConfig;
    const composeFile = config.composeFile ?? "docker-compose.yml";

    api.registerTool(
      () => ({
        name: "docker_status",
        description: "Show running Docker containers, their status, ports, and resource usage.",
        parameters: { type: "object" as const, properties: {} },
        async execute() {
          const ps = runDocker("ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Size}}'");
          if (ps.startsWith("Error")) return ps;

          const stats = runDocker("stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}'");

          return `Running Containers:\n${ps}\n\nResource Usage:\n${stats}`;
        },
      }),
      { names: ["docker_status"] },
    );

    api.registerTool(
      () => ({
        name: "docker_logs",
        description: "View recent logs from a Docker container.",
        parameters: {
          type: "object" as const,
          properties: {
            container: { type: "string", description: "Container name or ID" },
            lines: { type: "number", description: "Number of log lines (default: 50)" },
            since: { type: "string", description: "Show logs since (e.g., '5m', '1h', '2024-01-01')" },
          },
          required: ["container"],
        },
        async execute({ container, lines = 50, since }: { container: string; lines?: number; since?: string }) {
          const sinceFlag = since ? `--since ${since}` : "";
          return runDocker(`logs --tail ${lines} ${sinceFlag} ${container}`, 30_000);
        },
      }),
      { names: ["docker_logs"] },
    );

    api.registerTool(
      () => ({
        name: "dockerfile_lint",
        description: "Lint a Dockerfile for common issues: unpinned tags, security risks, missing cache cleanup, and best practice violations.",
        parameters: {
          type: "object" as const,
          properties: {
            path: { type: "string", description: "Path to Dockerfile (defaults to ./Dockerfile)" },
          },
        },
        async execute({ path: dockerfilePath }: { path?: string }) {
          const filePath = dockerfilePath || path.join(process.cwd(), "Dockerfile");
          let content: string;
          try {
            content = await fs.readFile(filePath, "utf-8");
          } catch {
            return `Could not read Dockerfile at ${filePath}`;
          }

          const lints = lintDockerfile(content);

          if (lints.length === 0) {
            return "Dockerfile looks good — no issues found.";
          }

          const lines = [`Dockerfile Lint (${lints.length} finding(s)):\n`];
          for (const lint of lints) {
            const icon = lint.severity === "warning" ? "!" : "i";
            lines.push(`  [${icon}] Line ${lint.line}: ${lint.message}`);
          }

          return lines.join("\n");
        },
      }),
      { names: ["dockerfile_lint"] },
    );

    api.registerTool(
      () => ({
        name: "docker_compose_status",
        description: "Show the status of docker compose services.",
        parameters: {
          type: "object" as const,
          properties: {
            file: { type: "string", description: `Compose file path (default: ${composeFile})` },
          },
        },
        async execute({ file }: { file?: string }) {
          const f = file || composeFile;
          const ps = runDocker(`compose -f ${f} ps --format 'table {{.Name}}\t{{.Service}}\t{{.State}}\t{{.Ports}}'`);
          if (ps.startsWith("Error")) return ps;
          return `Compose Services (${f}):\n${ps}`;
        },
      }),
      { names: ["docker_compose_status"] },
    );
  },
});
