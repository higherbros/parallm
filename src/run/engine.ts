import type { AgentAdapter } from "./agent.js";
import type {
  AttemptResult,
  RunEvent,
  RunRequest,
  RunResult,
  Target,
} from "./types.js";

export type RunObserver = (event: RunEvent) => void;

export class ComparisonEngine {
  readonly #agents: ReadonlyMap<string, AgentAdapter>;

  constructor(agents: Iterable<AgentAdapter>) {
    this.#agents = new Map(Array.from(agents, (agent) => [agent.id, agent]));
  }

  async run(
    request: RunRequest,
    observe: RunObserver = () => undefined,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    this.#validate(request);

    const startedAtMs = Date.now();
    const results = new Array<AttemptResult>(request.targets.length);
    let nextTargetIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextTargetIndex < request.targets.length) {
        const targetIndex = nextTargetIndex;
        nextTargetIndex += 1;
        const target = request.targets[targetIndex];

        if (target === undefined) {
          return;
        }

        results[targetIndex] = await this.#runAttempt(
          request,
          target,
          observe,
          signal,
        );
      }
    };

    const workerCount = Math.min(request.concurrency, request.targets.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    const finishedAtMs = Date.now();
    return {
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      attempts: results,
    };
  }

  async #runAttempt(
    request: RunRequest,
    target: Target,
    observe: RunObserver,
    parentSignal?: AbortSignal,
  ): Promise<AttemptResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    observe({ type: "attempt.started", target, at: startedAt });

    if (parentSignal?.aborted) {
      return this.#completeCancelled(target, startedAtMs, observe);
    }

    const agent = this.#agents.get(target.agent);
    if (agent === undefined) {
      throw new Error(`Unknown agent: ${target.agent}`);
    }

    const attemptController = new AbortController();
    let timedOut = false;
    const stdout: string[] = [];
    const stderr: string[] = [];

    const cancelFromParent = (): void => {
      attemptController.abort(parentSignal?.reason);
    };
    parentSignal?.addEventListener("abort", cancelFromParent, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      attemptController.abort(new Error("Attempt timed out"));
    }, request.timeoutMs);

    try {
      const execution = await agent.execute(
        {
          target,
          prompt: request.prompt,
          cwd: request.cwd,
        },
        (event) => {
          (event.stream === "stdout" ? stdout : stderr).push(event.chunk);
          observe({
            type: "attempt.output",
            target,
            stream: event.stream,
            chunk: event.chunk,
          });
        },
        attemptController.signal,
      );

      const finishedAtMs = Date.now();
      const status = timedOut
        ? "timed_out"
        : parentSignal?.aborted
          ? "cancelled"
          : execution.exitCode === 0
            ? "succeeded"
            : "failed";
      const result: AttemptResult = {
        target,
        status,
        startedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
        exitCode: execution.exitCode,
        signal: execution.signal,
        stdout: execution.stdout,
        stderr: execution.stderr,
        ...(status === "timed_out"
          ? { error: "Attempt timed out" }
          : status === "cancelled"
            ? { error: this.#cancellationError(parentSignal?.reason) }
            : status === "failed"
              ? { error: this.#exitError(execution.exitCode, execution.stderr) }
              : {}),
      };
      observe({ type: "attempt.completed", result });
      return result;
    } catch (error) {
      const finishedAtMs = Date.now();
      const status = timedOut
        ? "timed_out"
        : parentSignal?.aborted
          ? "cancelled"
          : "failed";
      const result: AttemptResult = {
        target,
        status,
        startedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
        exitCode: null,
        signal: null,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        error: error instanceof Error ? error.message : String(error),
      };
      observe({ type: "attempt.completed", result });
      return result;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", cancelFromParent);
    }
  }

  #completeCancelled(
    target: Target,
    startedAtMs: number,
    observe: RunObserver,
  ): AttemptResult {
    const finishedAtMs = Date.now();
    const result: AttemptResult = {
      target,
      status: "cancelled",
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: "Run cancelled",
    };
    observe({ type: "attempt.completed", result });
    return result;
  }

  #exitError(exitCode: number | null, stderr: string): string {
    const detail = stderr.trim();
    return detail.length > 0
      ? detail
      : `Agent exited with code ${exitCode ?? "unknown"}`;
  }

  #cancellationError(reason: unknown): string {
    return reason instanceof Error
      ? reason.message
      : reason === undefined
        ? "Run cancelled"
        : String(reason);
  }

  #validate(request: RunRequest): void {
    if (request.prompt.trim().length === 0) {
      throw new Error("Prompt cannot be empty");
    }
    if (request.targets.length < 2) {
      throw new Error("At least two targets are required for a comparison");
    }
    if (!Number.isInteger(request.concurrency) || request.concurrency < 1) {
      throw new Error("Concurrency must be a positive integer");
    }
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 1) {
      throw new Error("Timeout must be a positive duration");
    }

    const targetIds = new Set<string>();
    for (const target of request.targets) {
      if (targetIds.has(target.id)) {
        throw new Error(`Duplicate target: ${target.id}`);
      }
      targetIds.add(target.id);
      if (!this.#agents.has(target.agent)) {
        throw new Error(`Unknown agent: ${target.agent}`);
      }
    }
  }
}
