#!/usr/bin/env node

import { CodexAdapter } from "../agents/codex/codex-adapter.js";
import {
  InkPresenter,
  supportsInteractiveDashboard,
} from "../presenter/ink-presenter.js";
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

  const textPresenter = new TextPresenter({
    renderMarkdown:
      options.format === "text" && process.stdout.isTTY === true,
  });
  const inkPresenter =
    options.format !== "json" && supportsInteractiveDashboard()
      ? new InkPresenter(options.request.targets)
      : undefined;

  try {
    const engine = new ComparisonEngine([new CodexAdapter()]);
    const result = await engine.run(
      options.request,
      options.format === "json"
        ? () => undefined
        : inkPresenter
          ? (event) => inkPresenter.observe(event)
          : (event) => textPresenter.observe(event),
      controller.signal,
    );

    await inkPresenter?.stop();

    if (options.format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      textPresenter.print(result);
    }

    if (result.attempts.some((attempt) => attempt.status !== "succeeded")) {
      process.exitCode = controller.signal.aborted ? 130 : 1;
    }
  } finally {
    await inkPresenter?.stop();
    process.off("SIGINT", handleInterrupt);
  }
}

function helpText(): string {
  return `Parallm ${VERSION}

Run the same prompt through multiple AI coding-agent targets.

Usage:
  parallm run <prompt> --target <agent:model[@effort]> --target <agent:model[@effort]> [options]

Options:
  -t, --target <target>       agent:model or agent:model@effort; repeat at least twice
      --cwd <directory>       Working directory (default: current directory)
      --timeout <duration>    Per-target timeout, e.g. 30s or 10m (default: 10m)
      --concurrency <number>  Maximum simultaneous targets (default: target count)
      --format <format>       text, markdown, or json (default: text)
  -h, --help                  Show help
  -v, --version               Show version

Example:
  parallm run "Review this repository" \\
    -t codex:model-a@low \\
    -t codex:model-a@high
`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`parallm: ${message}\n\n${helpText()}`);
  process.exitCode = 2;
});
