import { definePluginEntry } from "openclaw/plugin-sdk/core";

interface ApiTesterConfig {
  timeout: number;
  defaultHeaders: Record<string, string>;
}

interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timing: number;
}

async function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeout: number,
): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const start = performance.now();

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body && method !== "GET" && method !== "HEAD" ? body : undefined,
      signal: controller.signal,
    });

    const timing = performance.now() - start;
    const responseBody = await response.text();

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      timing,
    };
  } finally {
    clearTimeout(timer);
  }
}

function formatResponse(res: ApiResponse, verbose: boolean): string {
  const lines = [
    `${res.status} ${res.statusText} (${res.timing.toFixed(0)}ms)`,
  ];

  if (verbose) {
    lines.push("", "Response Headers:");
    for (const [key, value] of Object.entries(res.headers)) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  lines.push("");

  // Try to pretty-print JSON
  try {
    const parsed = JSON.parse(res.body);
    lines.push(JSON.stringify(parsed, null, 2));
  } catch {
    // Truncate very long non-JSON responses
    if (res.body.length > 3000) {
      lines.push(res.body.slice(0, 3000));
      lines.push(`\n... (${res.body.length - 3000} more characters)`);
    } else {
      lines.push(res.body);
    }
  }

  return lines.join("\n");
}

export default definePluginEntry({
  id: "api-tester",
  name: "API Tester",
  description: "Quick HTTP API testing and inspection",
  register(api) {
    const config = (api.pluginConfig ?? {}) as ApiTesterConfig;
    const defaultTimeout = config.timeout ?? 30_000;
    const defaultHeaders = config.defaultHeaders ?? {};

    api.registerTool(
      () => ({
        name: "api_request",
        description:
          "Send an HTTP request and inspect the response. Supports GET, POST, PUT, PATCH, DELETE. Auto-formats JSON responses.",
        parameters: {
          type: "object" as const,
          properties: {
            url: { type: "string", description: "Request URL" },
            method: {
              type: "string",
              description: "HTTP method (default: GET)",
              enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
            },
            headers: {
              type: "object",
              description: "Request headers as key-value pairs",
            },
            body: { type: "string", description: "Request body (JSON string for JSON APIs)" },
            verbose: { type: "boolean", description: "Show response headers (default: false)" },
          },
          required: ["url"],
        },
        async execute({
          url,
          method = "GET",
          headers = {},
          body,
          verbose = false,
        }: {
          url: string;
          method?: string;
          headers?: Record<string, string>;
          body?: string;
          verbose?: boolean;
        }) {
          const mergedHeaders = { ...defaultHeaders, ...headers };

          // Auto-set content-type for JSON bodies
          if (body && !mergedHeaders["Content-Type"] && !mergedHeaders["content-type"]) {
            try {
              JSON.parse(body);
              mergedHeaders["Content-Type"] = "application/json";
            } catch {
              // not JSON, leave as-is
            }
          }

          try {
            const res = await makeRequest(url, method.toUpperCase(), mergedHeaders, body, defaultTimeout);
            return `${method.toUpperCase()} ${url}\n${formatResponse(res, verbose)}`;
          } catch (err) {
            return `Request failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      { names: ["api_request"] },
    );

    api.registerTool(
      () => ({
        name: "api_multi",
        description:
          "Send multiple API requests in sequence and compare responses. Useful for testing different endpoints or parameters.",
        parameters: {
          type: "object" as const,
          properties: {
            requests: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  url: { type: "string" },
                  method: { type: "string" },
                  headers: { type: "object" },
                  body: { type: "string" },
                },
                required: ["url"],
              },
              description: "Array of requests to send",
            },
          },
          required: ["requests"],
        },
        async execute({
          requests,
        }: {
          requests: Array<{
            label?: string;
            url: string;
            method?: string;
            headers?: Record<string, string>;
            body?: string;
          }>;
        }) {
          const results: string[] = [`Batch API Test (${requests.length} requests)\n${"=".repeat(40)}\n`];

          for (let i = 0; i < requests.length; i++) {
            const req = requests[i];
            const label = req.label || `Request ${i + 1}`;
            const method = (req.method ?? "GET").toUpperCase();
            const mergedHeaders = { ...defaultHeaders, ...(req.headers ?? {}) };

            results.push(`### ${label}: ${method} ${req.url}`);

            try {
              const res = await makeRequest(req.url, method, mergedHeaders, req.body, defaultTimeout);
              results.push(`${res.status} ${res.statusText} (${res.timing.toFixed(0)}ms)`);

              // Short body preview
              try {
                const parsed = JSON.parse(res.body);
                const preview = JSON.stringify(parsed, null, 2);
                results.push(preview.length > 500 ? preview.slice(0, 500) + "\n..." : preview);
              } catch {
                results.push(res.body.slice(0, 500));
              }
            } catch (err) {
              results.push(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
            }

            results.push("");
          }

          return results.join("\n");
        },
      }),
      { names: ["api_multi"] },
    );
  },
});
