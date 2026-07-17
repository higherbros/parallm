import type {
  AgentEvent,
  AgentExecutionRequest,
  AgentExecutionResult,
} from "./types.js";

export interface AgentAdapter {
  readonly id: string;

  execute(
    request: AgentExecutionRequest,
    emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<AgentExecutionResult>;
}
