import { useEffect, useState } from "react";
import { Box, Text, render, type Instance } from "ink";
import type {
  AttemptStatus,
  RunEvent,
  Target,
} from "../run/types.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export type DashboardStatus = "pending" | "running" | AttemptStatus;

export type DashboardRow = Readonly<{
  target: Target;
  status: DashboardStatus;
  startedAtMs: number | null;
  durationMs: number | null;
}>;

type DashboardProps = Readonly<{
  rows: readonly DashboardRow[];
  nowMs: number;
  spinnerFrame: string;
}>;

export class InkPresenter {
  #rows: readonly DashboardRow[];
  #instance: Instance;
  #stopped = false;

  constructor(targets: readonly Target[], output: NodeJS.WriteStream = process.stderr) {
    this.#rows = createDashboardRows(targets);
    this.#instance = render(<AnimatedDashboard rows={this.#rows} />, {
      stdout: output,
      stderr: output,
      stdin: process.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
      maxFps: 20,
      incrementalRendering: true,
    });
  }

  observe(event: RunEvent): void {
    this.#rows = applyRunEvent(this.#rows, event);
    this.#instance.rerender(<AnimatedDashboard rows={this.#rows} />);
  }

  async stop(): Promise<void> {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;

    this.#instance.rerender(<AnimatedDashboard rows={this.#rows} />);
    await this.#instance.waitUntilRenderFlush();
    this.#instance.unmount();
    await this.#instance.waitUntilExit();
  }
}

export function supportsInteractiveDashboard(
  isTTY = process.stderr.isTTY === true,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const ci = environment.CI;
  const isCI = ci !== undefined && ci !== "false" && ci !== "0";
  return isTTY && !isCI && environment.TERM !== "dumb";
}

export function createDashboardRows(
  targets: readonly Target[],
): readonly DashboardRow[] {
  return targets.map((target) => ({
    target,
    status: "pending",
    startedAtMs: null,
    durationMs: null,
  }));
}

export function applyRunEvent(
  rows: readonly DashboardRow[],
  event: RunEvent,
): readonly DashboardRow[] {
  if (event.type === "attempt.output") {
    return rows;
  }

  const targetId =
    event.type === "attempt.started"
      ? event.target.id
      : event.result.target.id;

  return rows.map((row) => {
    if (row.target.id !== targetId) {
      return row;
    }

    if (event.type === "attempt.started") {
      return {
        ...row,
        status: "running",
        startedAtMs: Date.parse(event.at),
      };
    }

    return {
      ...row,
      status: event.result.status,
      durationMs: event.result.durationMs,
    };
  });
}

function AnimatedDashboard({ rows }: Readonly<{ rows: readonly DashboardRow[] }>) {
  const hasRunningTarget = rows.some((row) => row.status === "running");
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!hasRunningTarget) {
      return undefined;
    }

    const interval = setInterval(() => {
      setTick((current) => current + 1);
      setNowMs(Date.now());
    }, 80);
    return () => clearInterval(interval);
  }, [hasRunningTarget]);

  return (
    <RunDashboard
      rows={rows}
      nowMs={nowMs}
      spinnerFrame={SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? "⠋"}
    />
  );
}

export function RunDashboard({ rows, nowMs, spinnerFrame }: DashboardProps) {
  const finished = rows.every(
    (row) => row.status !== "pending" && row.status !== "running",
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="magenta">◆ </Text>
        <Text bold>Parallm</Text>
        <Text dimColor>
          {finished
            ? " · Comparison complete"
            : ` · Comparing ${rows.length} targets`}
        </Text>
      </Box>

      {rows.map((row) => (
        <DashboardRowView
          key={row.target.id}
          row={row}
          nowMs={nowMs}
          spinnerFrame={spinnerFrame}
        />
      ))}

      <Box marginTop={1}>
        {finished ? (
          <Text color="green">✓ All targets finished</Text>
        ) : (
          <Text dimColor>Ctrl+C to cancel</Text>
        )}
      </Box>
    </Box>
  );
}

function DashboardRowView({
  row,
  nowMs,
  spinnerFrame,
}: Readonly<{
  row: DashboardRow;
  nowMs: number;
  spinnerFrame: string;
}>) {
  const durationMs =
    row.status === "running" && row.startedAtMs !== null
      ? Math.max(0, nowMs - row.startedAtMs)
      : row.durationMs;

  return (
    <Box>
      <Box width={3}>{renderStatusGlyph(row.status, spinnerFrame)}</Box>
      <Box width={32}>
        <Text bold={row.status === "running"} wrap="truncate-middle">
          {row.target.id}
        </Text>
      </Box>
      <Box width={14}>{renderStatusLabel(row.status)}</Box>
      <Text dimColor>{durationMs === null ? "—" : formatDuration(durationMs)}</Text>
    </Box>
  );
}

function renderStatusGlyph(status: DashboardStatus, spinnerFrame: string) {
  switch (status) {
    case "pending":
      return <Text dimColor>○</Text>;
    case "running":
      return <Text color="cyan">{spinnerFrame}</Text>;
    case "succeeded":
      return <Text color="green">✓</Text>;
    case "timed_out":
      return <Text color="yellow">◷</Text>;
    case "cancelled":
      return <Text color="yellow">■</Text>;
    case "failed":
      return <Text color="red">✗</Text>;
  }
}

function renderStatusLabel(status: DashboardStatus) {
  switch (status) {
    case "pending":
      return <Text dimColor>Pending</Text>;
    case "running":
      return <Text color="cyan">Running</Text>;
    case "succeeded":
      return <Text color="green">Completed</Text>;
    case "timed_out":
      return <Text color="yellow">Timed out</Text>;
    case "cancelled":
      return <Text color="yellow">Cancelled</Text>;
    case "failed":
      return <Text color="red">Failed</Text>;
  }
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${durationMs}ms`
    : `${(durationMs / 1_000).toFixed(1)}s`;
}
