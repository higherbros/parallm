import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
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
