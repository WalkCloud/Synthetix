import path from "path";
import fs from "fs";
import { spawnPython } from "@/lib/python";

const PYTHON_SCRIPT = path.resolve("workers/python/convert.py");

export function convertToMarkdown(
  inputPath: string,
  outputDir: string
): Promise<string> {
  if (!fs.existsSync(inputPath)) {
    return Promise.reject(new Error(`Input file does not exist: ${inputPath}`));
  }

  return spawnPython(PYTHON_SCRIPT, [inputPath, outputDir], {
    timeout: 300_000,
    parseJson: false,
  });
}
