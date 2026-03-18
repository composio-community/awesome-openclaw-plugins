import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync } from "node:child_process";

interface ChangelogConfig {
  format: "keepachangelog" | "conventional" | "simple";
  groupByType: boolean;
}

interface ParsedCommit {
  hash: string;
  type: string;
  scope: string;
  subject: string;
  date: string;
  author: string;
  breaking: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  docs: "Documentation",
  style: "Styles",
  refactor: "Refactoring",
  perf: "Performance",
  test: "Tests",
  build: "Build",
  ci: "CI/CD",
  chore: "Chores",
  revert: "Reverts",
};

function parseConventionalCommit(line: string): ParsedCommit | null {
  // Format: hash|date|author|subject
  const parts = line.split("|");
  if (parts.length < 4) return null;

  const [hash, date, author, ...rest] = parts;
  const subject = rest.join("|");

  // Match conventional commit: type(scope): subject or type: subject
  const match = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)/);
  if (!match) {
    return { hash, date, author, type: "other", scope: "", subject, breaking: false };
  }

  return {
    hash,
    date,
    author,
    type: match[1].toLowerCase(),
    scope: match[2] ?? "",
    subject: match[4],
    breaking: match[3] === "!",
  };
}

function formatKeepAChangelog(commits: ParsedCommit[], version: string, groupByType: boolean): string {
  const lines: string[] = [];
  const date = new Date().toISOString().slice(0, 10);

  lines.push(`## [${version}] - ${date}\n`);

  if (!groupByType) {
    for (const c of commits) {
      const scope = c.scope ? `**${c.scope}:** ` : "";
      const breaking = c.breaking ? "**BREAKING** " : "";
      lines.push(`- ${breaking}${scope}${c.subject} (${c.hash})`);
    }
    return lines.join("\n");
  }

  const grouped = new Map<string, ParsedCommit[]>();
  for (const c of commits) {
    const group = grouped.get(c.type) ?? [];
    group.push(c);
    grouped.set(c.type, group);
  }

  // Breaking changes first
  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length > 0) {
    lines.push("### BREAKING CHANGES\n");
    for (const c of breaking) {
      const scope = c.scope ? `**${c.scope}:** ` : "";
      lines.push(`- ${scope}${c.subject} (${c.hash})`);
    }
    lines.push("");
  }

  const typeOrder = ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "style", "revert"];
  for (const type of typeOrder) {
    const items = grouped.get(type);
    if (!items) continue;

    const label = TYPE_LABELS[type] ?? type;
    lines.push(`### ${label}\n`);
    for (const c of items) {
      const scope = c.scope ? `**${c.scope}:** ` : "";
      lines.push(`- ${scope}${c.subject} (${c.hash})`);
    }
    lines.push("");
  }

  // Any remaining types not in typeOrder
  for (const [type, items] of grouped) {
    if (typeOrder.includes(type)) continue;
    const label = TYPE_LABELS[type] ?? type;
    lines.push(`### ${label}\n`);
    for (const c of items) {
      lines.push(`- ${c.subject} (${c.hash})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatSimple(commits: ParsedCommit[]): string {
  return commits.map((c) => `- ${c.subject} (${c.hash}, ${c.author})`).join("\n");
}

export default definePluginEntry({
  id: "changelog-gen",
  name: "Changelog Generator",
  description: "Generate changelogs from conventional commits",
  register(api) {
    const config = (api.pluginConfig ?? {}) as ChangelogConfig;
    const format = config.format ?? "keepachangelog";
    const groupByType = config.groupByType ?? true;

    api.registerTool(
      () => ({
        name: "changelog_generate",
        description:
          "Generate a changelog from git commits. Uses conventional commit format when available. Specify a range (e.g., 'v1.0.0..HEAD') or a count of recent commits.",
        parameters: {
          type: "object" as const,
          properties: {
            range: { type: "string", description: "Git range (e.g., 'v1.0.0..HEAD', 'main..feature')" },
            count: { type: "number", description: "Number of recent commits (default: 50)" },
            version: { type: "string", description: "Version label for the changelog (default: 'Unreleased')" },
          },
        },
        async execute({ range, count = 50, version = "Unreleased" }: { range?: string; count?: number; version?: string }) {
          const cwd = process.cwd();
          const gitRange = range ?? `HEAD~${count}..HEAD`;
          const logFormat = "%h|%as|%aN|%s";

          let raw: string;
          try {
            raw = execSync(`git log ${gitRange} --format='${logFormat}' --no-merges`, {
              cwd,
              encoding: "utf-8",
              timeout: 15_000,
            }).trim();
          } catch {
            return "Failed to read git log. Make sure you're in a git repository with commits in the specified range.";
          }

          if (!raw) return "No commits found in the specified range.";

          const commits = raw
            .split("\n")
            .map(parseConventionalCommit)
            .filter((c): c is ParsedCommit => c !== null);

          if (commits.length === 0) return "No commits could be parsed.";

          switch (format) {
            case "simple":
              return formatSimple(commits);
            case "keepachangelog":
            default:
              return formatKeepAChangelog(commits, version, groupByType);
          }
        },
      }),
      { names: ["changelog_generate"] },
    );
  },
});
