export type Target = Readonly<{
  id: string;
  agent: string;
  model: string;
}>;

export type RunRequest = Readonly<{
  prompt: string;
  targets: readonly Target[];
  cwd: string;
  timeoutMs: number;
  concurrency: number;
}>;

export type AttemptStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export type AttemptResult = Readonly<{
  target: Target;
  status: AttemptStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: string;
}>;

export type RunResult = Readonly<{
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempts: readonly AttemptResult[];
}>;

export type RunEvent =
  | Readonly<{
      type: "attempt.started";
      target: Target;
      at: string;
    }>
  | Readonly<{
      type: "attempt.output";
      target: Target;
      stream: "stdout" | "stderr";
      chunk: string;
    }>
  | Readonly<{
      type: "attempt.completed";
      result: AttemptResult;
    }>;

export type AgentExecutionRequest = Readonly<{
  target: Target;
  prompt: string;
  cwd: string;
}>;

export type AgentExecutionResult = Readonly<{
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}>;

export type AgentEvent = Readonly<{
  stream: "stdout" | "stderr";
  chunk: string;
}>;
