import { spawn } from "node:child_process";

export type ProcessSpec = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
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

    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      shell: false,
      signal,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

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
        reject(error);
      }
    });

    child.once("close", (exitCode, exitSignal) => {
      if (!settled) {
        settled = true;
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
