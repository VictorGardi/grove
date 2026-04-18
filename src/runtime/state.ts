import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface StateContainerSession {
  containerId: string;
  containerName: string;
  taskId: string;
  workspacePath: string;
  mode: "ephemeral" | "task-bound";
  startedAt: number;
  image: string;
  sessionId?: string;
}

export interface GroveState {
  version: number;
  lastUpdated: number;
  containers: Record<string, StateContainerSession>;
}

const STATE_DIR = path.join(os.homedir(), ".grove");
const STATE_FILE = path.join(STATE_DIR, "state.json");

const DEFAULT_STATE: GroveState = {
  version: 1,
  lastUpdated: Date.now(),
  containers: {},
};

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

function readState(): GroveState {
  ensureStateDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, "utf-8");
      const state = JSON.parse(content) as GroveState;
      return state;
    }
  } catch (error) {
    console.error("[grove] Failed to read state file:", error);
  }
  return { ...DEFAULT_STATE };
}

function writeState(state: GroveState): void {
  ensureStateDir();
  state.lastUpdated = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function saveContainerSession(session: StateContainerSession): void {
  const state = readState();
  state.containers[session.taskId] = session;
  writeState(state);
  console.log(
    `[grove] task=${session.taskId} container=${session.containerName} action=save`,
  );
}

export function removeContainerSession(taskId: string): void {
  const state = readState();
  const removed = state.containers[taskId];
  if (removed) {
    delete state.containers[taskId];
    writeState(state);
    console.log(
      `[grove] task=${taskId} container=${removed.containerName} action=remove`,
    );
  }
}

export function getContainerSession(
  taskId: string,
): StateContainerSession | null {
  const state = readState();
  return state.containers[taskId] || null;
}

export function getAllContainerSessions(): StateContainerSession[] {
  const state = readState();
  return Object.values(state.containers);
}

export function clearState(): void {
  writeState(DEFAULT_STATE);
}

export function getStatePath(): string {
  return STATE_FILE;
}

export function initializeState(): void {
  const state = readState();
  console.log(
    `[grove] state initialized: ${Object.keys(state.containers).length} containers`,
  );
}
