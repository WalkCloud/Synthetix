import { spawn } from "child_process";

export interface PythonSpawnOptions {
  timeout?: number;
  parseJson?: boolean;
}

const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

export function spawnPython(
  script: string,
  args: string[],
  options: PythonSpawnOptions = {}
): Promise<string> {
  const { timeout = 120_000, parseJson = true } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_PATH, [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      env: { ...process.env, PYTHONUTF8: "1" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`${script} failed: ${stderr || stdout || `code ${code}`}`));
        return;
      }
      if (!parseJson) {
        resolve(stdout.trim());
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) { resolve("{}"); return; }
      try {
        JSON.parse(trimmed);
        resolve(trimmed);
      } catch {
        reject(new Error(`${script} returned invalid JSON: ${trimmed.slice(0, 500)}`));
      }
    });

    proc.on("error", (err: Error) => reject(err));
  });
}

export function spawnPythonJson<T = Record<string, unknown>>(
  script: string,
  args: string[],
  options: Omit<PythonSpawnOptions, "parseJson"> = {}
): Promise<T> {
  return spawnPython(script, args, { ...options, parseJson: true }).then(
    (raw) => JSON.parse(raw) as T
  );
}
