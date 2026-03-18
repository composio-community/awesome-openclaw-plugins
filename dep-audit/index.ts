import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

interface DepAuditConfig {
  severityThreshold: "low" | "moderate" | "high" | "critical";
}

const SEVERITY_LEVELS = { low: 0, moderate: 1, high: 2, critical: 3 };

type PackageManager = "npm" | "yarn" | "pnpm" | "pip" | "cargo" | "go" | "unknown";

async function detectPackageManager(dir: string): Promise<PackageManager> {
  const checks: [string, PackageManager][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["package.json", "npm"],
    ["requirements.txt", "pip"],
    ["Pipfile.lock", "pip"],
    ["Cargo.lock", "cargo"],
    ["go.sum", "go"],
  ];

  for (const [file, pm] of checks) {
    try {
      await fs.access(path.join(dir, file));
      return pm;
    } catch {
      continue;
    }
  }

  return "unknown";
}

function runAudit(pm: PackageManager, dir: string): string {
  const commands: Record<string, string> = {
    npm: "npm audit --json 2>/dev/null",
    yarn: "yarn audit --json 2>/dev/null",
    pnpm: "pnpm audit --json 2>/dev/null",
    pip: "pip audit --format json 2>/dev/null",
    cargo: "cargo audit --json 2>/dev/null",
    go: "govulncheck -json ./... 2>/dev/null",
  };

  const cmd = commands[pm];
  if (!cmd) return "{}";

  try {
    return execSync(cmd, { cwd: dir, encoding: "utf-8", timeout: 60_000 });
  } catch (err: unknown) {
    // npm audit exits non-zero when vulnerabilities found — still has valid output
    if (err && typeof err === "object" && "stdout" in err) {
      return (err as { stdout: string }).stdout || "{}";
    }
    return "{}";
  }
}

function parseNpmAudit(raw: string, threshold: number) {
  try {
    const data = JSON.parse(raw);
    const vulnerabilities = data.vulnerabilities ?? {};
    const results: Array<{ name: string; severity: string; title: string; url: string }> = [];

    for (const [name, info] of Object.entries(vulnerabilities) as Array<[string, any]>) {
      const sevLevel = SEVERITY_LEVELS[info.severity as keyof typeof SEVERITY_LEVELS] ?? 0;
      if (sevLevel >= threshold) {
        results.push({
          name,
          severity: info.severity,
          title: info.via?.[0]?.title ?? "Unknown",
          url: info.via?.[0]?.url ?? "",
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

export default definePluginEntry({
  id: "dep-audit",
  name: "Dependency Audit",
  description: "Audit dependencies for vulnerabilities and outdated packages",
  register(api) {
    const config = (api.pluginConfig ?? {}) as DepAuditConfig;
    const threshold = SEVERITY_LEVELS[config.severityThreshold ?? "moderate"];

    api.registerTool(
      () => ({
        name: "dep_audit",
        description:
          "Audit project dependencies for known security vulnerabilities. Supports npm, yarn, pnpm, pip, cargo, and go projects.",
        parameters: {
          type: "object" as const,
          properties: {
            path: { type: "string", description: "Project directory to audit (defaults to cwd)" },
          },
        },
        async execute({ path: projectPath }: { path?: string }) {
          const dir = projectPath || process.cwd();
          const pm = await detectPackageManager(dir);

          if (pm === "unknown") {
            return "Could not detect package manager. Supported: npm, yarn, pnpm, pip, cargo, go.";
          }

          const raw = runAudit(pm, dir);

          if (pm === "npm" || pm === "yarn" || pm === "pnpm") {
            const vulns = parseNpmAudit(raw, threshold);
            if (vulns.length === 0) {
              return `No vulnerabilities found at or above '${config.severityThreshold ?? "moderate"}' severity (${pm}).`;
            }

            const lines = [`Found ${vulns.length} vulnerability(ies) via ${pm}:\n`];
            for (const v of vulns) {
              lines.push(`  [${v.severity.toUpperCase()}] ${v.name}: ${v.title}`);
              if (v.url) lines.push(`    ${v.url}`);
            }
            return lines.join("\n");
          }

          // For other package managers, return raw output
          return `Audit results (${pm}):\n${raw.slice(0, 4000)}`;
        },
      }),
      { names: ["dep_audit"] },
    );

    api.registerTool(
      () => ({
        name: "dep_outdated",
        description: "Check for outdated dependencies in the project.",
        parameters: {
          type: "object" as const,
          properties: {
            path: { type: "string", description: "Project directory (defaults to cwd)" },
          },
        },
        async execute({ path: projectPath }: { path?: string }) {
          const dir = projectPath || process.cwd();
          const pm = await detectPackageManager(dir);

          const commands: Record<string, string> = {
            npm: "npm outdated --json 2>/dev/null",
            yarn: "yarn outdated --json 2>/dev/null",
            pnpm: "pnpm outdated --format json 2>/dev/null",
            pip: "pip list --outdated --format json 2>/dev/null",
          };

          const cmd = commands[pm];
          if (!cmd) return `Outdated check not supported for ${pm}.`;

          try {
            const out = execSync(cmd, { cwd: dir, encoding: "utf-8", timeout: 30_000 });
            return `Outdated dependencies (${pm}):\n${out.slice(0, 4000)}`;
          } catch (err: unknown) {
            if (err && typeof err === "object" && "stdout" in err) {
              const stdout = (err as { stdout: string }).stdout;
              if (stdout) return `Outdated dependencies (${pm}):\n${stdout.slice(0, 4000)}`;
            }
            return "No outdated dependencies found or command not available.";
          }
        },
      }),
      { names: ["dep_outdated"] },
    );
  },
});
