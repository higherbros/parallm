# Parallm

Run multiple AI coding agents in parallel and compare their results from your terminal.

Parallm delegates work to coding-agent CLIs you already use. It keeps their existing authentication, configuration, repository instructions, and model access while providing one command for parallel execution and comparison.

> [!NOTE]
> Parallm is an early prototype. The first vertical slice supports multiple Codex model targets in read-only mode.

## What works today

- Run the same prompt against two or more Codex model targets concurrently.
- Watch an animated Ink dashboard with pending, running, completed, failed, and timed-out states.
- Enforce Codex's read-only sandbox and ephemeral sessions.
- Keep prompts out of shell command strings by sending them through stdin.
- Apply a per-target timeout and a global concurrency limit.
- Cancel active attempts with Ctrl+C.
- Preserve each target's stdout, stderr, exit code, duration, and status.
- Render styled Markdown in interactive terminals, raw Markdown when redirected, or stable JSON.

## Development setup

Requirements:

- Node.js 22 or newer
- pnpm
- Codex CLI, authenticated through your normal development setup

```bash
pnpm install
pnpm build
pnpm link --global
```

## Usage

Use model identifiers accepted by your local Codex installation:

```bash
parallm run "Review this repository and identify the most serious bug" \
  --target codex:model-a \
  --target codex:model-b
```

Set a timeout or limit concurrency:

```bash
parallm run "Explain the authentication flow" \
  -t codex:model-a \
  -t codex:model-b \
  --timeout 5m \
  --concurrency 2
```

Produce machine-readable output:

```bash
parallm run "Review this repository" \
  -t codex:model-a \
  -t codex:model-b \
  --format json
```

Write raw Markdown without terminal styling:

```bash
parallm run "Review this repository" \
  -t codex:model-a \
  -t codex:model-b \
  --format markdown > comparison.md
```

Run `parallm --help` for every option.

## Terminal experience

Interactive terminals display a live dashboard while targets run:

```text
◆ Parallm · Comparing 3 targets

  ⠹  codex:model-a                 Running       12.4s
  ⠸  codex:model-b                 Running        8.7s
  ○  codex:model-c                 Pending            —

Ctrl+C to cancel
```

After the dashboard finishes, Parallm renders response Markdown with headings, lists, tables, emphasis, and syntax-highlighted fenced code blocks. Redirected output automatically remains raw Markdown without ANSI styling; `--format markdown` requests that behavior explicitly. `--format json` remains animation-free so it can be safely consumed by scripts.

## Architecture

The comparison engine is Parallm's central module. It owns validation, bounded parallel execution, cancellation, timeouts, event normalization, and partial-result handling behind one `run()` interface.

Agent adapters sit at the external-process seam. The Codex adapter translates a target into a safe non-interactive invocation; future Claude Code and Gemini CLI adapters can implement the same small interface without adding agent-specific flags to the engine or CLI.

```text
CLI → Comparison engine → Agent adapters → Installed coding-agent CLIs
                     └──→ Normalized events → Ink, Markdown, or JSON output
```

## Safety

The initial release is deliberately read-only. Parallm does not bypass agent approvals or sandboxing, and it never assembles prompts into shell commands. Write-capable runs will require isolated Git worktrees in a later release.

## Roadmap

- Interactive target selection and saved target profiles
- Claude Code and Gemini CLI adapters
- Optional local run history
- Worktree-isolated write mode and patch comparison
- Richer terminal views

## License

[MIT](LICENSE)
