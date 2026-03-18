import { definePluginEntry } from "openclaw/plugin-sdk/core";

interface EnvGuardConfig {
  extraPatterns: string[];
  blockOnDetection: boolean;
}

const BUILT_IN_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9\-_]{20,}/i,
  /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  /(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Z0-9\/+=]{16,}/,
  /ghp_[A-Za-z0-9]{36}/,
  /sk-[A-Za-z0-9]{32,}/,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
  /(?:mongodb\+srv|postgres|mysql):\/\/[^\s]+:[^\s]+@/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /xox[bprs]-[A-Za-z0-9\-]{10,}/,
];

function scanForSecrets(text: string, extraPatterns: RegExp[]): string[] {
  const allPatterns = [...BUILT_IN_PATTERNS, ...extraPatterns];
  const findings: string[] = [];

  for (const pattern of allPatterns) {
    const match = text.match(pattern);
    if (match) {
      const snippet = match[0].slice(0, 12) + "***";
      findings.push(`Detected potential secret: ${snippet} (pattern: ${pattern.source.slice(0, 40)})`);
    }
  }

  return findings;
}

function loadEnvVarValues(): Map<string, string> {
  const envMap = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && !/^(\/|HOME|USER|SHELL|PATH|TERM|LANG|LC_)/.test(key)) {
      envMap.set(key, value);
    }
  }
  return envMap;
}

function checkForEnvLeaks(text: string, envVars: Map<string, string>): string[] {
  const leaks: string[] = [];
  for (const [key, value] of envVars) {
    if (text.includes(value)) {
      leaks.push(`Environment variable ${key} value found in text`);
    }
  }
  return leaks;
}

export default definePluginEntry({
  id: "env-guard",
  name: "Env Guard",
  description: "Prevents accidental exposure of secrets and environment variables",
  register(api) {
    const config = (api.pluginConfig ?? {}) as EnvGuardConfig;
    const extraPatterns = (config.extraPatterns ?? []).map((p) => new RegExp(p, "i"));
    const blockOnDetection = config.blockOnDetection ?? true;
    const envVars = loadEnvVarValues();

    api.registerTool(
      () => ({
        name: "env_guard_scan",
        description:
          "Scan text or file contents for accidentally exposed secrets, API keys, tokens, and environment variable values. Use before sharing code or output externally.",
        parameters: {
          type: "object" as const,
          properties: {
            text: { type: "string", description: "Text to scan for secrets" },
          },
          required: ["text"],
        },
        async execute({ text }) {
          const secretFindings = scanForSecrets(text, extraPatterns);
          const leakFindings = checkForEnvLeaks(text, envVars);
          const allFindings = [...secretFindings, ...leakFindings];

          if (allFindings.length === 0) {
            return "No secrets or environment variable leaks detected.";
          }

          return `Found ${allFindings.length} potential issue(s):\n${allFindings.map((f) => `  - ${f}`).join("\n")}`;
        },
      }),
      { names: ["env_guard_scan"] },
    );

    api.on("tool_result_persist", (event) => {
      const content = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
      const findings = [
        ...scanForSecrets(content, extraPatterns),
        ...checkForEnvLeaks(content, envVars),
      ];

      if (findings.length > 0 && blockOnDetection) {
        api.logger.warn(`Env Guard: blocked tool result containing ${findings.length} potential secret(s)`);
        return {
          ...event,
          result: `[ENV GUARD] Tool result redacted — ${findings.length} potential secret(s) detected. Run env_guard_scan for details.`,
        };
      }

      return event;
    });
  },
});
