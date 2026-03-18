import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { execSync } from "node:child_process";

interface PRReviewConfig {
  baseBranch: string;
  maxDiffLines: number;
}

function runGit(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8", timeout: 15_000 }).trim();
  } catch {
    return "";
  }
}

interface DiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: Array<{ file: string; insertions: number; deletions: number; status: string }>;
}

function parseDiffStat(base: string): DiffSummary {
  const numstat = runGit(`diff ${base}...HEAD --numstat`);
  const nameStatus = runGit(`diff ${base}...HEAD --name-status`);

  const statusMap = new Map<string, string>();
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const [status, ...fileParts] = line.split("\t");
    const file = fileParts.join("\t");
    statusMap.set(file, status.charAt(0));
  }

  const files: DiffSummary["files"] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  for (const line of numstat.split("\n").filter(Boolean)) {
    const [ins, del, file] = line.split("\t");
    const insertions = parseInt(ins, 10) || 0;
    const deletions = parseInt(del, 10) || 0;
    totalInsertions += insertions;
    totalDeletions += deletions;

    const statusCode = statusMap.get(file) ?? "M";
    const statusLabels: Record<string, string> = {
      A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied",
    };

    files.push({
      file,
      insertions,
      deletions,
      status: statusLabels[statusCode] ?? statusCode,
    });
  }

  return {
    filesChanged: files.length,
    insertions: totalInsertions,
    deletions: totalDeletions,
    files: files.sort((a, b) => (b.insertions + b.deletions) - (a.insertions + a.deletions)),
  };
}

function suggestReviewers(base: string, changedFiles: string[]): Array<{ author: string; score: number; files: number }> {
  const authorScores = new Map<string, { score: number; files: number }>();

  for (const file of changedFiles.slice(0, 20)) {
    const blame = runGit(`log --max-count=10 --format='%aN' -- "${file}"`);
    for (const author of blame.split("\n").filter(Boolean)) {
      const existing = authorScores.get(author) ?? { score: 0, files: 0 };
      existing.score++;
      existing.files++;
      authorScores.set(author, existing);
    }
  }

  // Remove the current author
  const currentAuthor = runGit("config user.name");
  authorScores.delete(currentAuthor);

  return [...authorScores.entries()]
    .map(([author, data]) => ({ author, ...data }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function detectIssues(base: string, maxDiffLines: number): string[] {
  const issues: string[] = [];
  const diff = runGit(`diff ${base}...HEAD`);
  const truncatedDiff = diff.slice(0, maxDiffLines * 120);

  // Check for debug leftovers
  const debugPatterns = [
    { pattern: /console\.log\(/g, label: "console.log" },
    { pattern: /debugger;/g, label: "debugger statement" },
    { pattern: /print\(\s*f?['"]/g, label: "print() statement" },
    { pattern: /TODO|FIXME|HACK|XXX/g, label: "TODO/FIXME annotation" },
  ];

  for (const { pattern, label } of debugPatterns) {
    // Only check added lines
    const addedLines = truncatedDiff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const matches = addedLines.filter((l) => pattern.test(l));
    if (matches.length > 0) {
      issues.push(`${matches.length} new ${label}(s) added`);
    }
  }

  // Check for large file additions
  const stat = parseDiffStat(base);
  const largeFiles = stat.files.filter((f) => f.insertions > 300 && f.status === "added");
  if (largeFiles.length > 0) {
    issues.push(`${largeFiles.length} large new file(s) (>300 lines) — consider splitting`);
  }

  // Check for env/secret files
  const sensitivePatterns = [".env", "credentials", ".pem", ".key", "secret"];
  const sensitiveFiles = stat.files.filter((f) =>
    sensitivePatterns.some((p) => f.file.toLowerCase().includes(p)),
  );
  if (sensitiveFiles.length > 0) {
    issues.push(`Potentially sensitive file(s): ${sensitiveFiles.map((f) => f.file).join(", ")}`);
  }

  return issues;
}

export default definePluginEntry({
  id: "pr-review",
  name: "PR Review Helper",
  description: "Summarize PR changes, suggest reviewers, and check for issues",
  register(api) {
    const config = (api.pluginConfig ?? {}) as PRReviewConfig;
    const baseBranch = config.baseBranch ?? "main";
    const maxDiffLines = config.maxDiffLines ?? 2000;

    api.registerTool(
      () => ({
        name: "pr_summary",
        description:
          "Generate a summary of the current branch's changes compared to the base branch. Shows files changed, suggested reviewers, and potential issues.",
        parameters: {
          type: "object" as const,
          properties: {
            base: { type: "string", description: `Base branch to compare against (default: ${baseBranch})` },
          },
        },
        async execute({ base }: { base?: string }) {
          const targetBase = base ?? baseBranch;
          const currentBranch = runGit("rev-parse --abbrev-ref HEAD");

          if (!currentBranch || currentBranch === targetBase) {
            return `You're on ${currentBranch || "unknown branch"}. Switch to a feature branch first.`;
          }

          const stat = parseDiffStat(targetBase);
          if (stat.filesChanged === 0) {
            return `No changes found between ${targetBase} and ${currentBranch}.`;
          }

          const commits = runGit(`log ${targetBase}..HEAD --oneline --no-merges`);
          const commitCount = commits.split("\n").filter(Boolean).length;

          const reviewers = suggestReviewers(targetBase, stat.files.map((f) => f.file));
          const issues = detectIssues(targetBase, maxDiffLines);

          const lines = [
            `PR Summary: ${currentBranch} → ${targetBase}`,
            `${"=".repeat(50)}`,
            `Commits: ${commitCount}`,
            `Files changed: ${stat.filesChanged}`,
            `Insertions: +${stat.insertions}  Deletions: -${stat.deletions}`,
            "",
            "Changed Files:",
          ];

          for (const f of stat.files.slice(0, 25)) {
            lines.push(`  [${f.status}] ${f.file} (+${f.insertions} -${f.deletions})`);
          }
          if (stat.files.length > 25) {
            lines.push(`  ... and ${stat.files.length - 25} more`);
          }

          if (reviewers.length > 0) {
            lines.push("", "Suggested Reviewers (by file familiarity):");
            for (const r of reviewers) {
              lines.push(`  ${r.author} — touched ${r.files} of the changed files`);
            }
          }

          if (issues.length > 0) {
            lines.push("", "Potential Issues:");
            for (const issue of issues) {
              lines.push(`  ! ${issue}`);
            }
          }

          if (commitCount > 0) {
            lines.push("", "Commits:");
            for (const c of commits.split("\n").filter(Boolean).slice(0, 15)) {
              lines.push(`  ${c}`);
            }
          }

          return lines.join("\n");
        },
      }),
      { names: ["pr_summary"] },
    );

    api.registerTool(
      () => ({
        name: "pr_checklist",
        description: "Generate a PR review checklist based on the types of files changed.",
        parameters: {
          type: "object" as const,
          properties: {
            base: { type: "string", description: `Base branch (default: ${baseBranch})` },
          },
        },
        async execute({ base }: { base?: string }) {
          const targetBase = base ?? baseBranch;
          const stat = parseDiffStat(targetBase);
          if (stat.filesChanged === 0) return "No changes to review.";

          const checklist: string[] = ["PR Review Checklist", "=".repeat(30), ""];

          // Always include
          checklist.push("General:");
          checklist.push("  [ ] Changes match the PR description");
          checklist.push("  [ ] No unnecessary files included");
          checklist.push("  [ ] Commit messages are clear");

          const extensions = new Set(stat.files.map((f) => {
            const parts = f.file.split(".");
            return parts.length > 1 ? `.${parts[parts.length - 1]}` : "";
          }));

          if ([".ts", ".tsx", ".js", ".jsx"].some((e) => extensions.has(e))) {
            checklist.push("", "Frontend/TypeScript:");
            checklist.push("  [ ] No console.log / debugger statements");
            checklist.push("  [ ] Error handling is appropriate");
            checklist.push("  [ ] Types are correct (no unnecessary `any`)");
          }

          if ([".py"].some((e) => extensions.has(e))) {
            checklist.push("", "Python:");
            checklist.push("  [ ] No print() debug statements");
            checklist.push("  [ ] Type hints where appropriate");
            checklist.push("  [ ] Exception handling is specific");
          }

          const testFiles = stat.files.filter((f) =>
            f.file.includes("test") || f.file.includes("spec"),
          );
          if (testFiles.length > 0) {
            checklist.push("", "Tests:");
            checklist.push("  [ ] Tests cover the new behavior");
            checklist.push("  [ ] No flaky or timing-dependent assertions");
          } else if (stat.insertions > 50) {
            checklist.push("", "Tests:");
            checklist.push("  [ ] Consider adding tests for new code");
          }

          const configFiles = stat.files.filter((f) =>
            ["package.json", "tsconfig", ".yml", ".yaml", "Dockerfile", ".toml"].some((p) => f.file.includes(p)),
          );
          if (configFiles.length > 0) {
            checklist.push("", "Config/Infrastructure:");
            checklist.push("  [ ] Config changes are intentional");
            checklist.push("  [ ] No secrets in config files");
          }

          const migrationFiles = stat.files.filter((f) => f.file.includes("migration"));
          if (migrationFiles.length > 0) {
            checklist.push("", "Database:");
            checklist.push("  [ ] Migration is reversible");
            checklist.push("  [ ] No data loss risk");
          }

          return checklist.join("\n");
        },
      }),
      { names: ["pr_checklist"] },
    );
  },
});
