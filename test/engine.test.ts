import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { AgentAdapter } from "../src/run/agent.js";
import { ComparisonEngine } from "../src/run/engine.js";
import type {
  AgentEvent,
  AgentExecutionRequest,
  AgentExecutionResult,
  RunRequest,
  RunEvent,
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

test.each([
  ["empty prompt", { prompt: "  " }, /Prompt cannot be empty/],
  ["one target", { targets: targets.slice(0, 1) }, /At least two targets/],
  ["zero concurrency", { concurrency: 0 }, /Concurrency must be/],
  ["fractional concurrency", { concurrency: 1.5 }, /Concurrency must be/],
  ["zero timeout", { timeoutMs: 0 }, /Timeout must be/],
  ["infinite timeout", { timeoutMs: Number.POSITIVE_INFINITY }, /Timeout must be/],
] as const)("rejects %s", async (_name, overrides, expected) => {
  const engine = new ComparisonEngine([
    new FakeAgent(async ({ target }) => success(target.model)),
  ]);

  await assert.rejects(engine.run(request(overrides)), expected);
});

test("rejects targets whose agent has no adapter", async () => {
  const engine = new ComparisonEngine([
    new FakeAgent(async ({ target }) => success(target.model)),
  ]);
  const unknownTargets: readonly Target[] = [
    targets[0]!,
    { id: "missing:model", agent: "missing", model: "model" },
  ];

  await assert.rejects(
    engine.run(request({ targets: unknownTargets })),
    /Unknown agent: missing/,
  );
});

test.each([
  [2, "Agent exited with code 2"],
  [null, "Agent exited with code unknown"],
] as const)(
  "describes an exit with code %s when stderr is empty",
  async (exitCode, expectedError) => {
    const agent = new FakeAgent(async () => ({
      exitCode,
      signal: null,
      stdout: "",
      stderr: "   ",
    }));

    const result = await new ComparisonEngine([agent]).run(request());

    assert.equal(result.attempts[0]?.status, "failed");
    assert.equal(result.attempts[0]?.error, expectedError);
  },
);

test("captures streamed output and non-Error adapter failures", async () => {
  const events: RunEvent[] = [];
  const agent = new FakeAgent(async ({ target }, _signal, emit) => {
    if (target.model === "one") {
      emit?.({ stream: "stdout", chunk: "partial out" });
      emit?.({ stream: "stderr", chunk: "partial err" });
      throw "adapter exploded";
    }
    return success(target.model);
  });

  const result = await new ComparisonEngine([agent]).run(
    request({ targets: targets.slice(0, 2) }),
    (event) => events.push(event),
  );

  assert.deepEqual(result.attempts[0], {
    target: targets[0],
    status: "failed",
    startedAt: result.attempts[0]?.startedAt,
    finishedAt: result.attempts[0]?.finishedAt,
    durationMs: result.attempts[0]?.durationMs,
    exitCode: null,
    signal: null,
    stdout: "partial out",
    stderr: "partial err",
    error: "adapter exploded",
  });
  assert.deepEqual(
    events
      .filter((event) => event.type === "attempt.output")
      .map((event) => event.stream),
    ["stdout", "stderr"],
  );
});

test("completes every target as cancelled when the run starts aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const execute = async ({ target }: AgentExecutionRequest) => success(target.model);
  const agent = new FakeAgent(execute);

  const result = await new ComparisonEngine([agent]).run(
    request(),
    () => undefined,
    controller.signal,
  );

  assert.deepEqual(
    result.attempts.map((attempt) => [attempt.status, attempt.error]),
    [
      ["cancelled", "Run cancelled"],
      ["cancelled", "Run cancelled"],
      ["cancelled", "Run cancelled"],
    ],
  );
});

test("uses a non-Error cancellation reason", async () => {
  const controller = new AbortController();
  const agent = new FakeAgent(async ({ target }) => {
    if (target.model === "one") {
      controller.abort("manual stop");
    }
    return success(target.model);
  });

  const result = await new ComparisonEngine([agent]).run(
    request({ concurrency: 1 }),
    () => undefined,
    controller.signal,
  );

  assert.equal(result.attempts[0]?.error, "manual stop");
  assert.equal(result.attempts[1]?.error, "Run cancelled");
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
