import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync } from "node:child_process";

interface CommitGuardConfig {
  enforceConventional: boolean;
  maxFileSizeKb: number;
  blockedPatterns: string[];
}

const CONVENTIONAL_REGEX = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\s.+/;

function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    return filename.endsWith(pattern.slice(1));
  }
  return filename === pattern || filename.endsWith("/" + pattern);
}

function runGit(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8", timeout: 10_000 }).trim();
  } catch {
    return "";
  }
}

export default definePluginEntry({
  id: "commit-guard",
  name: "Commit Guard",
  description: "Pre-commit validation and safety checks",
  register(api) {
    const config = (api.pluginConfig ?? {}) as CommitGuardConfig;
    const enforceConventional = config.enforceConventional ?? true;
    const maxFileSizeKb = config.maxFileSizeKb ?? 500;
    const blockedPatterns = config.blockedPatterns ?? [".env", "credentials.json", "*.pem", "*.key", "id_rsa"];

    api.registerTool(
      () => ({
        name: "commit_check",
        description:
          "Validate staged changes before committing. Checks for blocked files, oversized files, and secret patterns. Optionally validates commit message format.",
        parameters: {
          type: "object" as const,
          properties: {
            message: {
              type: "string",
              description: "Proposed commit message to validate",
            },
          },
        },
        async execute({ message }: { message?: string }) {
          const issues: string[] = [];
          const warnings: string[] = [];

          // Check staged files
          const staged = runGit("diff --cached --name-only")
            .split("\n")
            .filter(Boolean);

          if (staged.length === 0) {
            return "No staged files found. Stage files with `git add` first.";
          }

          // Check blocked patterns
          for (const file of staged) {
            for (const pattern of blockedPatterns) {
              if (matchesPattern(file, pattern)) {
                issues.push(`BLOCKED: ${file} matches blocked pattern "${pattern}"`);
              }
            }
          }

          // Check file sizes
          for (const file of staged) {
            const sizeStr = runGit(`cat-file -s :${file} 2>/dev/null`);
            const sizeKb = parseInt(sizeStr, 10) / 1024;
            if (sizeKb > maxFileSizeKb) {
              issues.push(`OVERSIZED: ${file} is ${sizeKb.toFixed(0)}KB (max: ${maxFileSizeKb}KB)`);
            }
          }

          // Check staged content for secrets
          const diff = runGit("diff --cached");
          const secretPatterns = [
            /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9\-_]{16,}/gi,
            /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
            /sk-[A-Za-z0-9]{32,}/g,
            /ghp_[A-Za-z0-9]{36}/g,
          ];

          for (const pattern of secretPatterns) {
            if (pattern.test(diff)) {
              issues.push("SECRET DETECTED: Staged diff contains what appears to be a secret or API key");
              break;
            }
          }

          // Validate commit message
          if (message && enforceConventional) {
            if (!CONVENTIONAL_REGEX.test(message.split("\n")[0])) {
              warnings.push(
                `Commit message does not follow conventional format.\n` +
                  `  Expected: type(scope): description\n` +
                  `  Example:  feat(auth): add OAuth2 login flow\n` +
                  `  Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert`,
              );
            }
          }

          // Build report
          const lines: string[] = [`Commit Guard Report — ${staged.length} staged file(s)\n`];

          if (issues.length > 0) {
            lines.push(`ISSUES (${issues.length}):`);
            for (const issue of issues) lines.push(`  ✗ ${issue}`);
            lines.push("");
          }

          if (warnings.length > 0) {
            lines.push(`WARNINGS (${warnings.length}):`);
            for (const w of warnings) lines.push(`  ⚠ ${w}`);
            lines.push("");
          }

          if (issues.length === 0 && warnings.length === 0) {
            lines.push("All checks passed. Safe to commit.");
          } else if (issues.length > 0) {
            lines.push("Commit NOT recommended — resolve issues first.");
          } else {
            lines.push("Commit OK with warnings.");
          }

          return lines.join("\n");
        },
      }),
      { names: ["commit_check"] },
    );
  },
});
