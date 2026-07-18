import assert from "node:assert/strict";
import { test } from "vitest";
import { CodexAdapter } from "../src/agents/codex/codex-adapter.js";
import type {
  ProcessChunk,
  ProcessRunner,
  ProcessSpec,
} from "../src/process/run-process.js";

test("constructs a read-only ephemeral Codex invocation and sends the prompt via stdin", async () => {
  let recordedSpec: ProcessSpec | undefined;
  const runner: ProcessRunner = async (spec, emit) => {
    recordedSpec = spec;
    emit({ stream: "stdout", chunk: "answer" });
    return {
      exitCode: 0,
      signal: null,
      stdout: "answer",
      stderr: "",
    };
  };
  const events: ProcessChunk[] = [];
  const adapter = new CodexAdapter(runner, "custom-codex");

  const result = await adapter.execute(
    {
      target: {
        id: "codex:model-a",
        agent: "codex",
        model: "model-a",
      },
      prompt: "Review the repository",
      cwd: "/workspace/project",
    },
    (event) => events.push(event),
  );

  assert.deepEqual(recordedSpec, {
    command: "custom-codex",
    args: [
      "exec",
      "--model",
      "model-a",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
      "--cd",
      "/workspace/project",
      "-",
    ],
    cwd: "/workspace/project",
    input: "Review the repository",
  });
  assert.deepEqual(events, [{ stream: "stdout", chunk: "answer" }]);
  assert.equal(result.stdout, "answer");
});

test("overrides Codex reasoning effort when the target specifies it", async () => {
  let recordedSpec: ProcessSpec | undefined;
  const runner: ProcessRunner = async (spec) => {
    recordedSpec = spec;
    return {
      exitCode: 0,
      signal: null,
      stdout: "answer",
      stderr: "",
    };
  };
  const adapter = new CodexAdapter(runner, "custom-codex");

  await adapter.execute(
    {
      target: {
        id: "codex:model-a@high",
        agent: "codex",
        model: "model-a",
        effort: "high",
      },
      prompt: "Review the repository",
      cwd: "/workspace/project",
    },
    () => undefined,
  );

  assert.deepEqual(recordedSpec?.args, [
    "exec",
    "--model",
    "model-a",
    "--config",
    'model_reasoning_effort="high"',
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    "--cd",
    "/workspace/project",
    "-",
  ]);
});

test("inherits the configured Codex model for the default model alias", async () => {
  let recordedSpec: ProcessSpec | undefined;
  const runner: ProcessRunner = async (spec) => {
    recordedSpec = spec;
    return {
      exitCode: 0,
      signal: null,
      stdout: "answer",
      stderr: "",
    };
  };
  const adapter = new CodexAdapter(runner, "custom-codex");

  await adapter.execute(
    {
      target: {
        id: "codex:default@low",
        agent: "codex",
        model: "default",
        effort: "low",
      },
      prompt: "Review the repository",
      cwd: "/workspace/project",
    },
    () => undefined,
  );

  assert.deepEqual(recordedSpec?.args, [
    "exec",
    "--config",
    'model_reasoning_effort="low"',
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    "--cd",
    "/workspace/project",
    "-",
  ]);
});
