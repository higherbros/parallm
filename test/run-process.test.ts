import assert from "node:assert/strict";
import test from "node:test";
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
