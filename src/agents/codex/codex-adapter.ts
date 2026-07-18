import { runProcess, type ProcessRunner } from "../../process/run-process.js";
import type { AgentAdapter } from "../../run/agent.js";
import type {
  AgentEvent,
  AgentExecutionRequest,
  AgentExecutionResult,
} from "../../run/types.js";

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex";

  constructor(
    private readonly processRunner: ProcessRunner = runProcess,
    private readonly executable = "codex",
  ) {}

  execute(
    request: AgentExecutionRequest,
    emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<AgentExecutionResult> {
    return this.processRunner(
      {
        command: this.executable,
        args: [
          "exec",
          ...(request.target.model === "default"
            ? []
            : ["--model", request.target.model]),
          ...(request.target.effort === undefined
            ? []
            : [
                "--config",
                `model_reasoning_effort=${JSON.stringify(request.target.effort)}`,
              ]),
          "--sandbox",
          "read-only",
          "--ephemeral",
          "--color",
          "never",
          "--cd",
          request.cwd,
          "-",
        ],
        cwd: request.cwd,
        input: request.prompt,
      },
      emit,
      signal,
    );
  }
}
