import { stripVTControlCharacters } from "node:util";
import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";
import type { AttemptResult, RunResult } from "../run/types.js";

const DIAGNOSTIC_LINE =
  /^(?:(?:\(node:\d+\)\s+)?(?:warning|error|fatal):|\d{4}-\d{2}-\d{2}T\S+\s+(?:warn|error|fatal)\b)/i;

// marked-terminal 7 renders tight-list text as a raw token when used with
// Marked 15. Making list items loose routes them through its paragraph
// renderer (which reflows text), while the text override preserves nested
// inline tokens such as code spans and links.
const terminalCompatibilityExtension: MarkedExtension = {
  walkTokens(token) {
    if (token.type === "list_item") {
      token.loose = true;
    }
  },
  renderer: {
    text(token) {
      return "tokens" in token && token.tokens
        ? this.parser.parseInline(token.tokens)
        : token.text;
    },
  },
};

export function formatRunAsMarkdown(result: RunResult): string {
  return `${result.attempts.map(formatAttemptAsMarkdown).join("\n---\n\n")}\n`;
}

export function renderMarkdownForTerminal(
  markdown: string,
  columns = process.stdout.columns ?? 80,
): string {
  const width = Math.max(40, columns);
  const extension = markedTerminal({
    width,
    reflowText: true,
    showSectionPrefix: false,
  }) as unknown as MarkedExtension;
  const parser = new Marked(extension, terminalCompatibilityExtension);
  const rendered = parser.parse(stripVTControlCharacters(markdown), {
    async: false,
    gfm: true,
  });

  return `${rendered.trimEnd()}\n`;
}

function formatAttemptAsMarkdown(attempt: AttemptResult): string {
  const output = stripVTControlCharacters(attempt.stdout).trim();
  const sections = [
    `## ${inlineCode(attempt.target.id)}`,
    `**Status:** ${attempt.status} · **Duration:** ${formatDuration(attempt.durationMs)}`,
    output.length > 0 ? output : "_No output._",
  ];

  const error = stripVTControlCharacters(attempt.error ?? "").trim();
  const standardError = stripVTControlCharacters(attempt.stderr).trim();
  if (attempt.status === "succeeded") {
    const diagnostics = extractDiagnostics(standardError);
    if (diagnostics.length > 0) {
      sections.push(
        "### Diagnostics",
        "The agent completed successfully but emitted warnings or errors:",
        fencedCode(diagnostics, "text"),
      );
    }
  }
  if (
    attempt.status !== "succeeded" &&
    error.length > 0 &&
    error !== standardError
  ) {
    sections.push("### Error", fencedCode(error, "text"));
  }
  if (attempt.status !== "succeeded" && standardError.length > 0) {
    sections.push("### Standard error", fencedCode(standardError, "text"));
  }

  return sections.join("\n\n");
}

function extractDiagnostics(standardError: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const rawLine of standardError.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      line.length > 0 &&
      DIAGNOSTIC_LINE.test(line) &&
      !seen.has(line)
    ) {
      seen.add(line);
      lines.push(line);
    }
  }

  return lines.join("\n");
}

function inlineCode(value: string): string {
  const content = value.replace(/[\r\n]+/g, " ");
  const longestRun = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${fence}${padding}${content}${padding}${fence}`;
}

function fencedCode(value: string, language: string): string {
  const longestRun = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${value}\n${fence}`;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${durationMs}ms`
    : `${(durationMs / 1_000).toFixed(1)}s`;
}
