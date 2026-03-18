import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync } from "node:child_process";

interface GitStatsConfig {
  maxCommits: number;
  includeFileStats: boolean;
}

function runGit(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", timeout: 10_000 }).trim();
  } catch {
    return "";
  }
}

function getRepoStats(cwd: string, config: GitStatsConfig) {
  const branch = runGit("rev-parse --abbrev-ref HEAD", cwd);
  const totalCommits = parseInt(runGit("rev-list --count HEAD", cwd), 10) || 0;
  const authors = runGit(`log --max-count=${config.maxCommits} --format='%aN' | sort | uniq -c | sort -rn`, cwd);
  const recentCommits = runGit(`log --max-count=10 --format='%h %s (%ar)' --no-merges`, cwd);

  const stats: Record<string, unknown> = {
    branch,
    totalCommits,
    topAuthors: authors.split("\n").filter(Boolean).slice(0, 10),
    recentCommits: recentCommits.split("\n").filter(Boolean),
  };

  if (config.includeFileStats) {
    const hotFiles = runGit(
      `log --max-count=${config.maxCommits} --name-only --format='' | sort | uniq -c | sort -rn | head -15`,
      cwd,
    );
    stats.hotFiles = hotFiles.split("\n").filter(Boolean);
  }

  return stats;
}

function getUnmergedWork(cwd: string) {
  const stashes = runGit("stash list", cwd);
  const uncommitted = runGit("status --porcelain", cwd);
  const unpushed = runGit("log @{u}..HEAD --oneline 2>/dev/null", cwd);
  return {
    stashes: stashes.split("\n").filter(Boolean).length,
    uncommittedFiles: uncommitted.split("\n").filter(Boolean).length,
    unpushedCommits: unpushed.split("\n").filter(Boolean).length,
  };
}

export default definePluginEntry({
  id: "git-stats",
  name: "Git Stats",
  description: "Git repository statistics and insights",
  register(api) {
    const config = (api.pluginConfig ?? {}) as GitStatsConfig;
    const maxCommits = config.maxCommits ?? 100;
    const includeFileStats = config.includeFileStats ?? true;

    api.registerTool(
      () => ({
        name: "git_stats",
        description:
          "Get comprehensive git repository statistics including top authors, hot files, recent commits, and unmerged work. Useful for understanding repo health and activity.",
        parameters: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Path to the git repository (defaults to cwd)",
            },
          },
        },
        async execute({ path: repoPath }) {
          const cwd = repoPath || process.cwd();
          const stats = getRepoStats(cwd, { maxCommits, includeFileStats });
          const pending = getUnmergedWork(cwd);
          return JSON.stringify({ ...stats, pending }, null, 2);
        },
      }),
      { names: ["git_stats"] },
    );

    api.registerTool(
      () => ({
        name: "git_file_history",
        description: "Get the change history for a specific file, including who changed it and when.",
        parameters: {
          type: "object" as const,
          properties: {
            file: { type: "string", description: "File path relative to repo root" },
            limit: { type: "number", description: "Max commits to show (default: 20)" },
          },
          required: ["file"],
        },
        async execute({ file, limit = 20 }) {
          const cwd = process.cwd();
          const log = runGit(`log --max-count=${limit} --format='%h | %aN | %ar | %s' -- "${file}"`, cwd);
          if (!log) return `No history found for ${file}`;
          return `History for ${file}:\n${log}`;
        },
      }),
      { names: ["git_file_history"] },
    );
  },
});
