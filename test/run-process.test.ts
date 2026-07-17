import assert from "node:assert/strict";
import { test } from "vitest";
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
