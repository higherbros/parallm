import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { runProcess } from "../src/process/run-process.js";

test("captures stdout and stderr while streaming chunks", async () => {
  const chunks: string[] = [];
  const result = await runProcess(
    {
      command: process.execPath,
      args: [
        "-e",
        "process.stdin.on('data', d => process.stdout.write(d)); process.stdin.on('end', () => process.stderr.write('done'))",
      ],
      cwd: process.cwd(),
      input: "hello",
    },
    ({ stream, chunk }) => chunks.push(`${stream}:${chunk}`),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello");
  assert.equal(result.stderr, "done");
  assert.deepEqual(chunks, ["stdout:hello", "stderr:done"]);
});

test("returns output captured before an aborted process closes", async () => {
  const controller = new AbortController();
  const chunks: string[] = [];

  const result = await runProcess(
    {
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('partial output'); setInterval(() => {}, 1000)",
      ],
      cwd: process.cwd(),
    },
    ({ stream, chunk }) => {
      chunks.push(`${stream}:${chunk}`);
      controller.abort(new Error("stop"));
    },
    controller.signal,
  );

  assert.equal(result.exitCode, null);
  assert.ok(result.signal);
  assert.equal(result.stdout, "partial output");
  assert.equal(result.stderr, "");
  assert.deepEqual(chunks, ["stdout:partial output"]);
});

test.runIf(process.platform !== "win32")(
  "force-kills a process tree that ignores graceful termination",
  async () => {
    const controller = new AbortController();
    const descendantSource = [
      "process.on('SIGTERM', () => {});",
      "setTimeout(() => process.stdout.write('survived'), 250);",
      "setTimeout(() => process.exit(0), 750);",
    ].join("");
    const parentSource = [
      "const { spawn } = require('node:child_process');",
      "process.on('SIGTERM', () => {});",
      `spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
      "process.stdout.write('ready');",
      "setTimeout(() => process.exit(0), 750);",
    ].join("");

    const result = await runProcess(
      {
        command: process.execPath,
        args: ["-e", parentSource],
        cwd: process.cwd(),
        terminationGraceMs: 25,
      },
      ({ chunk }) => {
        if (chunk.includes("ready")) {
          controller.abort(new Error("stop"));
        }
      },
      controller.signal,
    );

    assert.equal(result.exitCode, null);
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.stdout, "ready");
  },
);

test.runIf(process.platform !== "win32")(
  "falls back to signaling the child when process-group signaling fails",
  async () => {
    const controller = new AbortController();
    const kill = vi.spyOn(process, "kill").mockImplementationOnce(() => {
      throw new Error("process group unavailable");
    });

    try {
      const result = await runProcess(
        {
          command: process.execPath,
          args: [
            "-e",
            "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)",
          ],
          cwd: process.cwd(),
          terminationGraceMs: 25,
        },
        ({ chunk }) => {
          if (chunk.includes("ready")) {
            controller.abort(new Error("stop"));
          }
        },
        controller.signal,
      );

      assert.equal(result.signal, "SIGKILL");
    } finally {
      kill.mockRestore();
    }
  },
);

test("terminates a child when the signal was already aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop"));

  const result = await runProcess(
    {
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      terminationGraceMs: 25,
    },
    () => undefined,
    controller.signal,
  );

  assert.equal(result.exitCode, null);
  assert.ok(result.signal);
});

test("rejects when the executable cannot be spawned", async () => {
  await assert.rejects(
    runProcess(
      {
        command: "parallm-command-that-does-not-exist",
        args: [],
        cwd: process.cwd(),
      },
      () => undefined,
    ),
    /ENOENT/,
  );
});

test("returns the process result when a child closes before consuming stdin", async () => {
  const result = await runProcess(
    {
      command: process.execPath,
      args: ["-e", "process.stdin.destroy(); process.exit(0)"],
      cwd: process.cwd(),
      input: "x".repeat(1_000_000),
    },
    () => undefined,
  );

  assert.equal(result.exitCode, 0);
});
