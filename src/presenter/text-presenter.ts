import type { RunEvent, RunResult } from "../run/types.js";

export class TextPresenter {
  observe(event: RunEvent): void {
    if (event.type === "attempt.started") {
      process.stderr.write(`● ${event.target.id}  running\n`);
      return;
    }

    if (event.type === "attempt.completed") {
      const marker =
        event.result.status === "succeeded"
          ? "✓"
          : event.result.status === "cancelled"
            ? "○"
            : "✗";
      process.stderr.write(
        `${marker} ${event.result.target.id}  ${event.result.status}  ${formatDuration(event.result.durationMs)}\n`,
      );
    }
  }

  print(result: RunResult): void {
    for (const attempt of result.attempts) {
      const heading = `${attempt.target.id} · ${attempt.status} · ${formatDuration(attempt.durationMs)}`;
      const separator = "─".repeat(Math.max(heading.length, 48));
      const output = attempt.stdout.trim();

      process.stdout.write(`\n${heading}\n${separator}\n`);
      process.stdout.write(`${output.length > 0 ? output : "(no output)"}\n`);

      if (attempt.status !== "succeeded" && attempt.stderr.trim().length > 0) {
        process.stdout.write(`\nstderr:\n${attempt.stderr.trim()}\n`);
      }
    }
  }
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${durationMs}ms`
    : `${(durationMs / 1_000).toFixed(1)}s`;
}
