import { definePluginEntry } from "openclaw/plugin-sdk/core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

interface PomodoroConfig {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
}

interface PomodoroSession {
  id: string;
  task: string;
  startedAt: string;
  endsAt: string;
  type: "work" | "break" | "long-break";
  completed: boolean;
}

interface PomodoroState {
  sessions: PomodoroSession[];
  completedToday: number;
  currentSession: PomodoroSession | null;
}

export default definePluginEntry({
  id: "pomodoro",
  name: "Pomodoro",
  description: "Pomodoro timer for focused coding sessions",
  register(api) {
    const config = (api.pluginConfig ?? {}) as PomodoroConfig;
    const workMinutes = config.workMinutes ?? 25;
    const breakMinutes = config.breakMinutes ?? 5;
    const longBreakMinutes = config.longBreakMinutes ?? 15;

    const stateFile = path.join(os.homedir(), ".openclaw", "pomodoro-state.json");

    async function loadState(): Promise<PomodoroState> {
      try {
        const raw = await fs.readFile(stateFile, "utf-8");
        const state: PomodoroState = JSON.parse(raw);

        // Reset daily count if it's a new day
        const today = new Date().toISOString().slice(0, 10);
        const lastSession = state.sessions[state.sessions.length - 1];
        if (lastSession && !lastSession.startedAt.startsWith(today)) {
          state.completedToday = 0;
        }

        return state;
      } catch {
        return { sessions: [], completedToday: 0, currentSession: null };
      }
    }

    async function saveState(state: PomodoroState) {
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    }

    api.registerTool(
      () => ({
        name: "pomo_start",
        description: "Start a Pomodoro work session. Specify what you'll be working on.",
        parameters: {
          type: "object" as const,
          properties: {
            task: { type: "string", description: "What you'll work on during this session" },
          },
          required: ["task"],
        },
        async execute({ task }) {
          const state = await loadState();

          // Check if session already active
          if (state.currentSession) {
            const endsAt = new Date(state.currentSession.endsAt);
            if (endsAt > new Date()) {
              const remaining = Math.ceil((endsAt.getTime() - Date.now()) / 60_000);
              return `Session already active: "${state.currentSession.task}" (${remaining} min remaining). Use pomo_stop to end it.`;
            }
          }

          const now = new Date();
          const end = new Date(now.getTime() + workMinutes * 60_000);

          const session: PomodoroSession = {
            id: Date.now().toString(36),
            task,
            startedAt: now.toISOString(),
            endsAt: end.toISOString(),
            type: "work",
            completed: false,
          };

          state.currentSession = session;
          state.sessions.push(session);
          await saveState(state);

          return [
            `Pomodoro started: "${task}"`,
            `Duration: ${workMinutes} minutes`,
            `Ends at: ${end.toLocaleTimeString()}`,
            `Session #${state.completedToday + 1} today`,
          ].join("\n");
        },
      }),
      { names: ["pomo_start"] },
    );

    api.registerTool(
      () => ({
        name: "pomo_status",
        description: "Check the status of the current Pomodoro session and daily progress.",
        parameters: { type: "object" as const, properties: {} },
        async execute() {
          const state = await loadState();

          if (!state.currentSession) {
            return `No active session. Completed ${state.completedToday} session(s) today. Use pomo_start to begin.`;
          }

          const endsAt = new Date(state.currentSession.endsAt);
          const now = new Date();

          if (endsAt <= now) {
            // Session ended
            state.currentSession.completed = true;
            state.completedToday++;
            const isLongBreak = state.completedToday % 4 === 0;
            const breakTime = isLongBreak ? longBreakMinutes : breakMinutes;
            const breakType = isLongBreak ? "long break" : "short break";
            state.currentSession = null;
            await saveState(state);

            return [
              `Session complete! "${state.sessions[state.sessions.length - 1].task}"`,
              `Completed ${state.completedToday} session(s) today.`,
              `Time for a ${breakType} (${breakTime} minutes).`,
            ].join("\n");
          }

          const remaining = Math.ceil((endsAt.getTime() - now.getTime()) / 60_000);
          return [
            `Active: "${state.currentSession.task}"`,
            `${remaining} minute(s) remaining`,
            `Ends at: ${endsAt.toLocaleTimeString()}`,
            `Sessions today: ${state.completedToday}`,
          ].join("\n");
        },
      }),
      { names: ["pomo_status"] },
    );

    api.registerTool(
      () => ({
        name: "pomo_stop",
        description: "Stop the current Pomodoro session early.",
        parameters: { type: "object" as const, properties: {} },
        async execute() {
          const state = await loadState();
          if (!state.currentSession) return "No active session.";

          const task = state.currentSession.task;
          state.currentSession = null;
          await saveState(state);

          return `Stopped session: "${task}". ${state.completedToday} completed session(s) today.`;
        },
      }),
      { names: ["pomo_stop"] },
    );

    api.registerTool(
      () => ({
        name: "pomo_history",
        description: "View Pomodoro session history for today.",
        parameters: { type: "object" as const, properties: {} },
        async execute() {
          const state = await loadState();
          const today = new Date().toISOString().slice(0, 10);
          const todaySessions = state.sessions.filter((s) => s.startedAt.startsWith(today));

          if (todaySessions.length === 0) return "No sessions today.";

          const lines = [`Today's sessions (${todaySessions.length}):\n`];
          for (const s of todaySessions) {
            const start = new Date(s.startedAt).toLocaleTimeString();
            const status = s.completed ? "completed" : "incomplete";
            lines.push(`  ${start} — ${s.task} [${status}]`);
          }
          lines.push(`\nTotal completed: ${state.completedToday}`);
          return lines.join("\n");
        },
      }),
      { names: ["pomo_history"] },
    );
  },
});
