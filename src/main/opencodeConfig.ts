import * as fs from "fs";
import * as path from "path";

export interface OpencodeConfigOptions {
  /** Override permission for doom_loop */
  doomLoop?: string;
  /** Override permission for external_directory */
  externalDirectory?: string;
}

export function writeOpencodeConfig(
  cwd: string,
  wroteConfigFiles: Map<string, string>,
  runKey: string,
  options: OpencodeConfigOptions = {},
): void {
  const configPath = path.join(cwd, "opencode.json");
  if (fs.existsSync(configPath)) return;
  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          permission: {
            doom_loop: options.doomLoop ?? "allow",
            external_directory: options.externalDirectory ?? "allow",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    wroteConfigFiles.set(runKey, configPath);
    console.log(`[OpencodeConfig] Wrote opencode.json to ${configPath}`);
  } catch (e) {
    console.warn(`[OpencodeConfig] Could not write opencode.json:`, e);
  }
}

export function cleanupGroveConfig(
  wroteConfigFiles: Map<string, string>,
  runKey: string,
): void {
  const configPath = wroteConfigFiles.get(runKey);
  if (!configPath) return;
  try {
    fs.unlinkSync(configPath);
    console.log(`[OpencodeConfig] Cleaned up opencode.json: ${configPath}`);
  } catch {
    // ignore
  }
  wroteConfigFiles.delete(runKey);
}
