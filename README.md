# Parallm

Run multiple AI coding-agent attempts in parallel and compare their results from your terminal.

Parallm delegates work to the Codex CLI you already use. It keeps Codex authentication, repository instructions, model access, and configuration while providing one command for bounded parallel execution and comparison.

> [!NOTE]
> Parallm is an experimental MVP. Version 0.1 supports Codex targets and places model-generated local commands in Codex's read-only sandbox.

## Install

Requirements:

- Node.js 22 or newer
- The [Codex CLI](https://learn.chatgpt.com/docs/codex/cli), authenticated for your account

Install Codex if needed, sign in, and then install Parallm:

```bash
npm install --global @openai/codex
codex login
npm install --global parallm
```

Verify both commands are available:

```bash
codex --version
parallm --version
```

## Quick start

Use `codex:default` to let your Codex installation select its configured default model. Reasoning effort makes the two target IDs distinct:

```bash
parallm run "Review this repository and identify the most serious bug" \
  --target codex:default@low \
  --target codex:default@high
```

Each target is a separate Codex run. Parallm starts both concurrently, shows their progress, and prints their responses in target order.

## Choose targets

Use model identifiers accepted by your Codex installation to compare different models:

```bash
parallm run "Explain the authentication flow" \
  --target codex:MODEL_ID_A \
  --target codex:MODEL_ID_B
```

Model availability depends on your Codex version, authentication method, account, and workspace. In an interactive `codex` session, use `/model` to see models available to you. `codex:default` avoids hard-coding a model identifier that may not be available to every account.

Append `@minimal`, `@low`, `@medium`, `@high`, or `@xhigh` to override reasoning effort for one target:

```bash
parallm run "Review this architecture" \
  --target codex:default@low \
  --target codex:default@high
```

Reasoning-effort support varies by model. Without `@effort`, Codex uses its configured default.

## Control execution

Set a per-target timeout or limit simultaneous attempts:

```bash
parallm run "Find correctness risks in this repository" \
  --target codex:default@low \
  --target codex:default@high \
  --timeout 5m \
  --concurrency 2
```

Every target consumes a full Codex run and counts toward the usage limits of your Codex account or API credentials. Higher reasoning effort, more targets, and higher concurrency can consume more tokens and encounter rate limits sooner.

Use Ctrl+C once to cancel active attempts gracefully. A second Ctrl+C forces Parallm to exit.

## Output formats

Interactive terminals display a live dashboard and render response Markdown. Redirected output remains raw Markdown.

Request raw Markdown explicitly:

```bash
parallm run "Review this repository" \
  --target codex:default@low \
  --target codex:default@high \
  --format markdown > comparison.md
```

Produce machine-readable JSON:

```bash
parallm run "Review this repository" \
  --target codex:default@low \
  --target codex:default@high \
  --format json > comparison.json
```

JSON includes each target's complete stdout, stderr, exit code, signal, timing, and status. Text and Markdown output show filtered diagnostics when a successful Codex attempt emits warning or error lines. Review JSON before sharing it because Codex stderr can contain local paths, integration names, endpoints, and other environment details.

Run `parallm --help` for every option.

## Safety boundary

Parallm invokes Codex with `--sandbox read-only` and `--ephemeral` and sends prompts through stdin instead of assembling shell command strings. This prevents model-generated local commands from modifying the workspace under Codex's sandbox and avoids persisting the Codex session.

The boundary is specifically the Codex command sandbox; it is not general process or integration isolation:

- Codex user and project configuration remains active.
- Trusted lifecycle hooks can run.
- Configured MCP servers, apps, plugins, and other external tools retain their own permissions and approval policies.
- Non-interactive `codex exec` runs do not provide Parallm with an interactive approval loop.

Inspect your Codex hooks and MCP configuration before running prompts against an untrusted repository. For a stronger integration boundary, use a dedicated `CODEX_HOME` with only the authentication and configuration you intend Parallm to inherit.

Each target receives the prompt and can read the selected working directory. Codex may send relevant prompt and repository content to its configured model provider. Parallm adds no telemetry or local run history of its own.

## Troubleshooting

- **`spawn codex ENOENT`:** Install Codex and make sure `codex` is on `PATH`.
- **Unsupported model:** Use `codex:default` or select an identifier shown by `/model` in Codex.
- **MCP, hook, or authentication diagnostic:** Fix or disable that integration in Codex configuration; Parallm deliberately preserves it in attempt diagnostics.
- **Rate limiting:** Reduce `--concurrency`, use fewer targets, or lower reasoning effort.
- **One target fails:** Parallm preserves and prints the other results, then exits with status 1.

## What works today

- Run the same prompt against two or more Codex targets concurrently.
- Compare models or reasoning-effort levels.
- Apply a per-target timeout and global concurrency limit.
- Cancel active attempts while preserving partial output.
- Keep model-generated local commands in Codex's read-only sandbox.
- Preserve stdout, stderr, exit code, signal, duration, and status.
- Render an animated Ink dashboard, Markdown, or stable JSON.
- Install as both a CLI and an ESM library.

## Architecture

The comparison engine owns validation, bounded parallel execution, cancellation, timeouts, event normalization, and partial-result handling behind one `run()` interface.

Agent adapters sit at the external-process seam. The Codex adapter translates a target into a non-interactive invocation; future Claude Code and Gemini CLI adapters can implement the same interface without adding agent-specific flags to the engine or CLI.

```text
CLI -> Comparison engine -> Agent adapters -> Installed coding-agent CLIs
                     \-> Normalized events -> Ink, Markdown, or JSON output
```

## Development

```bash
pnpm install
pnpm run test:all
pnpm run smoke:package
pnpm link --global
```

CI validates Node.js 22, 24, and 26 on Ubuntu, Node.js 24 on macOS, and Node.js 24 on Windows. Agent availability and sandbox behavior still depend on the locally installed Codex CLI and operating system.

See [RELEASING.md](RELEASING.md) for the public-release checklist and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Roadmap

- Interactive target selection and saved target profiles
- Claude Code and Gemini CLI adapters
- Optional local run history
- Worktree-isolated write mode and patch comparison
- Richer terminal views

## License

[MIT](LICENSE)
