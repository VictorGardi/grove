import * as os from "os";
import * as path from "path";

export function buildEnvPath(): string {
  const home = os.homedir();
  const extras = [
    path.join(home, ".opencode", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, "go", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
  ];
  const current = process.env.PATH ?? "";
  const parts = current.split(path.delimiter).filter(Boolean);
  for (const extra of extras.reverse()) {
    if (!parts.includes(extra)) parts.unshift(extra);
  }
  return parts.join(path.delimiter);
}
