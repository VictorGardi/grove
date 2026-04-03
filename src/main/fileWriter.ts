import * as fs from "fs";
import * as path from "path";

/**
 * Atomically writes content to a file using the temp-file + rename pattern.
 * Ensures the parent directory exists before writing.
 * This prevents partial reads by chokidar or other consumers.
 */
export async function atomicWrite(
  filePath: string,
  content: string,
): Promise<void> {
  const tmpPath = filePath + ".tmp";
  const dir = path.dirname(filePath);

  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tmpPath, content, "utf-8");
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}
