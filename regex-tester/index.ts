import { definePluginEntry } from "openclaw/plugin-sdk/core";

interface MatchResult {
  match: string;
  index: number;
  groups: Record<string, string> | null;
}

function testRegex(pattern: string, flags: string, input: string): { matches: MatchResult[]; error?: string } {
  try {
    const regex = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
    const matches: MatchResult[] = [];
    let m: RegExpExecArray | null;

    while ((m = regex.exec(input)) !== null) {
      matches.push({
        match: m[0],
        index: m.index,
        groups: m.groups ? { ...m.groups } : null,
      });
      if (!regex.global) break;
    }

    return { matches };
  } catch (err) {
    return { matches: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function highlightMatches(input: string, matches: MatchResult[]): string {
  if (matches.length === 0) return input;

  let result = "";
  let lastIndex = 0;

  for (const m of matches) {
    result += input.slice(lastIndex, m.index);
    result += `>>>${m.match}<<<`;
    lastIndex = m.index + m.match.length;
  }
  result += input.slice(lastIndex);

  return result;
}

function explainRegex(pattern: string): string {
  const explanations: string[] = [];
  const tokens: [RegExp, string][] = [
    [/\^/, "Start of string/line"],
    [/\$/, "End of string/line"],
    [/\\d/, "Any digit (0-9)"],
    [/\\D/, "Any non-digit"],
    [/\\w/, "Any word character (a-z, A-Z, 0-9, _)"],
    [/\\W/, "Any non-word character"],
    [/\\s/, "Any whitespace"],
    [/\\S/, "Any non-whitespace"],
    [/\\b/, "Word boundary"],
    [/\./, "Any character (except newline)"],
    [/\+/, "One or more of previous"],
    [/\*/, "Zero or more of previous"],
    [/\?/, "Zero or one of previous (optional)"],
    [/\{(\d+),?(\d*)\}/, "Quantifier: specific count"],
    [/\[([^\]]+)\]/, "Character class"],
    [/\((\?\:)?/, "Group (capturing or non-capturing)"],
    [/\(\?<(\w+)>/, "Named capture group"],
    [/\|/, "Alternation (OR)"],
    [/\(\?=/, "Positive lookahead"],
    [/\(\?!/, "Negative lookahead"],
    [/\(\?<=/, "Positive lookbehind"],
    [/\(\?<!/, "Negative lookbehind"],
  ];

  for (const [tokenRegex, desc] of tokens) {
    if (tokenRegex.test(pattern)) {
      explanations.push(`  ${tokenRegex.source} → ${desc}`);
    }
  }

  return explanations.length > 0
    ? `Pattern elements found:\n${explanations.join("\n")}`
    : "Simple literal pattern — matches the exact text.";
}

export default definePluginEntry({
  id: "regex-tester",
  name: "Regex Tester",
  description: "Test, debug, and explain regular expressions",
  register(api) {
    api.registerTool(
      () => ({
        name: "regex_test",
        description:
          "Test a regular expression against input text. Returns all matches with positions and captured groups. Highlights matches in context.",
        parameters: {
          type: "object" as const,
          properties: {
            pattern: { type: "string", description: "Regular expression pattern (without delimiters)" },
            input: { type: "string", description: "Text to test against" },
            flags: { type: "string", description: "Regex flags (default: 'g'). Common: g (global), i (case-insensitive), m (multiline)" },
          },
          required: ["pattern", "input"],
        },
        async execute({ pattern, input, flags = "g" }) {
          const { matches, error } = testRegex(pattern, flags, input);

          if (error) return `Regex error: ${error}`;
          if (matches.length === 0) return `No matches found for /${pattern}/${flags}`;

          const lines = [
            `Found ${matches.length} match(es) for /${pattern}/${flags}\n`,
            `Highlighted:\n${highlightMatches(input, matches)}\n`,
            "Matches:",
          ];

          for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            lines.push(`  [${i}] "${m.match}" at index ${m.index}`);
            if (m.groups) {
              for (const [name, value] of Object.entries(m.groups)) {
                lines.push(`       group "${name}": "${value}"`);
              }
            }
          }

          return lines.join("\n");
        },
      }),
      { names: ["regex_test"] },
    );

    api.registerTool(
      () => ({
        name: "regex_explain",
        description: "Explain what a regular expression pattern does in plain language.",
        parameters: {
          type: "object" as const,
          properties: {
            pattern: { type: "string", description: "Regular expression pattern to explain" },
          },
          required: ["pattern"],
        },
        async execute({ pattern }) {
          return `Explanation of /${pattern}/:\n\n${explainRegex(pattern)}`;
        },
      }),
      { names: ["regex_explain"] },
    );

    api.registerTool(
      () => ({
        name: "regex_replace",
        description: "Preview a regex replace operation. Shows before/after without modifying any files.",
        parameters: {
          type: "object" as const,
          properties: {
            pattern: { type: "string", description: "Regular expression pattern" },
            replacement: { type: "string", description: "Replacement string (supports $1, $2, etc.)" },
            input: { type: "string", description: "Text to transform" },
            flags: { type: "string", description: "Regex flags (default: 'g')" },
          },
          required: ["pattern", "replacement", "input"],
        },
        async execute({ pattern, replacement, input, flags = "g" }) {
          try {
            const regex = new RegExp(pattern, flags);
            const result = input.replace(regex, replacement);
            return [
              `Replace /${pattern}/${flags} → "${replacement}"\n`,
              "Before:",
              input,
              "\nAfter:",
              result,
            ].join("\n");
          } catch (err) {
            return `Regex error: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      { names: ["regex_replace"] },
    );
  },
});
