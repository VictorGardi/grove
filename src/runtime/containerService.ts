import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import type {
  ContainerRuntime,
  DevcontainerConfig,
  ContainerSession,
  ContainerServiceConfig,
  ContainerStartOptions,
  ExecutionEnvironment,
} from "@shared/types";

const CONTAINER_RUNS_DIR = path.join(os.homedir(), ".grove", "container-runs");

const DEFAULT_UBUNTU_IMAGE = "ubuntu:22.04";

const DEFAULT_CONFIG: ContainerServiceConfig = {
  enabled: false,
  runtime: "docker",
  defaultImage: DEFAULT_UBUNTU_IMAGE,
  autoCleanup: true,
};

class ContainerRuntimeInterface {
  private runtime: ContainerRuntime;

  constructor(runtime: ContainerRuntime) {
    this.runtime = runtime;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.exec(["version"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async pullImage(
    image: string,
  ): Promise<{ exitCode: number; stderr: string }> {
    return this.exec(["pull", image]);
  }

  async buildImage(
    imageName: string,
    dockerfilePath: string,
    context: string,
    buildArgs: Record<string, string> = {},
  ): Promise<{ exitCode: number; stderr: string }> {
    const args: string[] = ["build", "-t", imageName, "-f", dockerfilePath];

    for (const [key, value] of Object.entries(buildArgs)) {
      args.push("--build-arg", `${key}=${value}`);
    }

    args.push(context);

    return this.exec(args);
  }

  async imageExists(imageName: string): Promise<boolean> {
    const result = await this.exec(["image", "inspect", imageName]);
    return result.exitCode === 0;
  }

  async runContainer(
    name: string,
    image: string,
    options: {
      entrypoint?: string;
      mount?: string[];
      env?: Record<string, string>;
      network?: string;
      detach?: boolean;
      workdir?: string;
      ports?: string[];
      interactive?: boolean;
    } = {},
  ): Promise<{ exitCode: number; containerId: string; stderr: string }> {
    const args: string[] = ["run", "--name", name];

    if (options.detach) {
      args.push("-d");
    }

    if (options.network) {
      args.push("--network", options.network);
    }

    if (options.workdir) {
      args.push("-w", options.workdir);
    }

    for (const port of options.ports || []) {
      args.push("-p", port);
    }

    for (const mount of options.mount || []) {
      args.push("-v", mount);
    }

    for (const [key, value] of Object.entries(options.env || {})) {
      args.push("-e", `${key}=${value}`);
    }

    if (options.entrypoint) {
      args.push("--entrypoint", options.entrypoint);
    }

    if (options.interactive) {
      args.push("-it");
    }

    args.push(image);

    const result = await this.exec(args);
    const containerId = result.stdout.trim();
    return { ...result, containerId };
  }

  async stopContainer(
    containerId: string,
  ): Promise<{ exitCode: number; stderr: string }> {
    return this.exec(["stop", containerId]);
  }

  async startContainer(
    containerId: string,
  ): Promise<{ exitCode: number; stderr: string }> {
    return this.exec(["start", containerId]);
  }

  async removeContainer(
    containerId: string,
    force: boolean = false,
  ): Promise<{ exitCode: number; stderr: string }> {
    const args = force ? ["rm", "-f", containerId] : ["rm", containerId];
    return this.exec(args);
  }

  async execInContainer(
    containerId: string,
    command: string[],
    options: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const args = ["exec"];

    if (options.cwd) {
      args.push("-w", options.cwd);
    }

    for (const [key, value] of Object.entries(options.env || {})) {
      args.push("-e", `${key}=${value}`);
    }

    args.push(containerId, ...command);

    return this.exec(args, { stdio: "pipe" });
  }

  async attach(
    containerId: string,
    sessionName: string,
  ): Promise<{ exitCode: number; stderr: string }> {
    return this.exec([
      "exec",
      "-it",
      containerId,
      "tmux",
      "attach",
      "-t",
      sessionName,
    ]);
  }

  async inspectContainer(
    containerId: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.exec(["inspect", containerId]);
  }

  async listContainers(
    all: boolean = true,
  ): Promise<{ exitCode: number; stdout: string }> {
    const args = ["ps", all ? "-a" : ""];
    return this.exec(args);
  }

  private exec(
    args: string[],
    options: { stdio?: "pipe" | "inherit" } = {},
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn(this.runtime, args, {
        stdio: options.stdio || ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });

      proc.on("error", () => {
        resolve({ exitCode: 1, stdout: "", stderr: "Process error" });
      });
    });
  }

  getBinary(): string {
    return this.runtime;
  }
}

export class DevcontainerManager {
  async parseDevcontainer(
    workspacePath: string,
  ): Promise<DevcontainerConfig | null> {
    const devcontainerPath = path.join(
      workspacePath,
      ".devcontainer",
      "devcontainer.json",
    );

    try {
      if (!fs.existsSync(devcontainerPath)) {
        return null;
      }

      const content = await fs.promises.readFile(devcontainerPath, "utf-8");
      const config = JSON.parse(content);
      return this.normalizeConfig(config);
    } catch (err) {
      console.warn(
        "[DevcontainerManager] Failed to parse devcontainer.json:",
        err,
      );
      return null;
    }
  }

  private normalizeConfig(config: Record<string, unknown>): DevcontainerConfig {
    return {
      image: typeof config.image === "string" ? config.image : undefined,
      build: config.build as DevcontainerConfig["build"],
      containerEnv: config.containerEnv as DevcontainerConfig["containerEnv"],
      containerUser:
        typeof config.containerUser === "string"
          ? config.containerUser
          : undefined,
      forwardPorts: Array.isArray(config.forwardPorts)
        ? (config.forwardPorts as (number | string)[])
        : undefined,
      mount: Array.isArray(config.mount)
        ? (config.mount as string[])
        : undefined,
      postCreateCommand:
        typeof config.postCreateCommand === "string"
          ? config.postCreateCommand
          : undefined,
      updateContentCommand:
        typeof config.updateContentCommand === "string"
          ? config.updateContentCommand
          : undefined,
      postStartCommand:
        typeof config.postStartCommand === "string"
          ? config.postStartCommand
          : undefined,
      customizations:
        config.customizations as DevcontainerConfig["customizations"],
    };
  }

  getImage(config: DevcontainerConfig | null, defaultImage: string): string {
    if (config?.image) {
      return config.image;
    }
    return defaultImage;
  }

  async computeImageHash(workspacePath: string): Promise<string> {
    const devcontainerDir = path.join(workspacePath, ".devcontainer");
    const filesToHash = [
      path.join(devcontainerDir, "devcontainer.json"),
      path.join(devcontainerDir, "Dockerfile"),
    ];

    const hash = crypto.createHash("sha256");

    for (const filePath of filesToHash) {
      if (fs.existsSync(filePath)) {
        const content = await fs.promises.readFile(filePath);
        hash.update(content);
      }
    }

    return hash.digest("hex").slice(0, 8);
  }
}

export class ContainerService {
  private runtimeInterface: ContainerRuntimeInterface | null = null;
  private config: ContainerServiceConfig;
  private devcontainerManager: DevcontainerManager;
  private activeSessions = new Map<string, ContainerSession>();

  constructor(config: Partial<ContainerServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.devcontainerManager = new DevcontainerManager();
  }

  async initialize(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    this.runtimeInterface = new ContainerRuntimeInterface(this.config.runtime);
    const available = await this.runtimeInterface.isAvailable();

    if (!available) {
      console.warn(
        `[ContainerService] ${this.config.runtime} is not available, falling back to local execution`,
      );
      this.runtimeInterface = null;
      return false;
    }

    try {
      await fs.promises.mkdir(CONTAINER_RUNS_DIR, { recursive: true });
    } catch {
      // Directory may already exist
    }

    return true;
  }

  isEnabled(): boolean {
    return this.config.enabled && this.runtimeInterface !== null;
  }

  getRuntime(): ContainerRuntime {
    return this.config.runtime;
  }

  getDefaultImage(): string {
    return this.config.defaultImage;
  }

  async ensureImage(
    workspacePath: string,
    imageName: string,
    devcontainerConfig: DevcontainerConfig | undefined,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.runtimeInterface) {
      return { ok: false, error: "Container runtime not available" };
    }

    const needsBuild = !devcontainerConfig?.image || devcontainerConfig.build;
    if (!needsBuild) {
      return { ok: true };
    }

    const imageToUse = devcontainerConfig?.image || imageName;
    const exists = await this.runtimeInterface.imageExists(imageToUse);
    if (exists) {
      return { ok: true };
    }

    console.log(`[ContainerService] Building image: ${imageToUse}...`);

    const dockerfilePath = path.join(
      workspacePath,
      ".devcontainer",
      "Dockerfile",
    );
    if (!fs.existsSync(dockerfilePath)) {
      return {
        ok: false,
        error: `Dockerfile not found at ${dockerfilePath}. Container mode with 'build' requires a Dockerfile.`,
      };
    }

    const buildArgs = devcontainerConfig?.build?.args || {};
    const context = devcontainerConfig?.build?.context || ".devcontainer";

    const result = await this.runtimeInterface.buildImage(
      imageToUse,
      dockerfilePath,
      context,
      buildArgs,
    );

    if (result.exitCode !== 0) {
      return { ok: false, error: `Failed to build image: ${result.stderr}` };
    }

    console.log(`[ContainerService] Image built: ${imageToUse}`);
    return { ok: true };
  }

  getActiveSession(taskId: string): ContainerSession | undefined {
    return this.activeSessions.get(taskId);
  }

  async startContainer(
    options: ContainerStartOptions,
  ): Promise<
    | { ok: true; session: ContainerSession; environment: ExecutionEnvironment }
    | { ok: false; error: string }
  > {
    if (!this.runtimeInterface) {
      return { ok: false, error: "Container runtime not available" };
    }

    const {
      taskId,
      workspacePath,
      image,
      devcontainerConfig,
      mountWorkspace = true,
      requireDevcontainer = false,
    } = options;

    if (requireDevcontainer && !devcontainerConfig) {
      return {
        ok: false,
        error: `.devcontainer/devcontainer.json is required but was not found in ${workspacePath}. Please create a devcontainer configuration or disable requireDevcontainer.`,
      };
    }

    const sessionId = this.generateSessionId();
    const containerName = this.buildContainerName(taskId);

    const resolvedImage =
      image ||
      this.devcontainerManager.getImage(
        devcontainerConfig || null,
        this.config.defaultImage,
      );

    const mounts: string[] = [];
    if (mountWorkspace) {
      mounts.push(`${workspacePath}:/workspace`);
    }

    if (devcontainerConfig?.mount) {
      mounts.push(...devcontainerConfig.mount);
    }

    if (options.additionalMounts) {
      mounts.push(...options.additionalMounts);
    }

    const configPath = path.join(os.homedir(), ".config");
    if (
      (options.mountAuthConfig || this.config.mountAuthConfig) &&
      fs.existsSync(configPath)
    ) {
      mounts.push(`${configPath}:/home/dev/.config:ro`);
    }

    const opencodeDataPath = path.join(
      os.homedir(),
      ".local",
      "share",
      "opencode",
    );
    if (fs.existsSync(opencodeDataPath)) {
      mounts.push(`${opencodeDataPath}:/home/dev/.local/share/opencode:ro`);
    }

    const env: Record<string, string> = {
      GROVE_TASK_ID: taskId,
      GROVE_WORKSPACE_PATH: workspacePath,
      TERM: "xterm-256color",
    };

    if (devcontainerConfig?.containerEnv) {
      for (const [key, value] of Object.entries(
        devcontainerConfig.containerEnv,
      )) {
        env[key] = String(value);
      }
    }

    console.log(
      `[ContainerService] Running container ${containerName} with image ${resolvedImage} (interactive: true)`,
    );

    const runResult = await this.runtimeInterface.runContainer(
      containerName,
      resolvedImage,
      {
        mount: mounts,
        env,
        workdir: "/workspace",
        detach: true,
        interactive: true,
      },
    );

    if (runResult.exitCode !== 0) {
      console.error(
        `[ContainerService] Failed to start container: ${runResult.stderr}`,
      );
      return {
        ok: false,
        error: `Failed to start container: ${runResult.stderr}`,
      };
    }

    console.log(
      `[ContainerService] Container started with id ${runResult.containerId}`,
    );

    const session: ContainerSession = {
      sessionId,
      taskId,
      containerId: runResult.containerId,
      containerName,
      runtime: this.config.runtime,
      workspacePath,
      createdAt: Date.now(),
      mode: "task-bound",
      image: resolvedImage,
      startedAt: Date.now(),
    };

    this.activeSessions.set(taskId, session);

    const environment: ExecutionEnvironment = {
      type: "container",
      workspacePath,
      containerName,
      containerId: runResult.containerId,
      workingDirectory: options.workdir || "/workspace",
    };

    return { ok: true, session, environment };
  }

  async stopContainer(
    taskId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = this.activeSessions.get(taskId);
    if (!session) {
      return { ok: true };
    }

    if (!this.runtimeInterface) {
      return { ok: false, error: "Container runtime not available" };
    }

    await this.runtimeInterface.stopContainer(session.containerId);

    if (this.config.autoCleanup) {
      await this.runtimeInterface.removeContainer(session.containerId, true);
    }

    this.activeSessions.delete(taskId);

    return { ok: true };
  }

  async execInContainer(
    taskId: string,
    command: string[],
    options: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const session = this.activeSessions.get(taskId);
    if (!session || !this.runtimeInterface) {
      return { exitCode: 1, stdout: "", stderr: "No active container session" };
    }

    return this.runtimeInterface.execInContainer(
      session.containerId,
      command,
      options,
    );
  }

  async cleanupAll(): Promise<void> {
    for (const [taskId] of this.activeSessions) {
      await this.stopContainer(taskId);
    }
  }

  async checkAndCleanupOrphaned(): Promise<void> {
    if (!this.runtimeInterface) {
      return;
    }

    const result = await this.runtimeInterface.listContainers(true);
    if (result.exitCode !== 0) {
      return;
    }

    const lines = result.stdout.split("\n");
    for (const line of lines) {
      if (line.includes("grove-task-")) {
        const containerName = line.split(/\s+/).pop();
        if (containerName) {
          await this.runtimeInterface.removeContainer(containerName, true);
        }
      }
    }
  }

  private generateSessionId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  private buildContainerName(taskId: string): string {
    const homeHash = crypto
      .createHash("sha256")
      .update(os.homedir())
      .digest("hex")
      .slice(0, 8);
    return `grove-task-${taskId}-${homeHash}`;
  }

  async getOrStartContainer(
    taskId: string,
    workspacePath: string,
    options: {
      image?: string;
      devcontainerConfig?: DevcontainerConfig;
      additionalMounts?: string[];
    },
  ): Promise<
    | { ok: true; containerId: string; containerName: string }
    | { ok: false; error: string }
  > {
    const containerName = this.buildContainerName(taskId);

    try {
      const inspect =
        await this.runtimeInterface!.inspectContainer(containerName);
      if (inspect.exitCode === 0) {
        const container = JSON.parse(inspect.stdout);
        if (container[0]?.State?.Running) {
          return { ok: true, containerId: container[0].Id, containerName };
        }
        // Container exists but not running - remove and recreate with --init
        console.log(
          `[ContainerService] Removing stopped container ${containerName} to recreate with --init`,
        );
        await this.runtimeInterface!.removeContainer(containerName, true);
      }
    } catch (err) {
      console.warn(
        `[ContainerService] Error inspecting container ${containerName}:`,
        err,
      );
    }

    const result = await this.startContainer({
      taskId,
      workspacePath,
      image: options.image,
      devcontainerConfig: options.devcontainerConfig,
      additionalMounts: options.additionalMounts,
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const ready = await this.waitForContainerReady(result.session.containerId);
    if (!ready) {
      console.warn(
        `[ContainerService] New container ${result.session.containerName} failed to become ready`,
      );
    }

    return {
      ok: true,
      containerId: result.session.containerId,
      containerName: result.session.containerName,
    };
  }

  async isContainerRunning(containerName: string): Promise<boolean> {
    if (!this.runtimeInterface) return false;
    try {
      const inspect =
        await this.runtimeInterface.inspectContainer(containerName);
      if (inspect.exitCode === 0) {
        const container = JSON.parse(inspect.stdout);
        return container[0]?.State?.Running === true;
      }
    } catch {}
    return false;
  }

  async waitForContainerReady(
    containerId: string,
    maxAttempts: number = 10,
    delayMs: number = 1000,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const isRunning = await this.isContainerRunning(containerId);
      if (isRunning) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return false;
  }

  async runTmuxCommand(
    containerId: string,
    sessionName: string,
    agent: string,
    containerCwd: string,
    cols: number,
    rows: number,
  ): Promise<{ exitCode: number; stderr: string }> {
    let isRunning = false;
    let containerState = "unknown";

    try {
      const inspect =
        await this.runtimeInterface!.inspectContainer(containerId);
      if (inspect.exitCode === 0) {
        const container = JSON.parse(inspect.stdout);
        isRunning = container[0]?.State?.Running === true;
        containerState = container[0]?.State?.Status || "unknown";
      }
    } catch {}

    if (!isRunning) {
      return {
        exitCode: 1,
        stderr: `Container ${containerId} is not running (state: ${containerState})`,
      };
    }

    const agentCmd = this.buildAgentCommand(agent, containerCwd);
    const tmuxCmd = `mkdir -p /tmp/tmux-0 && chmod 700 /tmp/tmux-0 && tmux new -d -s ${sessionName} -x ${cols} -y ${rows} 'exec /bin/bash' && tmux set -g status off && tmux send-keys -t ${sessionName} '${agentCmd}' Enter`;

    return this.runtimeInterface!.execInContainer(
      containerId,
      ["bash", "-c", tmuxCmd],
      { cwd: "/workspace" },
    );
  }

  private buildAgentCommand(agent: string, cwd: string): string {
    switch (agent) {
      case "opencode":
        return `opencode ${cwd}`;
      case "claude":
        return "claude";
      case "copilot":
        return "copilot";
      default:
        return agent;
    }
  }
}

let containerServiceInstance: ContainerService | null = null;

export function getContainerService(
  config?: Partial<ContainerServiceConfig>,
): ContainerService {
  if (!containerServiceInstance) {
    containerServiceInstance = new ContainerService(config);
  }
  return containerServiceInstance;
}

export async function initializeContainerService(
  config?: Partial<ContainerServiceConfig>,
): Promise<boolean> {
  const service = getContainerService(config);
  return service.initialize();
}
