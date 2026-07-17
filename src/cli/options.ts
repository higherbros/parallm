import { parseArgs } from "node:util";
import type { RunRequest, Target } from "../run/types.js";

export type OutputFormat = "text" | "json";

export type CliOptions = Readonly<{
  help: boolean;
  version: boolean;
  format: OutputFormat;
  request?: RunRequest;
}>;

export function parseCliOptions(
  args: readonly string[],
  defaultCwd = process.cwd(),
): CliOptions {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      target: { type: "string", short: "t", multiple: true },
      cwd: { type: "string", default: defaultCwd },
      timeout: { type: "string", default: "10m" },
      concurrency: { type: "string" },
      format: { type: "string", default: "text" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  const help = parsed.values.help ?? false;
  const version = parsed.values.version ?? false;
  const format = parseFormat(parsed.values.format ?? "text");

  if (help || version) {
    return { help, version, format };
  }

  const [command, ...promptParts] = parsed.positionals;
  if (command !== "run") {
    throw new Error("Expected the 'run' command");
  }

  const prompt = promptParts.join(" ");
  const targets = (parsed.values.target ?? []).map(parseTarget);
  const concurrency = parsed.values.concurrency
    ? parsePositiveInteger(parsed.values.concurrency, "concurrency")
    : targets.length;

  return {
    help,
    version,
    format,
    request: {
      prompt,
      targets,
      cwd: parsed.values.cwd ?? defaultCwd,
      timeoutMs: parseDuration(parsed.values.timeout ?? "10m"),
      concurrency,
    },
  };
}

function parseTarget(value: string): Target {
  const separator = value.indexOf(":");
  if (separator < 1 || separator === value.length - 1) {
    throw new Error(`Invalid target '${value}'; expected agent:model`);
  }

  const agent = value.slice(0, separator).toLowerCase();
  const model = value.slice(separator + 1);
  return { id: `${agent}:${model}`, agent, model };
}

function parseFormat(value: string): OutputFormat {
  if (value === "text" || value === "json") {
    return value;
  }
  throw new Error(`Invalid format '${value}'; expected text or json`);
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m)?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid timeout '${value}'; use values such as 500ms, 30s, or 10m`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  const duration = amount * multiplier;
  if (!Number.isSafeInteger(duration) || duration < 1) {
    throw new Error("Timeout must be a positive duration");
  }
  return duration;
}
