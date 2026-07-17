import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "ink";
import {
  applyRunEvent,
  createDashboardRows,
  RunDashboard,
  supportsInteractiveDashboard,
} from "../src/presenter/ink-presenter.js";
import type { Target } from "../src/run/types.js";

const targets: readonly Target[] = [
  { id: "codex:model-a", agent: "codex", model: "model-a" },
  { id: "codex:model-b", agent: "codex", model: "model-b" },
];

test("renders pending and running targets in the live dashboard", () => {
  const pendingRows = createDashboardRows(targets);
  const rows = applyRunEvent(pendingRows, {
    type: "attempt.started",
    target: targets[0]!,
    at: new Date(1_000).toISOString(),
  });

  const output = renderToString(
    <RunDashboard rows={rows} nowMs={2_500} spinnerFrame="⠹" />,
    { columns: 80 },
  );

  assert.match(output, /◆ Parallm · Comparing 2 targets/);
  assert.match(output, /⠹  codex:model-a\s+Running\s+1\.5s/);
  assert.match(output, /○  codex:model-b\s+Pending\s+—/);
  assert.match(output, /Ctrl\+C to cancel/);
});

test("renders terminal states and the completion footer", () => {
  let rows = createDashboardRows(targets);
  rows = applyRunEvent(rows, {
    type: "attempt.completed",
    result: resultFor(targets[0]!, "succeeded", 1_230),
  });
  rows = applyRunEvent(rows, {
    type: "attempt.completed",
    result: resultFor(targets[1]!, "failed", 840),
  });

  const output = renderToString(
    <RunDashboard rows={rows} nowMs={2_500} spinnerFrame="⠹" />,
    { columns: 80 },
  );

  assert.match(output, /Comparison complete/);
  assert.match(output, /✓  codex:model-a\s+Completed\s+1\.2s/);
  assert.match(output, /✗  codex:model-b\s+Failed\s+840ms/);
  assert.match(output, /✓ All targets finished/);
});

test("ignores output events because raw agent text is rendered after completion", () => {
  const rows = createDashboardRows(targets);
  const updated = applyRunEvent(rows, {
    type: "attempt.output",
    target: targets[0]!,
    stream: "stdout",
    chunk: "partial response",
  });

  assert.strictEqual(updated, rows);
});

test("uses Ink only for interactive terminals", () => {
  assert.equal(supportsInteractiveDashboard(true, {}), true);
  assert.equal(supportsInteractiveDashboard(false, {}), false);
  assert.equal(supportsInteractiveDashboard(true, { CI: "true" }), false);
  assert.equal(supportsInteractiveDashboard(true, { TERM: "dumb" }), false);
  assert.equal(supportsInteractiveDashboard(true, { CI: "false" }), true);
});

function resultFor(
  target: Target,
  status: "succeeded" | "failed",
  durationMs: number,
) {
  return {
    target,
    status,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(durationMs).toISOString(),
    durationMs,
    exitCode: status === "succeeded" ? 0 : 1,
    signal: null,
    stdout: "",
    stderr: "",
  } as const;
}
