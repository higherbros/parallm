import { spawn } from "node:child_process";

const DEFAULT_TERMINATION_GRACE_MS = 1_000;

export type ProcessSpec = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  terminationGraceMs?: number;
}>;

export type ProcessChunk = Readonly<{
  stream: "stdout" | "stderr";
  chunk: string;
}>;

export type ProcessResult = Readonly<{
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}>;

export type ProcessRunner = (
  spec: ProcessSpec,
  emit: (chunk: ProcessChunk) => void,
  signal?: AbortSignal,
) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = async (spec, emit, signal) =>
  new Promise<ProcessResult>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let forceKillTimeout: NodeJS.Timeout | undefined;
    const managesProcessGroup = process.platform !== "win32";

    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      detached: managesProcessGroup,
      env: spec.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const killManagedProcess = (killSignal: NodeJS.Signals): void => {
      if (managesProcessGroup && child.pid !== undefined) {
        try {
          process.kill(-child.pid, killSignal);
          return;
        } catch {
          // The process group may have already exited; fall back to the child.
        }
      }

      if (child.exitCode === null && child.signalCode === null) {
        child.kill(killSignal);
      }
    };
    const clearForceKill = (): void => {
      if (forceKillTimeout !== undefined) {
        clearTimeout(forceKillTimeout);
        forceKillTimeout = undefined;
      }
    };
    const scheduleForceKill = (): void => {
      forceKillTimeout = setTimeout(() => {
        killManagedProcess("SIGKILL");
      }, Math.max(0, spec.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS));
      forceKillTimeout.unref();
    };
    const handleAbort = (): void => {
      killManagedProcess("SIGTERM");
      scheduleForceKill();
    };
    const stopWatchingAbort = (): void => {
      signal?.removeEventListener("abort", handleAbort);
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
    }

    child.stdout.on("data", (data: Buffer) => {
      stdout.push(data);
      emit({ stream: "stdout", chunk: data.toString("utf8") });
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr.push(data);
      emit({ stream: "stderr", chunk: data.toString("utf8") });
    });

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearForceKill();
        stopWatchingAbort();
        reject(error);
      }
    });

    child.once("close", (exitCode, exitSignal) => {
      if (!settled) {
        settled = true;
        clearForceKill();
        stopWatchingAbort();
        resolve({
          exitCode,
          signal: exitSignal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      }
    });

    child.stdin.on("error", () => {
      // The process result carries failures when a child closes before reading stdin.
    });
    child.stdin.end(spec.input);
  });
