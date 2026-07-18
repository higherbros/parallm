import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { test } from "vitest";
import {
  formatRunAsMarkdown,
  renderMarkdownForTerminal,
} from "../src/presenter/markdown.js";
import { TextPresenter } from "../src/presenter/text-presenter.js";
import type { RunResult } from "../src/run/types.js";

const runResult: RunResult = {
  startedAt: new Date(0).toISOString(),
  finishedAt: new Date(2_000).toISOString(),
  durationMs: 2_000,
  attempts: [
    {
      target: { id: "codex:model-a", agent: "codex", model: "model-a" },
      status: "succeeded",
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1_250).toISOString(),
      durationMs: 1_250,
      exitCode: 0,
      signal: null,
      stdout:
        "\u001B[31m# Finding\u001B[0m\n\nUse **strict mode**.\n\n```ts\nconst answer = 42;\n```",
      stderr: "",
    },
    {
      target: { id: "codex:model-b", agent: "codex", model: "model-b" },
      status: "failed",
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(800).toISOString(),
      durationMs: 800,
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "failure containing ``` inside it",
      error: "failed",
    },
  ],
};

test("formats comparison results as valid raw Markdown", () => {
  const markdown = formatRunAsMarkdown(runResult);

  assert.match(markdown, /^## `codex:model-a`/);
  assert.match(markdown, /\*\*Status:\*\* succeeded/);
  assert.match(markdown, /# Finding/);
  assert.match(markdown, /```ts\nconst answer = 42;\n```/);
  assert.match(markdown, /---\n\n## `codex:model-b`/);
  assert.match(markdown, /````text\nfailure containing ``` inside it\n````/);
  assert.doesNotMatch(markdown, /\u001B/);
});

test("renders Markdown syntax as terminal-friendly content", () => {
  const rendered = renderMarkdownForTerminal(
    "# Heading\n\nUse **bold** and `inline code`.\n\n```ts\nconst value = 1;\n```",
    80,
  );
  const plain = stripVTControlCharacters(rendered);

  assert.match(plain, /^Heading/m);
  assert.doesNotMatch(plain, /^# Heading/m);
  assert.match(plain, /Use bold and inline code\./);
  assert.match(plain, /const value = 1;/);
  assert.doesNotMatch(plain, /\*\*bold\*\*/);
  assert.doesNotMatch(plain, /```ts/);
});

test("renders and wraps inline Markdown inside tight list items", () => {
  const rendered = renderMarkdownForTerminal(
    [
      "## `codex:gpt-5.5`",
      "",
      "* Exposes `getMarketRates()` for the `marketRates` GraphQL query and reads [repository.ts](/tmp/repository.ts:20) with a deliberately long explanation that must wrap cleanly.",
      "* Second item.",
    ].join("\n"),
    60,
  );
  const plain = stripVTControlCharacters(rendered);
  const lines = plain.split("\n");
  const firstItem = lines.findIndex((line) => line.includes("Exposes"));
  const secondItem = lines.findIndex((line) => line.includes("Second item"));

  assert.doesNotMatch(plain, /^## /m);
  assert.doesNotMatch(plain, /`(?:getMarketRates\(\)|marketRates)`/);
  assert.doesNotMatch(plain, /\[repository\.ts\]\(/);
  assert.ok(firstItem >= 0);
  assert.ok(secondItem > firstItem + 1, "the first list item should wrap");
  assert.ok(
    lines
      .slice(firstItem + 1, secondItem)
      .filter(Boolean)
      .every((line) => /^\s{4,}\S/.test(line)),
    "wrapped list lines should remain indented",
  );
});

test("text presenter emits raw Markdown when terminal rendering is disabled", () => {
  let output = "";
  const presenter = new TextPresenter({
    renderMarkdown: false,
    resultOutput: {
      write(content) {
        output += content;
      },
    },
  });

  presenter.print(runResult);

  assert.equal(output, formatRunAsMarkdown(runResult));
});

test("text presenter renders Markdown when terminal rendering is enabled", () => {
  let output = "";
  const presenter = new TextPresenter({
    renderMarkdown: true,
    resultOutput: {
      columns: 80,
      write(content) {
        output += content;
      },
    },
  });

  presenter.print(runResult);
  const plain = stripVTControlCharacters(output);

  assert.match(plain, /^Finding/m);
  assert.doesNotMatch(plain, /^# Finding/m);
  assert.match(plain, /Status: succeeded/);
  assert.doesNotMatch(plain, /\*\*Status:\*\*/);
});

test("formats empty output and target identifiers containing code fences", () => {
  const markdown = formatRunAsMarkdown({
    ...runResult,
    attempts: [
      {
        ...runResult.attempts[0]!,
        target: {
          id: "`codex:model`\nvariant",
          agent: "codex",
          model: "model",
        },
        durationMs: 12,
        stdout: "",
      },
    ],
  });

  assert.match(markdown, /^## `` `codex:model` variant ``/);
  assert.match(markdown, /Duration:\*\* 12ms/);
  assert.match(markdown, /_No output\._/);
  assert.doesNotMatch(markdown, /Standard error/);
});

test("renders attempt errors when a failed process has no stderr", () => {
  const markdown = formatRunAsMarkdown({
    ...runResult,
    attempts: [
      {
        ...runResult.attempts[1]!,
        stderr: "",
        error: "spawn codex ENOENT",
      },
    ],
  });

  assert.match(markdown, /### Error/);
  assert.match(markdown, /```text\nspawn codex ENOENT\n```/);
});

test("does not duplicate an attempt error already shown as stderr", () => {
  const markdown = formatRunAsMarkdown({
    ...runResult,
    attempts: [
      {
        ...runResult.attempts[1]!,
        stderr: "agent failed",
        error: "agent failed",
      },
    ],
  });

  assert.doesNotMatch(markdown, /### Error/);
  assert.match(markdown, /### Standard error/);
  assert.equal(markdown.match(/agent failed/g)?.length, 1);
});

test("surfaces warnings and errors emitted by a successful attempt", () => {
  const markdown = formatRunAsMarkdown({
    ...runResult,
    attempts: [
      {
        ...runResult.attempts[0]!,
        stderr: [
          "OpenAI Codex v0.144.5",
          "hook: SessionStart Completed",
          "warning: Model metadata was unavailable",
          "ERROR: MCP authentication failed",
          "ERROR: MCP authentication failed",
          "tokens used",
          "42",
        ].join("\n"),
      },
    ],
  });

  assert.match(markdown, /### Diagnostics/);
  assert.match(markdown, /warning: Model metadata was unavailable/);
  assert.match(markdown, /ERROR: MCP authentication failed/);
  assert.equal(markdown.match(/MCP authentication failed/g)?.length, 1);
  assert.doesNotMatch(markdown, /OpenAI Codex/);
  assert.doesNotMatch(markdown, /SessionStart/);
  assert.doesNotMatch(markdown, /tokens used/);
});

test("keeps routine successful stderr out of comparison output", () => {
  const markdown = formatRunAsMarkdown({
    ...runResult,
    attempts: [
      {
        ...runResult.attempts[0]!,
        stderr: "OpenAI Codex v0.144.5\nhook: Stop Completed\ntokens used\n42",
      },
    ],
  });

  assert.doesNotMatch(markdown, /### Diagnostics/);
  assert.doesNotMatch(markdown, /OpenAI Codex/);
});

test("does not mistake echoed prompt or response text for diagnostics", () => {
  const markdown = formatRunAsMarkdown({
    ...runResult,
    attempts: [
      {
        ...runResult.attempts[0]!,
        stderr: [
          "user",
          "Find the most serious error in this code.",
          "codex",
          "No error was found.",
        ].join("\n"),
      },
    ],
  });

  assert.doesNotMatch(markdown, /### Diagnostics/);
  assert.doesNotMatch(markdown, /serious error/);
});

test("uses a minimum terminal width and handles plain inline text", () => {
  const rendered = renderMarkdownForTerminal("A plain paragraph.", 10);

  assert.match(stripVTControlCharacters(rendered), /A plain paragraph\./);
});

test("text presenter reports lifecycle events with status-specific markers", () => {
  let status = "";
  const presenter = new TextPresenter({
    statusOutput: {
      write(content) {
        status += content;
      },
    },
  });

  presenter.observe({
    type: "attempt.started",
    target: runResult.attempts[0]!.target,
    at: new Date(0).toISOString(),
  });
  presenter.observe({
    type: "attempt.output",
    target: runResult.attempts[0]!.target,
    stream: "stdout",
    chunk: "ignored",
  });
  presenter.observe({
    type: "attempt.completed",
    result: { ...runResult.attempts[0]!, durationMs: 1_250 },
  });
  presenter.observe({
    type: "attempt.completed",
    result: {
      ...runResult.attempts[0]!,
      status: "cancelled",
      durationMs: 20,
    },
  });
  presenter.observe({
    type: "attempt.completed",
    result: { ...runResult.attempts[1]!, durationMs: 800 },
  });

  assert.match(status, /● codex:model-a  running/);
  assert.match(status, /✓ codex:model-a  succeeded  1\.3s/);
  assert.match(status, /○ codex:model-a  cancelled  20ms/);
  assert.match(status, /✗ codex:model-b  failed  800ms/);
  assert.doesNotMatch(status, /ignored/);
});

test("text presenter supports its default outputs", () => {
  assert.ok(new TextPresenter());
});
