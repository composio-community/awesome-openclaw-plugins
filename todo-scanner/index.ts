import { definePluginEntry } from "openclaw/plugin-sdk/core";
import fs from "node:fs/promises";
import path from "node:path";

interface TodoScannerConfig {
  tags: string[];
  excludeDirs: string[];
}

interface TodoItem {
  file: string;
  line: number;
  tag: string;
  text: string;
}

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rb", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala",
  ".vue", ".svelte", ".astro", ".html", ".css", ".scss", ".less",
  ".sh", ".bash", ".zsh", ".fish", ".yaml", ".yml", ".toml", ".json",
  ".md", ".txt", ".sql", ".graphql", ".proto",
]);

async function walkDir(
  dir: string,
  excludeDirs: Set<string>,
  files: string[] = [],
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || excludeDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, excludeDirs, files);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanFile(filePath: string, tagPattern: RegExp, rootDir: string): Promise<TodoItem[]> {
  const items: TodoItem[] = [];
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(tagPattern);
      if (match) {
        items.push({
          file: path.relative(rootDir, filePath),
          line: i + 1,
          tag: match[1].toUpperCase(),
          text: lines[i].trim(),
        });
      }
    }
  } catch {
    // skip unreadable files
  }
  return items;
}

export default definePluginEntry({
  id: "todo-scanner",
  name: "TODO Scanner",
  description: "Scan codebase for TODO, FIXME, HACK, and other annotations",
  register(api) {
    const config = (api.pluginConfig ?? {}) as TodoScannerConfig;
    const tags = config.tags ?? ["TODO", "FIXME", "HACK", "XXX", "BUG", "WARN"];
    const excludeDirs = new Set(config.excludeDirs ?? ["node_modules", ".git", "dist", "build", "vendor"]);

    api.registerTool(
      () => ({
        name: "todo_scan",
        description: `Scan the codebase for annotation comments (${tags.join(", ")}). Returns a categorized list with file paths and line numbers.`,
        parameters: {
          type: "object" as const,
          properties: {
            path: { type: "string", description: "Directory to scan (defaults to cwd)" },
            tag: { type: "string", description: "Filter by specific tag (e.g. 'FIXME')" },
          },
        },
        async execute({ path: scanPath, tag }: { path?: string; tag?: string }) {
          const rootDir = scanPath || process.cwd();
          const activeTags = tag ? [tag.toUpperCase()] : tags;
          const tagPattern = new RegExp(`\\b(${activeTags.join("|")})\\b[:\\s]?(.*)`, "i");

          const files = await walkDir(rootDir, excludeDirs);
          const allItems: TodoItem[] = [];

          for (const file of files) {
            const items = await scanFile(file, tagPattern, rootDir);
            allItems.push(...items);
          }

          if (allItems.length === 0) {
            return `No ${activeTags.join("/")} annotations found.`;
          }

          const grouped = new Map<string, TodoItem[]>();
          for (const item of allItems) {
            const existing = grouped.get(item.tag) ?? [];
            existing.push(item);
            grouped.set(item.tag, existing);
          }

          const lines: string[] = [`Found ${allItems.length} annotation(s) across ${files.length} files:\n`];
          for (const [tagName, items] of grouped) {
            lines.push(`## ${tagName} (${items.length})`);
            for (const item of items) {
              lines.push(`  ${item.file}:${item.line} — ${item.text}`);
            }
            lines.push("");
          }

          return lines.join("\n");
        },
      }),
      { names: ["todo_scan"] },
    );
  },
});
