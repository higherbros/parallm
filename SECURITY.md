# Security Policy

## Supported versions

Parallm is an experimental pre-1.0 project. Security fixes are made on the latest published release and the `main` branch.

## Report a vulnerability

Use the repository's **Security** tab to open a private GitHub security advisory. Do not include vulnerability details in a public issue.

If private reporting is unavailable, open a minimal issue asking the maintainers to enable a private reporting channel. Include no exploit, secret, or sensitive repository data in that issue.

Please include:

- The affected Parallm and Codex CLI versions
- Operating system and Node.js version
- A minimal reproduction
- Expected and observed sandbox or process behavior
- Impact and any suggested mitigation

## Security boundary

Parallm places model-generated local commands in Codex's read-only sandbox. It inherits Codex configuration, so trusted hooks and configured MCP, app, or plugin tools remain governed by their own permissions. A report is especially useful when Parallm escapes the documented command sandbox, exposes prompts unexpectedly, leaves managed child processes running after cancellation, or misrepresents a failed or degraded attempt as clean.
