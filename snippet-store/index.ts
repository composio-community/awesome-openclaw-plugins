import { definePluginEntry } from "openclaw/plugin-sdk/core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

interface SnippetStoreConfig {
  storeDir?: string;
  maxSnippets: number;
}

interface Snippet {
  id: string;
  name: string;
  language: string;
  tags: string[];
  code: string;
  description: string;
  createdAt: string;
  usageCount: number;
}

interface SnippetIndex {
  snippets: Snippet[];
}

export default definePluginEntry({
  id: "snippet-store",
  name: "Snippet Store",
  description: "Save, search, and recall reusable code snippets",
  register(api) {
    const config = (api.pluginConfig ?? {}) as SnippetStoreConfig;
    const storeDir = config.storeDir ?? path.join(os.homedir(), ".openclaw", "snippets");
    const maxSnippets = config.maxSnippets ?? 500;
    const indexPath = path.join(storeDir, "index.json");

    async function ensureStore() {
      await fs.mkdir(storeDir, { recursive: true });
      try {
        await fs.access(indexPath);
      } catch {
        await fs.writeFile(indexPath, JSON.stringify({ snippets: [] }, null, 2));
      }
    }

    async function readIndex(): Promise<SnippetIndex> {
      await ensureStore();
      const raw = await fs.readFile(indexPath, "utf-8");
      return JSON.parse(raw);
    }

    async function writeIndex(index: SnippetIndex) {
      await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    }

    function generateId(): string {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function matchesQuery(snippet: Snippet, query: string): boolean {
      const q = query.toLowerCase();
      return (
        snippet.name.toLowerCase().includes(q) ||
        snippet.description.toLowerCase().includes(q) ||
        snippet.tags.some((t) => t.toLowerCase().includes(q)) ||
        snippet.language.toLowerCase().includes(q) ||
        snippet.code.toLowerCase().includes(q)
      );
    }

    api.registerTool(
      () => ({
        name: "snippet_save",
        description: "Save a reusable code snippet for later recall. Tag it for easy searching.",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Short name for the snippet" },
            code: { type: "string", description: "The code to save" },
            language: { type: "string", description: "Programming language (e.g., typescript, python)" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for categorization (e.g., ['auth', 'middleware'])",
            },
            description: { type: "string", description: "What this snippet does" },
          },
          required: ["name", "code"],
        },
        async execute({ name, code, language = "text", tags = [], description = "" }) {
          const index = await readIndex();

          if (index.snippets.length >= maxSnippets) {
            // Remove least-used snippet
            index.snippets.sort((a, b) => a.usageCount - b.usageCount);
            index.snippets.shift();
          }

          const snippet: Snippet = {
            id: generateId(),
            name,
            language,
            tags,
            code,
            description,
            createdAt: new Date().toISOString(),
            usageCount: 0,
          };

          index.snippets.push(snippet);
          await writeIndex(index);

          return `Saved snippet "${name}" (id: ${snippet.id}) with ${tags.length} tag(s).`;
        },
      }),
      { names: ["snippet_save"] },
    );

    api.registerTool(
      () => ({
        name: "snippet_search",
        description: "Search saved code snippets by name, tags, language, or content.",
        parameters: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Search query" },
            language: { type: "string", description: "Filter by language" },
            tag: { type: "string", description: "Filter by tag" },
            limit: { type: "number", description: "Max results (default: 10)" },
          },
          required: ["query"],
        },
        async execute({ query, language, tag, limit = 10 }) {
          const index = await readIndex();
          let results = index.snippets.filter((s) => matchesQuery(s, query));

          if (language) results = results.filter((s) => s.language.toLowerCase() === language.toLowerCase());
          if (tag) results = results.filter((s) => s.tags.some((t) => t.toLowerCase() === tag.toLowerCase()));

          results = results.slice(0, limit);

          if (results.length === 0) return `No snippets found for "${query}".`;

          return results
            .map((s) => {
              return [
                `### ${s.name} (${s.id})`,
                `Language: ${s.language} | Tags: ${s.tags.join(", ") || "none"} | Used: ${s.usageCount}x`,
                s.description ? `${s.description}\n` : "",
                "```" + s.language,
                s.code,
                "```",
              ].join("\n");
            })
            .join("\n\n");
        },
      }),
      { names: ["snippet_search"] },
    );

    api.registerTool(
      () => ({
        name: "snippet_get",
        description: "Retrieve a specific snippet by its ID. Increments usage count.",
        parameters: {
          type: "object" as const,
          properties: {
            id: { type: "string", description: "Snippet ID" },
          },
          required: ["id"],
        },
        async execute({ id }) {
          const index = await readIndex();
          const snippet = index.snippets.find((s) => s.id === id);
          if (!snippet) return `Snippet ${id} not found.`;

          snippet.usageCount++;
          await writeIndex(index);

          return "```" + snippet.language + "\n" + snippet.code + "\n```";
        },
      }),
      { names: ["snippet_get"] },
    );

    api.registerTool(
      () => ({
        name: "snippet_delete",
        description: "Delete a saved snippet by its ID.",
        parameters: {
          type: "object" as const,
          properties: {
            id: { type: "string", description: "Snippet ID to delete" },
          },
          required: ["id"],
        },
        async execute({ id }) {
          const index = await readIndex();
          const before = index.snippets.length;
          index.snippets = index.snippets.filter((s) => s.id !== id);
          if (index.snippets.length === before) return `Snippet ${id} not found.`;

          await writeIndex(index);
          return `Deleted snippet ${id}. ${index.snippets.length} snippets remaining.`;
        },
      }),
      { names: ["snippet_delete"] },
    );
  },
});
