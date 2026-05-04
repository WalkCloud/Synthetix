import { spawn } from "child_process";
import path from "path";

const PYTHON_SCRIPT = path.resolve("workers/python/convert.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

export function convertToMarkdown(
  inputPath: string,
  outputDir: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_PATH, [PYTHON_SCRIPT, inputPath, outputDir], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (err: Error) => {
      reject(new Error(`MarkItDown spawn failed: ${err.message}`));
    });

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(`MarkItDown exited with code ${code}: ${stderr || stdout}`)
        );
      }
    });
  });
}
