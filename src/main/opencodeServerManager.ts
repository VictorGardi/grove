import { spawn, ChildProcess } from "child_process";
import * as http from "http";
import { writeOpencodeConfig } from "./opencodeConfig";

interface ServerState {
  url: string;
  pid: number | null;
  process: ChildProcess | null;
}

let serverState: ServerState | null = null;
let restartCount = 0;
let errorState: string | null = null;
const MAX_RESTARTS = 3;

async function checkHealth(url: string, timeout = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${url}/health`, { timeout }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve(res.statusCode === 200 && data.includes("opencode"));
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function checkPort4096(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      "http://localhost:4096/health",
      { timeout: 500 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve(res.statusCode === 200 && data.includes("opencode"));
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function generateConfigContent(): string {
  const wroteConfigFiles = new Map<string, string>();
  const runKey = `grove-${Date.now()}`;
  writeOpencodeConfig("", wroteConfigFiles, runKey, { doomLoop: "allow" });
  const configPath = wroteConfigFiles.get(runKey);
  if (!configPath) {
    return JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      permission: { doom_loop: "allow" },
    });
  }
  try {
    const fs = require("fs");
    return fs.readFileSync(configPath, "utf-8");
  } catch {
    return JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      permission: { doom_loop: "allow" },
    });
  }
}

function parseUrlFromOutput(output: string): string | null {
  const match = output.match(/http:\/\/localhost:\d+/);
  return match ? match[0] : null;
}

async function waitForServer(url: string, maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkHealth(url, 500)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function doStartServer(): Promise<{ url: string } | { error: string }> {
  return new Promise((resolve) => {
    const configContent = generateConfigContent();
    const child = spawn("opencode", ["serve", "--port", "0"], {
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: configContent,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let hasResolved = false;

    child.stdout?.on("data", (data) => {
      output += data.toString();
      const url = parseUrlFromOutput(output);
      if (url && !hasResolved) {
        hasResolved = true;
        serverState = {
          url,
          pid: child.pid ?? null,
          process: child,
        };
        resolve({ url });
      }
    });

    child.stderr?.on("data", (data) => {
      console.error("[opencodeServer]", data.toString());
    });

    child.on("exit", (code) => {
      if (!hasResolved && code !== 0 && code !== null) {
        hasResolved = true;
        resolve({ error: `Server exited with code ${code}` });
      }
    });

    setTimeout(async () => {
      if (!hasResolved && output) {
        const url = parseUrlFromOutput(output);
        if (url) {
          hasResolved = true;
          serverState = {
            url,
            pid: child.pid ?? null,
            process: child,
          };
          if (!(await waitForServer(url))) {
            resolve({ url: serverState!.url });
          } else {
            resolve({ url: serverState!.url });
          }
        }
      }
      if (!hasResolved) {
        hasResolved = true;
        resolve({ error: "Failed to parse server URL from output" });
      }
    }, 5000);
  });
}

async function doEnsureServer(): Promise<{ url: string } | { error: string }> {
  if (errorState) {
    const err = errorState;
    errorState = null;
    return { error: err };
  }

  if (serverState?.url) {
    const isAlive = await checkHealth(serverState.url);
    if (isAlive) {
      return { url: serverState.url };
    }
  }

  const port4096Available = await checkPort4096();
  if (port4096Available) {
    serverState = {
      url: "http://localhost:4096",
      pid: null,
      process: null,
    };
    return { url: serverState.url };
  }

  return doStartServer();
}

export function ensureServer(): Promise<{ url: string } | { error: string }> {
  return doEnsureWithRestart();
}

async function doEnsureWithRestart(): Promise<
  { url: string } | { error: string }
> {
  const result = await doEnsureServer();

  if ("url" in result) {
    restartCount = 0;
    if (serverState?.process) {
      serverState.process.on("exit", async (code) => {
        if (code !== 0) {
          console.warn(
            `[opencodeServer] Unexpected exit (code=${code}), restarting...`,
          );
          if (restartCount < MAX_RESTARTS) {
            restartCount++;
            setTimeout(async () => {
              const retryResult = await doEnsureServer();
              if ("error" in retryResult) {
                errorState = retryResult.error;
              }
            }, 2000);
          } else {
            errorState = "Max restarts exceeded";
          }
        }
      });
    }
  }

  return result;
}

export function killServer(): void {
  if (serverState?.process) {
    serverState.process.kill("SIGTERM");
    setTimeout(() => {
      if (serverState?.process && !serverState.process.killed) {
        serverState.process.kill("SIGKILL");
      }
    }, 2000);
  }
  serverState = null;
  restartCount = 0;
  errorState = null;
}

export function getServerUrl(): string | null {
  return serverState?.url ?? null;
}

export function getServerStatus(): {
  running: boolean;
  url: string | null;
  pid: number | null;
} {
  return {
    running: serverState?.url !== null,
    url: serverState?.url ?? null,
    pid: serverState?.pid ?? null,
  };
}
