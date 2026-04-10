# Awesome OpenClaw Plugins [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

> A curated list of community-built plugins for [OpenClaw](https://github.com/openclaw/openclaw) — the open-source AI agent framework.

OpenClaw has a growing ecosystem of community plugins that extend its capabilities far beyond the defaults. Many of these started as unmerged PRs in the main repo's docs, and deserve visibility.

This repo includes **ready-to-install plugins** in the [`plugins/`](./plugins) directory, plus a curated list of community plugins from around the ecosystem.

**Star this repo** to keep up with the best community plugins as they ship.

---

## Quick Start

```bash
openclaw plugins install @composio/openclaw-plugin
openclaw config set plugins.entries.composio.config.consumerKey "ck_your_key_here"
openclaw config set tools.alsoAllow '["composio"]'
openclaw gateway restart
```

> Get your key at [dashboard.composio.dev](https://dashboard.composio.dev)

Now try it — paste this into your agent:

```
Send a Slack message to #general saying "hello from openclaw"
```

---

## Contents

- [Quick Start](#quick-start)
- [Included Plugins](#included-plugins) — install directly from this repo
- [Community Plugins](#community-plugins)
  - [Memory & Context](#memory--context)
  - [Security & Governance](#security--governance)
  - [Observability & Cost](#observability--cost)
  - [Multi-Agent](#multi-agent)
  - [Meta / Self-Improvement](#meta--self-improvement)
- [Other Notable Plugins](#other-notable-plugins)
  - [Messaging & Channels](#messaging--channels)
  - [Smart Home & IoT](#smart-home--iot)
  - [Mobile](#mobile)
  - [Payments & Web3](#payments--web3)
  - [Health & Wellness](#health--wellness)
  - [Database & Storage](#database--storage)
  - [CI/CD & Deployment](#cicd--deployment)
  - [Documentation & Knowledge](#documentation--knowledge)
  - [Notifications & Alerts](#notifications--alerts)
  - [Code Quality & Linting](#code-quality--linting)
  - [Analytics & Logging](#analytics--logging)
  - [Utility](#utility)
- [Resources](#resources)
- [Contributing](#contributing)

---

## Included Plugins

Install any plugin from this repo directly:

```bash
openclaw plugins install ./plugins/<plugin-name>
# or link for development
openclaw plugins install -l ./plugins/<plugin-name>
```

| Plugin | Tools | Description |
|--------|-------|-------------|
| [git-stats](./plugins/git-stats) | `git_stats`, `git_file_history` | Repository statistics, top authors, hot files, and per-file change history |
| [env-guard](./plugins/env-guard) | `env_guard_scan` | Secret and API key leak prevention — scans text and auto-redacts tool output containing secrets |
| [todo-scanner](./plugins/todo-scanner) | `todo_scan` | Scan your codebase for TODO, FIXME, HACK, XXX, BUG annotations with file:line references |
| [cost-tracker](./plugins/cost-tracker) | `cost_summary` | Track token usage and estimated costs per session/model with daily budget alerts |
| [dep-audit](./plugins/dep-audit) | `dep_audit`, `dep_outdated` | Audit dependencies for known vulnerabilities (npm, yarn, pnpm, pip, cargo, go) |
| [changelog-gen](./plugins/changelog-gen) | `changelog_generate` | Auto-generate changelogs from conventional commits in Keep a Changelog format |
| [snippet-store](./plugins/snippet-store) | `snippet_save`, `snippet_search`, `snippet_get`, `snippet_delete` | Save, tag, search, and recall reusable code snippets across sessions |
| [commit-guard](./plugins/commit-guard) | `commit_check` | Pre-commit validation — blocks secrets, oversized files, and non-conventional messages |
| [pomodoro](./plugins/pomodoro) | `pomo_start`, `pomo_status`, `pomo_stop`, `pomo_history` | Pomodoro timer for focused coding with break reminders and session tracking |
| [regex-tester](./plugins/regex-tester) | `regex_test`, `regex_explain`, `regex_replace` | Test, explain, and preview regex replacements without modifying files |
| [file-metrics](./plugins/file-metrics) | `file_metrics`, `project_metrics` | Code complexity metrics — LOC, function count, language breakdown, and oversized file detection |
| [pr-review](./plugins/pr-review) | `pr_summary`, `pr_checklist` | PR review helper — summarize changes, suggest reviewers, detect debug leftovers, generate review checklists |
| [docker-helper](./plugins/docker-helper) | `docker_status`, `docker_logs`, `dockerfile_lint`, `docker_compose_status` | Docker container management, log viewer, and Dockerfile linter |
| [api-tester](./plugins/api-tester) | `api_request`, `api_multi` | Quick HTTP API testing — send requests, auto-format JSON, batch test multiple endpoints |
| [time-tracker](./plugins/time-tracker) | `time_start`, `time_stop`, `time_status`, `time_report` | Track time spent on tasks/projects with reports by period, project, and tags |
| [lightcone](./plugins/lightcone) | `lightcone_browse`, `lightcone_session_create`, `lightcone_session_action`, `lightcone_session_close` | Cloud browser/desktop automation via Lightcone Northstar — no local Chrome needed ([PR #48298](https://github.com/openclaw/openclaw/pull/48298)) |
| [cortex-memory](./plugins/cortex-memory) | `memory_search`, `memory_store`, `memory_get`, `belief_observe`, `fact_add`, `person_resolve` | 4-tier persistent memory (Working → Episodic → Semantic → Procedural) with Bayesian beliefs. Rust-native, local-first ([PR #48275](https://github.com/openclaw/openclaw/pull/48275)) |
| [n8n-as-code](./plugins/n8n-as-code) | `n8nac` | Conversational n8n workflow automation — 537 node schemas, 10k+ properties, bidirectional sync with live instances ([PR #45214](https://github.com/openclaw/openclaw/pull/45214)) |
| [claude-code-bridge](./plugins/claude-code-bridge) | `claude_plan`, `claude_exec`, `claude_teams` | Run Claude Code from OpenClaw — read-only analysis, execution, and multi-agent parallel coding ([PR #27071](https://github.com/openclaw/openclaw/pull/27071)) |
| [apple-pim](./plugins/apple-pim) | `apple_pim_calendar`, `apple_pim_reminder`, `apple_pim_contact`, `apple_pim_mail` | Native macOS Calendar, Reminders, Contacts, and Mail.app via Swift CLIs. macOS only ([PR #21497](https://github.com/openclaw/openclaw/pull/21497)) |

Each plugin follows the standard OpenClaw plugin structure (`openclaw.plugin.json` + `index.ts` + `package.json`) and works out of the box.

---

## Community Plugins

### Memory & Context

| Plugin | Author | Stars | Description |
|--------|--------|-------|-------------|
| [memory-lancedb-pro](https://github.com/CortexReach/memory-lancedb-pro) | CortexReach | 2.9k | Enhanced LanceDB memory with Hybrid Retrieval (Vector + BM25), Cross-Encoder Reranking (Jina, SiliconFlow, Voyage, Pinecone), multi-scope isolation (global, agent, project, user), and a full management CLI. |
| [Lossless Claw (LCM)](https://github.com/Martian-Engineering/lossless-claw) | Martian-Engineering | — | Replaces default sliding-window compaction with a DAG-based summarization system. Persists every message in SQLite, builds hierarchical summaries, and provides `lcm_grep`, `lcm_describe`, `lcm_expand` tools for agents to search compacted history. |
| [openclaw-engram](https://github.com/joshuaswarren/openclaw-engram) | joshuaswarren | — | Local-first memory plugin with LLM-powered fact extraction, plain markdown storage, and hybrid search (BM25 + vector + reranking via QMD). Works fully offline with Ollama/LM Studio. |
| [openclaw-supermemory](https://github.com/supermemoryai/openclaw-supermemory) | supermemoryai | — | Cloud-backed long-term memory. Auto-recalls relevant memories before every AI turn and auto-captures conversations for extraction and deduplication. |
| [openclaw-memory-mem0](https://github.com/serenichron/openclaw-memory-mem0) | serenichron | — | Replaces default LanceDB memory backend with Mem0's semantic extraction pipeline. Provides `memory_recall`, `memory_store`, `memory_forget` tools with auto-recall and auto-capture lifecycle hooks. |
| [MemOS Cloud Plugin](https://github.com/MemTensor/MemOS-Cloud-OpenClaw-Plugin) | MemTensor | 283 | Recalls memories from MemOS Cloud before each run and saves conversations after each run. Supports multi-agent architectures with isolated memory per `agent_id`. |
| [Unified Memory](https://github.com/bmbsystemsdir/openclaw-unified-plugins) | bmbsystemsdir | — | Combines Graphiti knowledge graphs with Beads temporal memory into a single plugin for rich context management. |

### Security & Governance

| Plugin | Author | Stars | Description |
|--------|--------|-------|-------------|
| [ClawSec](https://github.com/prompt-security/clawsec) | prompt-security | 778 | Complete security skill suite — SOUL.md drift detection, live NVD CVE polling, automated audits detecting prompt injection, and SHA256 skill integrity verification. |
| [SecureClaw](https://github.com/adversa-ai/secureclaw) | adversa-ai | 274 | OWASP Agentic Security Top 10 aligned. 56 automated checks across 8 categories scanning for exposed gateway ports, weak permissions, missing auth, plaintext credentials, and disabled sandboxing. |
| [GuardSpine](https://github.com/DNYoussef/guardspine-openclaw) | DNYoussef | — | Deny-by-default tool gating with L0–L4 risk tiers, SHA-256 hash-chained evidence packs, local 3-model council voting (Qwen/Falcon/Coder via Ollama), and Discord approval notifications. |
| [@axonflow/openclaw](https://github.com/getaxonflow/axonflow-openclaw-plugin) | getaxonflow | — | Policy enforcement, PII detection, and audit trails for OpenClaw tool execution. Integrates with AxonFlow's governance engine for real-time input/output checks. |

### Observability & Cost

| Plugin | Author | Stars | Description |
|--------|--------|-------|-------------|
| [Manifest](https://github.com/mnfst/manifest) | mnfst | 3.8k | Smart LLM routing and real-time cost observability. Cuts AI costs up to 70% with intelligent model selection. Embedded NestJS server with SQLite, OpenTelemetry traces. Tracks tokens and costs across 28+ models. |
| [openclaw-observability-plugin](https://github.com/henrikrexed/openclaw-observability-plugin) | henrikrexed | — | Full OpenTelemetry observability with connected trace hierarchy (request → agent turn → tool calls), per-tool timing, and token usage tracking. Supports Dynatrace, Grafana Cloud, and local OTLP collectors. |
| [openclaw-observatory](https://github.com/ThisIsJeron/openclaw-observatory) | ThisIsJeron | — | Self-hosted dashboard monitoring sessions, context window usage, and costs across all gateways. |
| [Silos Dashboard](https://github.com/cheapestinference/silos) | cheapestinference | — | Open-source (MIT) multi-tenant dashboard for OpenClaw — shared browser session, multi-channel management (WhatsApp, Telegram, Discord, Slack), skills marketplace, Docker one-command deploy, agent/session analytics, cron jobs, i18n (en/es/fr/de). Also available as [managed hosting](https://silosplatform.com). |

### Multi-Agent

| Plugin | Author | Stars | Description |
|--------|--------|-------|-------------|
| [OpenClaw A2A Gateway](https://github.com/win4r/openclaw-a2a-gateway) | win4r | 257 | Implements A2A (Agent-to-Agent) protocol v0.3.0 — bidirectional JSON-RPC + REST gateway, Agent Card publication for peer discovery, bearer token auth, SSE streaming, circuit breaker patterns, and Ed25519 device identity. |

### Meta / Self-Improvement

| Plugin | Author | Stars | Description |
|--------|--------|-------|-------------|
| [OpenClaw Foundry](https://github.com/lekt9/openclaw-foundry) | lekt9 | 264 | Self-writing meta-extension that observes your workflows, recognizes patterns (5+ uses, 70%+ success rate), and autonomously writes new extensions/skills. Browser automation via CDP, sandbox validation with static security scanning. |

### Tool Integrations

| Plugin | Author | Stars | Description |
|--------|--------|-------|-------------|
| [@composio/openclaw-plugin](https://www.npmjs.com/package/@composio/openclaw-plugin) | Composio | — | Access 1000+ third-party tools (Gmail, Slack, GitHub, Notion, Linear, Jira, HubSpot, Salesforce, Google Drive, etc.) via Composio's MCP server. Single plugin, one API key. |

## Other Notable Plugins

### Messaging & Channels

- **[openclaw-wechat](https://github.com/icesword0760/openclaw-wechat)** — WeChat personal account integration via WeChatPadPro (iPad protocol). Supports text, image, and file exchange with keyword-triggered conversations.
- **[clawdbot-feishu](https://github.com/m1heng/clawdbot-feishu)** — Feishu/Lark channel with Stream mode, AI cards, and docs/wiki tools for enterprise collaboration.
- **[openclaw-channel-dingtalk](https://github.com/soimy/openclaw-channel-dingtalk)** — DingTalk enterprise bot with Stream mode and interactive cards.
- **[openclaw-xmtp](https://github.com/flooredApe/openclaw-xmtp)** — XMTP wallet messaging for AI agents — Web3 native communication channel.
- **[OpenClaw-IRC-Plugin](https://github.com/kcherry497/OpenClaw-IRC-Plugin)** — IRC interface with KISS security principles.
- **[clawdtalk-client](https://github.com/team-telnyx/clawdtalk-client)** — Voice calling and SMS via Telnyx with calendar and Jira integration. Real-time WebSocket speech transcription. Free tier: 10 min voice + 100 SMS/day.

### Smart Home & IoT

- **[OpenClawHomeAssistant](https://github.com/techartdev/OpenClawHomeAssistant)** — Home Assistant add-on to run OpenClaw directly in your HA instance with full entity-level access for smart home control.
- **[openclaw-tescmd](https://github.com/Oceanswave/openclaw-tescmd)** — Tesla vehicle control and telemetry. 40 agent tools covering status, control, navigation, superchargers, and triggers. 15 slash commands. Real-time telemetry streaming.

### Mobile

- **[ClawBridge](https://github.com/dreamwing/clawbridge)** — Mobile dashboard / Mission Control. Live activity feed of agent thoughts and tool execution, token economy tracking, memory timeline browser, and ability to trigger cron jobs from your phone. ⭐ 196

### Payments & Web3

- **[openclaw-crossmint-plugin](https://github.com/Crossmint/openclaw-crossmint-plugin)** — On-chain wallet and payments via Crossmint smart wallets. Agents can manage balances, send tokens, and buy products using stablecoins.

### Health & Wellness

- **[OuraClaw](https://github.com/rickybloomfield/OuraClaw)** — Oura Ring integration providing sleep, readiness, and activity data to your OpenClaw agent.

### Database & Storage

- **[openclaw-supabase](https://github.com/supabase-community/openclaw-supabase)** — Supabase integration with tools for querying Postgres, managing auth users, and interacting with Storage buckets directly from your agent.
- **[openclaw-redis-tools](https://github.com/jamesqquick/openclaw-redis-tools)** — Redis cache operations — get, set, search, and inspect keys. Supports both Redis Cloud and local instances.
- **[openclaw-sqlite-explorer](https://github.com/nicolo-ribaudo/openclaw-sqlite-explorer)** — Explore and query local SQLite databases. Schema inspection, sample data preview, and safe read-only query execution.

### CI/CD & Deployment

- **[openclaw-gh-actions](https://github.com/nektos/openclaw-gh-actions)** — Trigger, monitor, and debug GitHub Actions workflows. View run logs, re-run failed jobs, and inspect workflow configs.
- **[openclaw-vercel](https://github.com/vercel-community/openclaw-vercel)** — Manage Vercel deployments — list projects, trigger deploys, view build logs, and rollback.
- **[clawdeploy](https://github.com/rail-berkeley/clawdeploy)** — Multi-cloud deploy helper for AWS, GCP, and Azure. Generates Terraform/Pulumi configs and manages deployment state.

### Documentation & Knowledge

- **[openclaw-notion](https://github.com/makenotion/openclaw-notion)** — Read and write Notion pages/databases. Sync project docs, search knowledge bases, and create pages from agent context.
- **[openclaw-confluence](https://github.com/atlassian-labs/openclaw-confluence)** — Search and read Confluence spaces. Useful for enterprise teams with existing Confluence knowledge bases.

### Notifications & Alerts

- **[openclaw-ntfy](https://github.com/binwiederhier/openclaw-ntfy)** — Push notifications via ntfy.sh — get notified on your phone when long-running agent tasks complete. Self-hostable.
- **[openclaw-discord-notify](https://github.com/crawdaddy-ai/openclaw-discord-notify)** — Post agent status updates, summaries, and alerts to Discord channels via webhooks.

### Code Quality & Linting

- **[openclaw-eslint-runner](https://github.com/JoshuaKGoldberg/openclaw-eslint-runner)** — Run ESLint on changed files and surface fixable issues. Auto-fix mode available for safe rules.
- **[openclaw-ruff-lint](https://github.com/charliermarsh/openclaw-ruff-lint)** — Python linting via Ruff — fast lint + format checks with auto-fix for the current diff.

### Analytics & Logging

- **[openclaw-posthog](https://github.com/PostHog/openclaw-posthog)** — Query PostHog analytics — check feature flags, search events, and pull funnel/retention data into agent context.
- **[openclaw-sentry-tools](https://github.com/getsentry/openclaw-sentry-tools)** — Query Sentry for recent errors, resolve issues, and pull stack traces into context for faster debugging.

### Utility

- **[compaction-context](https://github.com/robertcuadra/compaction-context)** — Preserves recent conversation context across compaction cycles, preventing context loss during auto-compaction.
- **[openclaw-model-selector](https://github.com/bmbsystemsdir/openclaw-model-selector)** — Smart model routing with confirmation dialogs and auto-return to default model after task completion.
- **[openclaw-better-gateway](https://github.com/ThisIsJeron/openclaw-better-gateway)** — Enhanced gateway UI with auto-reconnect and status indicator.
- **[hyperspell-openclaw](https://github.com/hyperspell/hyperspell-openclaw)** — Context and memory enhancement via Hyperspell. Syncs markdown files from agent workspace memory to Hyperspell for enhanced context.
- **[openclaw-cron-scheduler](https://github.com/bmbsystemsdir/openclaw-cron-scheduler)** — Schedule recurring agent tasks with cron expressions. Persistent across restarts with SQLite-backed job storage.
- **[openclaw-i18n-helper](https://github.com/AkariGroup/openclaw-i18n-helper)** — Internationalization helper — extract translatable strings, check for missing translations, and generate locale files.

---

## Resources

- [OpenClaw Official Docs — Community Plugins](https://docs.openclaw.ai/plugins/community)
- [OpenClaw Plugin Architecture](https://github.com/openclaw/openclaw/blob/main/docs/tools/plugin.md)
- [GitHub `openclaw-plugin` Topic](https://github.com/topics/openclaw-plugin)
- [vincentkoc/awesome-openclaw](https://github.com/vincentkoc/awesome-openclaw) — Another community-curated list
- [VoltAgent/awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills) — Skills-focused list
- [SamurAIGPT/awesome-openclaw](https://github.com/SamurAIGPT/awesome-openclaw) — Broader ecosystem list

---

## Contributing

Found a plugin that should be here? Open a PR!

1. Fork this repo
2. Add the plugin to the appropriate category
3. Include: name, author, link, and a one-line description
4. Submit a PR

Please make sure the plugin:
- Is open source
- Has a working README
- Is actually usable (not just a skeleton)

---

## License

[CC0 1.0 Universal](LICENSE)
