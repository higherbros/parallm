import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { CliOptions } from "../src/cli/options.js";
import type { RunEvent, RunResult } from "../src/run/types.js";

const mocks = vi.hoisted(() => ({
  parseCliOptions: vi.fn(),
  engineConstructor: vi.fn(),
  engineRun: vi.fn(),
  adapterConstructor: vi.fn(),
  supportsInteractiveDashboard: vi.fn(),
  inkConstructor: vi.fn(),
  inkObserve: vi.fn(),
  inkStop: vi.fn(),
  textConstructor: vi.fn(),
  textObserve: vi.fn(),
  textPrint: vi.fn(),
}));

vi.mock("../src/cli/options.js", () => ({
  parseCliOptions: mocks.parseCliOptions,
}));

vi.mock("../src/agents/codex/codex-adapter.js", () => ({
  CodexAdapter: class {
    constructor() {
      mocks.adapterConstructor();
    }
  },
}));

vi.mock("../src/run/engine.js", () => ({
  ComparisonEngine: class {
    constructor(agents: unknown) {
      mocks.engineConstructor(agents);
    }

    run(...args: unknown[]) {
      return mocks.engineRun(...args);
    }
  },
}));

vi.mock("../src/presenter/ink-presenter.js", () => ({
  supportsInteractiveDashboard: mocks.supportsInteractiveDashboard,
  InkPresenter: class {
    constructor(targets: unknown) {
      mocks.inkConstructor(targets);
    }

    observe(event: unknown) {
      mocks.inkObserve(event);
    }

    stop() {
      return mocks.inkStop();
    }
  },
}));

vi.mock("../src/presenter/text-presenter.js", () => ({
  TextPresenter: class {
    constructor(options: unknown) {
      mocks.textConstructor(options);
    }

    observe(event: unknown) {
      mocks.textObserve(event);
    }

    print(result: unknown) {
      mocks.textPrint(result);
    }
  },
}));

import { helpText, main, runCli } from "../src/cli/index.js";

const packageVersion = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(
  process.stdout,
  "isTTY",
);

const targets = [
  { id: "codex:one", agent: "codex", model: "one" },
  { id: "codex:two", agent: "codex", model: "two" },
] as const;

const successfulResult: RunResult = {
  startedAt: new Date(0).toISOString(),
  finishedAt: new Date(10).toISOString(),
  durationMs: 10,
  attempts: targets.map((target) => ({
    target,
    status: "succeeded" as const,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(10).toISOString(),
    durationMs: 10,
    exitCode: 0,
    signal: null,
    stdout: "ok",
    stderr: "",
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  mocks.supportsInteractiveDashboard.mockReturnValue(false);
  mocks.inkStop.mockResolvedValue(undefined);
  mocks.engineRun.mockResolvedValue(successfulResult);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  if (originalStdoutIsTTY === undefined) {
    delete (process.stdout as { isTTY?: boolean }).isTTY;
  } else {
    Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
  }
});

test("prints help without constructing the execution stack", async () => {
  mocks.parseCliOptions.mockReturnValue({
    help: true,
    version: false,
    format: "text",
  } satisfies CliOptions);
  const write = mockStdout();

  await main();

  assert.match(String(write.mock.calls[0]?.[0]), /Usage:/);
  assert.equal(mocks.engineConstructor.mock.calls.length, 0);
});

test("prints the version", async () => {
  mocks.parseCliOptions.mockReturnValue({
    help: false,
    version: true,
    format: "text",
  } satisfies CliOptions);
  const write = mockStdout();

  await main(["--version"]);

  assert.deepEqual(write.mock.calls, [[`${packageVersion}\n`]]);
});

test("rejects an option result without a run request", async () => {
  mocks.parseCliOptions.mockReturnValue({
    help: false,
    version: false,
    format: "text",
  } satisfies CliOptions);

  await assert.rejects(main([]), /Missing run request/);
});

test("prints successful JSON results without creating a dashboard", async () => {
  mocks.parseCliOptions.mockReturnValue(runOptions("json"));
  const write = mockStdout();
  mocks.engineRun.mockImplementation(
    async (_request: unknown, observe: (event: RunEvent) => void) => {
      observe({
        type: "attempt.output",
        target: targets[0],
        stream: "stdout",
        chunk: "ignored",
      });
      return successfulResult;
    },
  );

  await main(["run"]);

  assert.equal(mocks.supportsInteractiveDashboard.mock.calls.length, 0);
  assert.equal(mocks.inkConstructor.mock.calls.length, 0);
  assert.equal(mocks.textPrint.mock.calls.length, 0);
  assert.deepEqual(JSON.parse(String(write.mock.calls[0]?.[0])), successfulResult);
});

test("routes non-interactive events and output through the text presenter", async () => {
  mocks.parseCliOptions.mockReturnValue(runOptions("markdown"));
  mocks.engineRun.mockImplementation(
    async (_request: unknown, observe: (event: RunEvent) => void) => {
      const event: RunEvent = {
        type: "attempt.started",
        target: targets[0],
        at: new Date(0).toISOString(),
      };
      observe(event);
      return successfulResult;
    },
  );

  await main(["run"]);

  assert.equal(mocks.textObserve.mock.calls.length, 1);
  assert.deepEqual(mocks.textPrint.mock.calls, [[successfulResult]]);
});

test("routes interactive events through Ink and stops it before printing", async () => {
  mocks.parseCliOptions.mockReturnValue(runOptions("text"));
  mocks.supportsInteractiveDashboard.mockReturnValue(true);
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  mocks.engineRun.mockImplementation(
    async (_request: unknown, observe: (event: RunEvent) => void) => {
      observe({
        type: "attempt.started",
        target: targets[0],
        at: new Date(0).toISOString(),
      });
      return successfulResult;
    },
  );

  await main(["run"]);

  assert.equal(mocks.inkObserve.mock.calls.length, 1);
  assert.equal(mocks.inkStop.mock.calls.length, 2);
  assert.deepEqual(mocks.textPrint.mock.calls, [[successfulResult]]);
  assert.deepEqual(mocks.textConstructor.mock.calls, [
    [{ renderMarkdown: true }],
  ]);
});

test("sets a failure exit code when any attempt fails", async () => {
  mocks.parseCliOptions.mockReturnValue(runOptions("json"));
  mocks.engineRun.mockResolvedValue({
    ...successfulResult,
    attempts: [{ ...successfulResult.attempts[0]!, status: "failed" }],
  });
  mockStdout();

  await main(["run"]);

  assert.equal(process.exitCode, 1);
});

test("handles repeated interrupts and reports cancellation", async () => {
  mocks.parseCliOptions.mockReturnValue(runOptions("json"));
  let interrupt: (() => void) | undefined;
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGINT") {
      interrupt = listener as () => void;
    }
    return process;
  });
  vi.spyOn(process, "off").mockReturnValue(process);
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as never);
  const stderr = mockStderr();
  mockStdout();
  mocks.engineRun.mockImplementation(async () => {
    interrupt?.();
    interrupt?.();
    return {
      ...successfulResult,
      attempts: [{ ...successfulResult.attempts[0]!, status: "cancelled" }],
    };
  });

  await main(["run"]);

  assert.equal(process.exitCode, 130);
  assert.deepEqual(exit.mock.calls, [[130]]);
  assert.match(String(stderr.mock.calls[0]?.[0]), /Cancelling attempts/);
});

test.each([
  [new Error("broken"), "broken"],
  ["string failure", "string failure"],
])("reports fatal errors and prints usage", async (error, message) => {
  mocks.parseCliOptions.mockImplementation(() => {
    throw error;
  });
  const stderr = mockStderr();

  await runCli(["bad"]);

  assert.equal(process.exitCode, 2);
  assert.match(String(stderr.mock.calls[0]?.[0]), new RegExp(`parallm: ${message}`));
  assert.match(String(stderr.mock.calls[0]?.[0]), /Usage:/);
});

test("documents supported targets, options, and an example", () => {
  const help = helpText();

  assert.match(help, /agent:model\[@effort\]/);
  assert.match(help, /--concurrency/);
  assert.match(help, /codex:model-a@high/);
});

test("bin entry point runs the CLI automatically", async () => {
  mocks.parseCliOptions.mockReturnValue({
    help: true,
    version: false,
    format: "text",
  } satisfies CliOptions);
  const stdout = mockStdout();
  vi.resetModules();

  await import("../src/cli/bin.js");
  await vi.waitFor(() => {
    assert.ok(stdout.mock.calls.length > 0);
  });
});

function runOptions(format: "text" | "markdown" | "json"): CliOptions {
  return {
    help: false,
    version: false,
    format,
    request: {
      prompt: "compare",
      targets,
      cwd: "/project",
      timeoutMs: 1_000,
      concurrency: 2,
    },
  };
}

function mockStdout() {
  return vi
    .spyOn(process.stdout, "write")
    .mockImplementation((() => true) as typeof process.stdout.write);
}

function mockStderr() {
  return vi
    .spyOn(process.stderr, "write")
    .mockImplementation((() => true) as typeof process.stderr.write);
}
