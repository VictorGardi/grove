import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface OpencodeConfigOptions {
  /** Override permission for doom_loop */
  doomLoop?: string;
  /** Override permission for external_directory */
  externalDirectory?: string;
}

const OPENCODE_CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const OPENCODE_CONFIG_PATH = path.join(OPENCODE_CONFIG_DIR, "opencode.json");

export function writeOpencodeConfig(
  _cwd: string,
  wroteConfigFiles: Map<string, string>,
  runKey: string,
  options: OpencodeConfigOptions = {},
): void {
  try {
    fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });
  } catch {
    // dir may already exist
  }

  let existingConfig: Record<string, unknown> = {};
  if (fs.existsSync(OPENCODE_CONFIG_PATH)) {
    try {
      existingConfig = JSON.parse(
        fs.readFileSync(OPENCODE_CONFIG_PATH, "utf-8"),
      );
    } catch {
      // ignore parse errors
    }
  }

  const permission =
    (existingConfig.permission as Record<string, unknown>) ?? {};

  const newConfig = {
    ...existingConfig,
    $schema: existingConfig.$schema ?? "https://opencode.ai/config.json",
    permission: {
      ...permission,
      doom_loop: permission.doom_loop ?? options.doomLoop ?? "allow",
    },
  };

  try {
    fs.writeFileSync(
      OPENCODE_CONFIG_PATH,
      JSON.stringify(newConfig, null, 2),
      "utf-8",
    );
    wroteConfigFiles.set(runKey, OPENCODE_CONFIG_PATH);
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
  } catch {
    // ignore
  }
  wroteConfigFiles.delete(runKey);
}
