import assert from "node:assert/strict";
import test from "node:test";
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
    ) => Promise<AgentExecutionResult>,
  ) {}

  execute(
    executionRequest: AgentExecutionRequest,
    _emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<AgentExecutionResult> {
    return this.behavior(executionRequest, signal);
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
  const twoTargets = targets.slice(0, 2);
  const agent = new FakeAgent(async ({ target }, signal) => {
    if (target.model === "one") {
      await waitUntilAborted(signal);
    }
    return success(target.model);
  });

  const result = await new ComparisonEngine([agent]).run(
    request({ targets: twoTargets, timeoutMs: 25, concurrency: 2 }),
  );

  assert.deepEqual(
    result.attempts.map((attempt) => attempt.status),
    ["timed_out", "succeeded"],
  );
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
