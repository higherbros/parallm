import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "vitest";
import { renderToString } from "ink";
import {
  applyRunEvent,
  createDashboardRows,
  InkPresenter,
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
  assert.equal(supportsInteractiveDashboard(true, { CI: "0" }), true);
});

test("renders timed-out and cancelled targets with clamped running durations", () => {
  const statusTargets: readonly Target[] = [
    { id: "codex:running", agent: "codex", model: "running" },
    { id: "codex:timeout", agent: "codex", model: "timeout" },
    { id: "codex:cancelled", agent: "codex", model: "cancelled" },
  ];
  const output = renderToString(
    <RunDashboard
      rows={[
        {
          target: statusTargets[0]!,
          status: "running",
          startedAtMs: 3_000,
          durationMs: null,
        },
        {
          target: statusTargets[1]!,
          status: "timed_out",
          startedAtMs: 0,
          durationMs: 1_500,
        },
        {
          target: statusTargets[2]!,
          status: "cancelled",
          startedAtMs: 0,
          durationMs: 20,
        },
      ]}
      nowMs={2_500}
      spinnerFrame="⠋"
    />,
    { columns: 80 },
  );

  assert.match(output, /⠋  codex:running\s+Running\s+0ms/);
  assert.match(output, /◷  codex:timeout\s+Timed out\s+1\.5s/);
  assert.match(output, /■  codex:cancelled\s+Cancelled\s+20ms/);
});

test("updates only the completed target row", () => {
  const rows = createDashboardRows(targets);
  const updated = applyRunEvent(rows, {
    type: "attempt.completed",
    result: resultFor(targets[1]!, "failed", 400),
  });

  assert.strictEqual(updated[0], rows[0]);
  assert.deepEqual(updated[1], {
    ...rows[1],
    status: "failed",
    durationMs: 400,
  });
});

test("Ink presenter observes events and can be stopped repeatedly", async () => {
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.assign(output, { columns: 80, isTTY: false });
  const presenter = new InkPresenter(targets, output);

  presenter.observe({
    type: "attempt.completed",
    result: resultFor(targets[0]!, "succeeded", 100),
  });
  presenter.observe({
    type: "attempt.completed",
    result: resultFor(targets[1]!, "failed", 200),
  });
  await presenter.stop();
  await presenter.stop();

  assert.equal(output.destroyed, false);
});

test("Ink presenter animates a running target", async () => {
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.assign(output, { columns: 80, isTTY: false });
  const presenter = new InkPresenter(targets, output);

  presenter.observe({
    type: "attempt.started",
    target: targets[0]!,
    at: new Date().toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await presenter.stop();

  assert.equal(output.destroyed, false);
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
