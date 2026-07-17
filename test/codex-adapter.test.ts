import assert from "node:assert/strict";
import test from "node:test";
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
