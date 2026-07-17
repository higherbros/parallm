import assert from "node:assert/strict";
import test from "node:test";
import { parseCliOptions } from "../src/cli/options.js";

test("parses a comparison run", () => {
  const options = parseCliOptions(
    [
      "run",
      "Review this repository",
      "-t",
      "codex:model-a",
      "-t",
      "codex:model-b",
      "--timeout",
      "30s",
      "--concurrency",
      "1",
      "--format",
      "json",
    ],
    "/project",
  );

  assert.equal(options.format, "json");
  assert.deepEqual(options.request, {
    prompt: "Review this repository",
    targets: [
      { id: "codex:model-a", agent: "codex", model: "model-a" },
      { id: "codex:model-b", agent: "codex", model: "model-b" },
    ],
    cwd: "/project",
    timeoutMs: 30_000,
    concurrency: 1,
  });
});

test("rejects malformed target names", () => {
  assert.throws(
    () =>
      parseCliOptions([
        "run",
        "prompt",
        "-t",
        "codex",
        "-t",
        "codex:model-b",
      ]),
    /expected agent:model/,
  );
});

test("accepts raw Markdown output", () => {
  const options = parseCliOptions([
    "run",
    "prompt",
    "-t",
    "codex:model-a",
    "-t",
    "codex:model-b",
    "--format",
    "markdown",
  ]);

  assert.equal(options.format, "markdown");
});
