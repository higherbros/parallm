import assert from "node:assert/strict";
import { test } from "vitest";
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

test("parses reasoning effort as part of each target", () => {
  const options = parseCliOptions([
    "run",
    "prompt",
    "-t",
    "codex:model-a@low",
    "-t",
    "codex:model-a@xhigh",
  ]);

  assert.deepEqual(options.request?.targets, [
    {
      id: "codex:model-a@low",
      agent: "codex",
      model: "model-a",
      effort: "low",
    },
    {
      id: "codex:model-a@xhigh",
      agent: "codex",
      model: "model-a",
      effort: "xhigh",
    },
  ]);
});

test("rejects an unknown reasoning effort", () => {
  assert.throws(
    () =>
      parseCliOptions([
        "run",
        "prompt",
        "-t",
        "codex:model-a@extreme",
        "-t",
        "codex:model-b",
      ]),
    /Invalid reasoning effort 'extreme'/,
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

test.each([
  [["--help"], { help: true, version: false }],
  [["-v"], { help: false, version: true }],
] as const)("short-circuits informational flags", (args, expected) => {
  const options = parseCliOptions(args, "/project");

  assert.deepEqual(options, { ...expected, format: "text" });
});

test("normalizes agent names and uses target count as default concurrency", () => {
  const options = parseCliOptions(
    [
      "run",
      "prompt",
      "-t",
      "CoDeX:model-a",
      "-t",
      "CODEX:model-b",
      "--timeout",
      "42",
    ],
    "/default",
  );

  assert.deepEqual(options.request, {
    prompt: "prompt",
    targets: [
      { id: "codex:model-a", agent: "codex", model: "model-a" },
      { id: "codex:model-b", agent: "codex", model: "model-b" },
    ],
    cwd: "/default",
    timeoutMs: 42,
    concurrency: 2,
  });
});

test.each([
  ["500ms", 500],
  ["2s", 2_000],
  ["3m", 180_000],
] as const)("parses the %s timeout unit", (timeout, expectedMs) => {
  const options = parseCliOptions([
    "run",
    "prompt",
    "-t",
    "codex:one",
    "-t",
    "codex:two",
    "--timeout",
    timeout,
  ]);

  assert.equal(options.request?.timeoutMs, expectedMs);
});

test.each(["start", "", "compare"])("rejects the '%s' command", (command) => {
  assert.throws(() => parseCliOptions([command]), /Expected the 'run' command/);
});

test.each([":model", "agent:", "agent:@high"])(
  "rejects malformed target '%s'",
  (target) => {
    assert.throws(
      () =>
        parseCliOptions([
          "run",
          "prompt",
          "-t",
          target,
          "-t",
          "codex:valid",
        ]),
      /expected agent:model/,
    );
  },
);

test.each(["yaml", "JSON", ""])("rejects format '%s'", (format) => {
  assert.throws(
    () => parseCliOptions(["run", "prompt", "--format", format]),
    /Invalid format/,
  );
});

test.each(["1.5", "0", "9007199254740992"])(
  "rejects concurrency '%s'",
  (concurrency) => {
    assert.throws(
      () =>
        parseCliOptions([
          "run",
          "prompt",
          "-t",
          "codex:one",
          "-t",
          "codex:two",
          "--concurrency",
          concurrency,
        ]),
      /concurrency must be a positive integer/,
    );
  },
);

test.each(["soon", "0", "9007199254740992m"])(
  "rejects timeout '%s'",
  (timeout) => {
    assert.throws(
      () =>
        parseCliOptions([
          "run",
          "prompt",
          "-t",
          "codex:one",
          "-t",
          "codex:two",
          "--timeout",
          timeout,
        ]),
      /Invalid timeout|positive duration/,
    );
  },
);
