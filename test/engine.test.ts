import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { AgentAdapter } from "../src/run/agent.js";
import { ComparisonEngine } from "../src/run/engine.js";
import type {
  AgentEvent,
  AgentExecutionRequest,
  AgentExecutionResult,
  RunRequest,
  Target,
} from "../src/run/types.js";

const targets: readonly Target[] = [
  { id: "fake:one", agent: "fake", model: "one" },
  { id: "fake:two", agent: "fake", model: "two" },
  { id: "fake:three", agent: "fake", model: "three" },
];

afterEach(() => {
  vi.useRealTimers();
});

function request(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    prompt: "compare this",
    targets,
    cwd: process.cwd(),
    timeoutMs: 1_000,
    concurrency: 3,
    ...overrides,
  };
}

class FakeAgent implements AgentAdapter {
  readonly id = "fake";

  constructor(
    private readonly behavior: (
      request: AgentExecutionRequest,
      signal?: AbortSignal,
      emit?: (event: AgentEvent) => void,
    ) => Promise<AgentExecutionResult>,
  ) {}

  execute(
    executionRequest: AgentExecutionRequest,
    _emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<AgentExecutionResult> {
    return this.behavior(executionRequest, signal, _emit);
  }
}

test("runs attempts concurrently up to the configured limit", async () => {
  let active = 0;
  let maximumActive = 0;
  const agent = new FakeAgent(async ({ target }) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return success(target.model);
  });

  const result = await new ComparisonEngine([agent]).run(
    request({ concurrency: 2 }),
  );

  assert.equal(maximumActive, 2);
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.status),
    ["succeeded", "succeeded", "succeeded"],
  );
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.stdout),
    ["one", "two", "three"],
  );
});

test("preserves other results when one target fails", async () => {
  const agent = new FakeAgent(async ({ target }) =>
    target.model === "two"
      ? {
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "model failed",
        }
      : success(target.model),
  );

  const result = await new ComparisonEngine([agent]).run(request());

  assert.deepEqual(
    result.attempts.map((attempt) => attempt.status),
    ["succeeded", "failed", "succeeded"],
  );
  assert.equal(result.attempts[1]?.error, "model failed");
});

test("times out a slow target without cancelling a successful target", async () => {
  vi.useFakeTimers();
  const twoTargets = targets.slice(0, 2);
  const agent = new FakeAgent(async ({ target }, signal, emit) => {
    if (target.model === "one") {
      emit?.({ stream: "stdout", chunk: "partial" });
      await waitUntilAborted(signal);
    }
    return success(target.model);
  });

  const run = new ComparisonEngine([agent]).run(
    request({ targets: twoTargets, timeoutMs: 25, concurrency: 2 }),
  );
  await vi.advanceTimersByTimeAsync(25);
  const result = await run;

  assert.deepEqual(
    result.attempts.map((attempt) => attempt.status),
    ["timed_out", "succeeded"],
  );
  assert.equal(result.attempts[0]?.stdout, "partial");
});

test("preserves process metadata when a timed-out adapter closes normally", async () => {
  vi.useFakeTimers();
  const twoTargets = targets.slice(0, 2);
  const agent = new FakeAgent(async ({ target }, signal) => {
    if (target.model === "one") {
      await waitForAbort(signal);
      return {
        exitCode: null,
        signal: "SIGTERM",
        stdout: "partial stdout",
        stderr: "partial stderr",
      };
    }
    return success(target.model);
  });

  const run = new ComparisonEngine([agent]).run(
    request({ targets: twoTargets, timeoutMs: 25, concurrency: 2 }),
  );
  await vi.advanceTimersByTimeAsync(25);
  const result = await run;

  assert.deepEqual(result.attempts[0], {
    target: twoTargets[0],
    status: "timed_out",
    startedAt: result.attempts[0]?.startedAt,
    finishedAt: result.attempts[0]?.finishedAt,
    durationMs: result.attempts[0]?.durationMs,
    exitCode: null,
    signal: "SIGTERM",
    stdout: "partial stdout",
    stderr: "partial stderr",
    error: "Attempt timed out",
  });
});

test("preserves process output when a run is cancelled", async () => {
  const controller = new AbortController();
  const twoTargets = targets.slice(0, 2);
  const agent = new FakeAgent(async ({ target }, signal) => {
    if (target.model === "one") {
      controller.abort(new Error("Interrupted"));
      await waitForAbort(signal);
      return {
        exitCode: null,
        signal: "SIGTERM",
        stdout: "partial stdout",
        stderr: "",
      };
    }
    return success(target.model);
  });

  const result = await new ComparisonEngine([agent]).run(
    request({ targets: twoTargets, concurrency: 1 }),
    () => undefined,
    controller.signal,
  );

  assert.equal(result.attempts[0]?.status, "cancelled");
  assert.equal(result.attempts[0]?.signal, "SIGTERM");
  assert.equal(result.attempts[0]?.stdout, "partial stdout");
  assert.equal(result.attempts[0]?.error, "Interrupted");
  assert.equal(result.attempts[1]?.status, "cancelled");
});

test("rejects duplicate targets before starting any attempt", async () => {
  const agent = new FakeAgent(async ({ target }) => success(target.model));
  const engine = new ComparisonEngine([agent]);

  await assert.rejects(
    engine.run(request({ targets: [targets[0]!, targets[0]!] })),
    /Duplicate target/,
  );
});

function success(stdout: string): AgentExecutionResult {
  return { exitCode: 0, signal: null, stdout, stderr: "" };
}

async function waitUntilAborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}
