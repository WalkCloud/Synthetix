import path from "path";
import { spawnPython } from "@/lib/python";

const PYTHON_SCRIPT = path.resolve("workers/python/convert.py");

export function convertToMarkdown(
  inputPath: string,
  outputDir: string
): Promise<string> {
  return spawnPython(PYTHON_SCRIPT, [inputPath, outputDir], {
    timeout: 300_000,
    parseJson: false,
  });
}
