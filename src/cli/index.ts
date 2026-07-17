#!/usr/bin/env node

import { CodexAdapter } from "../agents/codex/codex-adapter.js";
import { TextPresenter } from "../presenter/text-presenter.js";
import { ComparisonEngine } from "../run/engine.js";
import { parseCliOptions } from "./options.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (options.request === undefined) {
    throw new Error("Missing run request");
  }

  const controller = new AbortController();
  let interruptCount = 0;
  const handleInterrupt = (): void => {
    interruptCount += 1;
    if (interruptCount === 1) {
      process.stderr.write("\nCancelling attempts…\n");
      controller.abort(new Error("Interrupted"));
    } else {
      process.exit(130);
    }
  };
  process.on("SIGINT", handleInterrupt);

  try {
    const engine = new ComparisonEngine([new CodexAdapter()]);
    const presenter = new TextPresenter();
    const result = await engine.run(
      options.request,
      options.format === "text"
        ? (event) => presenter.observe(event)
        : () => undefined,
      controller.signal,
    );

    if (options.format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      presenter.print(result);
    }

    if (result.attempts.some((attempt) => attempt.status !== "succeeded")) {
      process.exitCode = controller.signal.aborted ? 130 : 1;
    }
  } finally {
    process.off("SIGINT", handleInterrupt);
  }
}

function helpText(): string {
  return `Parallm ${VERSION}

Run the same prompt through multiple AI coding-agent targets.

Usage:
  parallm run <prompt> --target <agent:model> --target <agent:model> [options]

Options:
  -t, --target <agent:model>  Target to run; repeat at least twice
      --cwd <directory>       Working directory (default: current directory)
      --timeout <duration>    Per-target timeout, e.g. 30s or 10m (default: 10m)
      --concurrency <number>  Maximum simultaneous targets (default: target count)
      --format <text|json>    Output format (default: text)
  -h, --help                  Show help
  -v, --version               Show version

Example:
  parallm run "Review this repository" \\
    -t codex:model-a \\
    -t codex:model-b
`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`parallm: ${message}\n\n${helpText()}`);
  process.exitCode = 2;
});
