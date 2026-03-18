import { definePluginEntry } from "openclaw/plugin-sdk/core";
import fs from "node:fs/promises";
import path from "node:path";

interface FileMetricsConfig {
  excludeDirs: string[];
  maxFileSize: number;
}

interface FileStats {
  file: string;
  lines: number;
  blankLines: number;
  commentLines: number;
  codeLines: number;
  functions: number;
  imports: number;
  exports: number;
  language: string;
}

const LANG_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
  ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust",
  ".java": "java", ".c": "c", ".cpp": "cpp", ".cs": "csharp",
  ".swift": "swift", ".kt": "kotlin", ".scala": "scala",
  ".vue": "vue", ".svelte": "svelte", ".html": "html",
  ".css": "css", ".scss": "scss", ".sh": "shell",
};

const COMMENT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [/^\s*\/\//, /^\s*\/\*/, /^\s*\*/],
  javascript: [/^\s*\/\//, /^\s*\/\*/, /^\s*\*/],
  python: [/^\s*#/, /^\s*"""/, /^\s*'''/],
  ruby: [/^\s*#/],
  go: [/^\s*\/\//, /^\s*\/\*/],
  rust: [/^\s*\/\//, /^\s*\/\*/],
  java: [/^\s*\/\//, /^\s*\/\*/, /^\s*\*/],
  c: [/^\s*\/\//, /^\s*\/\*/, /^\s*\*/],
  cpp: [/^\s*\/\//, /^\s*\/\*/, /^\s*\*/],
  shell: [/^\s*#/],
};

const FUNCTION_PATTERNS: Record<string, RegExp> = {
  typescript: /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(?:async\s+)?(?:get|set)?\s*\w+\s*\([^)]*\)\s*[:{])/g,
  javascript: /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(?:async\s+)?(?:get|set)?\s*\w+\s*\([^)]*\)\s*[:{])/g,
  python: /^\s*(?:async\s+)?def\s+\w+/gm,
  go: /^func\s+/gm,
  rust: /(?:pub\s+)?(?:async\s+)?fn\s+\w+/g,
  java: /(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*\{/g,
  ruby: /^\s*def\s+\w+/gm,
};

const IMPORT_PATTERNS: Record<string, RegExp> = {
  typescript: /^(?:import|require)\b/gm,
  javascript: /^(?:import|require)\b/gm,
  python: /^(?:import|from)\b/gm,
  go: /^\s*"[\w/.]+"/gm,
  rust: /^use\s+/gm,
  java: /^import\s+/gm,
  ruby: /^require\b/gm,
};

const EXPORT_PATTERNS: Record<string, RegExp> = {
  typescript: /^export\b/gm,
  javascript: /^(?:export|module\.exports)\b/gm,
  python: /^__all__\s*=/gm,
  go: /^func\s+[A-Z]/gm,
  rust: /^pub\s+/gm,
};

function analyzeFile(content: string, language: string): Omit<FileStats, "file" | "language"> {
  const lines = content.split("\n");
  const commentPats = COMMENT_PATTERNS[language] ?? [];
  let blankLines = 0;
  let commentLines = 0;

  for (const line of lines) {
    if (line.trim() === "") {
      blankLines++;
    } else if (commentPats.some((p) => p.test(line))) {
      commentLines++;
    }
  }

  const funcPat = FUNCTION_PATTERNS[language];
  const importPat = IMPORT_PATTERNS[language];
  const exportPat = EXPORT_PATTERNS[language];

  return {
    lines: lines.length,
    blankLines,
    commentLines,
    codeLines: lines.length - blankLines - commentLines,
    functions: funcPat ? (content.match(funcPat) ?? []).length : 0,
    imports: importPat ? (content.match(importPat) ?? []).length : 0,
    exports: exportPat ? (content.match(exportPat) ?? []).length : 0,
  };
}

async function walkDir(dir: string, exclude: Set<string>, files: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || exclude.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, exclude, files);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (LANG_MAP[ext]) files.push(full);
    }
  }
  return files;
}

export default definePluginEntry({
  id: "file-metrics",
  name: "File Metrics",
  description: "Code complexity metrics for files and projects",
  register(api) {
    const config = (api.pluginConfig ?? {}) as FileMetricsConfig;
    const excludeDirs = new Set(config.excludeDirs ?? ["node_modules", ".git", "dist", "build", "vendor", "__pycache__"]);
    const maxFileSize = config.maxFileSize ?? 500;

    api.registerTool(
      () => ({
        name: "file_metrics",
        description:
          "Analyze a single file for code metrics: lines of code, functions, imports, exports, comments, and complexity indicators.",
        parameters: {
          type: "object" as const,
          properties: {
            file: { type: "string", description: "Path to the file to analyze" },
          },
          required: ["file"],
        },
        async execute({ file }: { file: string }) {
          try {
            const content = await fs.readFile(file, "utf-8");
            const ext = path.extname(file).toLowerCase();
            const language = LANG_MAP[ext] ?? "unknown";
            const stats = analyzeFile(content, language);

            const warnings: string[] = [];
            if (stats.lines > maxFileSize) warnings.push(`File exceeds ${maxFileSize} lines — consider splitting`);
            if (stats.functions > 20) warnings.push("High function count (>20) — consider extracting modules");
            if (stats.imports > 15) warnings.push("Many imports (>15) — may indicate high coupling");

            const lines = [
              `Metrics for ${path.basename(file)} (${language})`,
              `${"=".repeat(40)}`,
              `Total lines:   ${stats.lines}`,
              `Code lines:    ${stats.codeLines}`,
              `Comments:      ${stats.commentLines} (${((stats.commentLines / stats.lines) * 100).toFixed(1)}%)`,
              `Blank lines:   ${stats.blankLines}`,
              `Functions:     ${stats.functions}`,
              `Imports:       ${stats.imports}`,
              `Exports:       ${stats.exports}`,
            ];

            if (warnings.length > 0) {
              lines.push("", "Warnings:");
              for (const w of warnings) lines.push(`  ! ${w}`);
            }

            return lines.join("\n");
          } catch {
            return `Could not read file: ${file}`;
          }
        },
      }),
      { names: ["file_metrics"] },
    );

    api.registerTool(
      () => ({
        name: "project_metrics",
        description:
          "Get aggregate code metrics for the entire project — total LOC, language breakdown, largest files, and files that may need refactoring.",
        parameters: {
          type: "object" as const,
          properties: {
            path: { type: "string", description: "Project directory (defaults to cwd)" },
          },
        },
        async execute({ path: projectPath }: { path?: string }) {
          const rootDir = projectPath || process.cwd();
          const files = await walkDir(rootDir, excludeDirs);

          const langStats: Record<string, { files: number; lines: number; code: number }> = {};
          const allStats: Array<FileStats> = [];
          const oversized: Array<{ file: string; lines: number }> = [];

          for (const file of files) {
            try {
              const content = await fs.readFile(file, "utf-8");
              const ext = path.extname(file).toLowerCase();
              const language = LANG_MAP[ext] ?? "unknown";
              const stats = analyzeFile(content, language);

              const fileStats: FileStats = { ...stats, file: path.relative(rootDir, file), language };
              allStats.push(fileStats);

              if (!langStats[language]) langStats[language] = { files: 0, lines: 0, code: 0 };
              langStats[language].files++;
              langStats[language].lines += stats.lines;
              langStats[language].code += stats.codeLines;

              if (stats.lines > maxFileSize) {
                oversized.push({ file: path.relative(rootDir, file), lines: stats.lines });
              }
            } catch {
              // skip unreadable
            }
          }

          const totalLines = allStats.reduce((s, f) => s + f.lines, 0);
          const totalCode = allStats.reduce((s, f) => s + f.codeLines, 0);
          const totalFunctions = allStats.reduce((s, f) => s + f.functions, 0);

          const lines = [
            `Project Metrics`,
            `${"=".repeat(40)}`,
            `Files:     ${allStats.length}`,
            `Total LOC: ${totalLines.toLocaleString()}`,
            `Code LOC:  ${totalCode.toLocaleString()}`,
            `Functions: ${totalFunctions.toLocaleString()}`,
            "",
            "Language Breakdown:",
          ];

          const sorted = Object.entries(langStats).sort((a, b) => b[1].code - a[1].code);
          for (const [lang, data] of sorted) {
            const pct = ((data.code / totalCode) * 100).toFixed(1);
            lines.push(`  ${lang}: ${data.files} files, ${data.code.toLocaleString()} code lines (${pct}%)`);
          }

          if (oversized.length > 0) {
            oversized.sort((a, b) => b.lines - a.lines);
            lines.push("", `Large files (>${maxFileSize} lines):`);
            for (const f of oversized.slice(0, 15)) {
              lines.push(`  ${f.file}: ${f.lines} lines`);
            }
          }

          // Top 10 most complex files by function count
          const byFunctions = [...allStats].sort((a, b) => b.functions - a.functions).slice(0, 10);
          if (byFunctions.length > 0 && byFunctions[0].functions > 0) {
            lines.push("", "Most complex files (by function count):");
            for (const f of byFunctions) {
              if (f.functions === 0) break;
              lines.push(`  ${f.file}: ${f.functions} functions, ${f.codeLines} code lines`);
            }
          }

          return lines.join("\n");
        },
      }),
      { names: ["project_metrics"] },
    );
  },
});
