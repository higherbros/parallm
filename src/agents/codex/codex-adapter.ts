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
          "--model",
          request.target.model,
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
