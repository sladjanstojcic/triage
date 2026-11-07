import { execFile } from "node:child_process";

export type ExecResult = { ok: boolean; stdout: string; stderr: string };

/** Run a binary without a shell. Never throws; a missing tool or non-zero exit is ok:false. */
export function run(
  cmd: string,
  args: string[],
  timeoutMs = 5000,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? err?.message ?? "") });
      },
    );
  });
}
