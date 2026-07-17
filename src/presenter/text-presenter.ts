import type { RunEvent, RunResult } from "../run/types.js";
import {
  formatRunAsMarkdown,
  renderMarkdownForTerminal,
} from "./markdown.js";

type Output = Readonly<{
  write(content: string): unknown;
  columns?: number;
}>;

type TextPresenterOptions = Readonly<{
  renderMarkdown?: boolean;
  resultOutput?: Output;
  statusOutput?: Output;
}>;

export class TextPresenter {
  readonly #renderMarkdown: boolean;
  readonly #resultOutput: Output;
  readonly #statusOutput: Output;

  constructor(options: TextPresenterOptions = {}) {
    this.#renderMarkdown = options.renderMarkdown ?? false;
    this.#resultOutput = options.resultOutput ?? process.stdout;
    this.#statusOutput = options.statusOutput ?? process.stderr;
  }

  observe(event: RunEvent): void {
    if (event.type === "attempt.started") {
      this.#statusOutput.write(`● ${event.target.id}  running\n`);
      return;
    }

    if (event.type === "attempt.completed") {
      const marker =
        event.result.status === "succeeded"
          ? "✓"
          : event.result.status === "cancelled"
            ? "○"
            : "✗";
      this.#statusOutput.write(
        `${marker} ${event.result.target.id}  ${event.result.status}  ${formatDuration(event.result.durationMs)}\n`,
      );
    }
  }

  print(result: RunResult): void {
    const markdown = formatRunAsMarkdown(result);
    this.#resultOutput.write(
      this.#renderMarkdown
        ? renderMarkdownForTerminal(markdown, this.#resultOutput.columns)
        : markdown,
    );
  }
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${durationMs}ms`
    : `${(durationMs / 1_000).toFixed(1)}s`;
}
