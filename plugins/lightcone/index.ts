import { definePluginEntry } from "openclaw/plugin-sdk/core";

interface LightconeConfig {
  apiKey?: string;
  defaultMaxSteps: number;
  defaultKind: "browser" | "desktop";
}

interface LightconeSession {
  sessionId: string;
  status: string;
  screenshotUrl?: string;
}

const API_BASE = "https://api.lightcone.ai/v1";

function getApiKey(config: LightconeConfig): string {
  return config.apiKey || process.env.TZAFON_API_KEY || "";
}

async function lightconeRequest(
  path: string,
  apiKey: string,
  method: string = "POST",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Lightcone API error (${response.status}): ${text}`);
  }

  return response.json();
}

export default definePluginEntry({
  id: "lightcone",
  name: "Lightcone",
  description: "Cloud browser and desktop automation via Lightcone",
  register(api) {
    const config = (api.pluginConfig ?? {}) as LightconeConfig;
    const defaultMaxSteps = config.defaultMaxSteps ?? 50;
    const defaultKind = config.defaultKind ?? "browser";

    api.registerTool(
      () => ({
        name: "lightcone_browse",
        description:
          "Delegate a browsing task to Lightcone's Northstar model. Describe what you want done in plain language and a cloud computer will complete it. Returns page content and screenshot. No local browser needed.",
        parameters: {
          type: "object" as const,
          properties: {
            instruction: {
              type: "string",
              description: "What to do (e.g., 'Find the price of MacBook Air M4 on Amazon')",
            },
            url: { type: "string", description: "Starting URL (optional)" },
            maxSteps: { type: "number", description: `Max steps before stopping (default: ${defaultMaxSteps})` },
          },
          required: ["instruction"],
        },
        async execute({ instruction, url, maxSteps }: { instruction: string; url?: string; maxSteps?: number }) {
          const apiKey = getApiKey(config);
          if (!apiKey) return "Error: No API key configured. Set TZAFON_API_KEY or configure plugins.entries.lightcone.config.apiKey";

          try {
            const result = await lightconeRequest("/browse", apiKey, "POST", {
              instruction,
              url,
              maxSteps: maxSteps ?? defaultMaxSteps,
            });
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return `Lightcone browse failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      { names: ["lightcone_browse"] },
    );

    api.registerTool(
      () => ({
        name: "lightcone_session_create",
        description:
          "Create a new Lightcone cloud computer (browser or desktop). Returns a session ID and initial screenshot for step-by-step automation.",
        parameters: {
          type: "object" as const,
          properties: {
            url: { type: "string", description: "Navigate to this URL immediately" },
            kind: {
              type: "string",
              enum: ["browser", "desktop"],
              description: `Session type (default: ${defaultKind})`,
            },
          },
        },
        async execute({ url, kind }: { url?: string; kind?: string }) {
          const apiKey = getApiKey(config);
          if (!apiKey) return "Error: No API key. Set TZAFON_API_KEY or configure plugin.";

          try {
            const result = await lightconeRequest("/sessions", apiKey, "POST", {
              url,
              kind: kind ?? defaultKind,
            }) as LightconeSession;
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return `Failed to create session: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      { names: ["lightcone_session_create"] },
    );

    api.registerTool(
      () => ({
        name: "lightcone_session_action",
        description:
          "Execute an action on a Lightcone cloud computer: click, type, scroll, navigate, screenshot, hotkey, wait, or get page HTML.",
        parameters: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "Session ID from lightcone_session_create" },
            action: {
              type: "string",
              enum: ["screenshot", "navigate", "click", "doubleClick", "rightClick", "type", "hotkey", "scroll", "html", "wait", "debug"],
              description: "Action to perform",
            },
            url: { type: "string", description: "For navigate action" },
            x: { type: "number", description: "X pixel coordinate for click/scroll" },
            y: { type: "number", description: "Y pixel coordinate for click/scroll" },
            text: { type: "string", description: "Text for type action" },
            keys: { type: "string", description: "Comma-separated keys for hotkey (e.g., 'Control,c')" },
            dx: { type: "number", description: "Horizontal scroll delta" },
            dy: { type: "number", description: "Vertical scroll delta" },
            seconds: { type: "number", description: "Seconds to wait" },
            command: { type: "string", description: "Shell command for debug action" },
          },
          required: ["sessionId", "action"],
        },
        async execute(params: Record<string, unknown>) {
          const apiKey = getApiKey(config);
          if (!apiKey) return "Error: No API key.";

          const { sessionId, ...actionParams } = params;
          try {
            const result = await lightconeRequest(
              `/sessions/${sessionId}/actions`,
              apiKey,
              "POST",
              actionParams,
            );
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return `Action failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      { names: ["lightcone_session_action"] },
    );

    api.registerTool(
      () => ({
        name: "lightcone_session_close",
        description: "Terminate a Lightcone cloud computer and free resources.",
        parameters: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "Session ID to terminate" },
          },
          required: ["sessionId"],
        },
        async execute({ sessionId }: { sessionId: string }) {
          const apiKey = getApiKey(config);
          if (!apiKey) return "Error: No API key.";

          try {
            await lightconeRequest(`/sessions/${sessionId}`, apiKey, "DELETE");
            return `Session ${sessionId} closed.`;
          } catch (err) {
            return `Failed to close session: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      { names: ["lightcone_session_close"] },
    );
  },
});
