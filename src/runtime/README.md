# Grove Runtime

Pure TypeScript runtime library for Grove task orchestration. This package contains all core operational logic and can be used by both the Electron app and a future CLI.

## Design Principles

- **No Electron dependencies**: Uses only Node.js standard libraries (`fs`, `path`, `child_process`) and a few pure npm packages (`simple-git`, `gray-matter`).
- **No UI concerns**: The runtime only handles state management, file operations, and process execution. All UI rendering lives elsewhere.
- **Testable without Electron**: All modules can be tested with vitest in Node.js without requiring Electron.

## API Surface

### Task Operations

```typescript
import {
  createTask,
  listTasks,
  updateTask,
  moveTask,
  archiveTask,
  readTaskBody,
  readTaskRaw,
  writeTaskRaw,
  resolveTaskPath,
  initTaskDirs,
} from "@grove/runtime";

// Create a new task in the backlog
const task = await createTask(workspacePath, "My new task");

// List all tasks
const tasks = await listTasks(workspacePath);

// Update task frontmatter
const updated = await updateTask(workspacePath, filePath, {
  title: "New title",
});

// Move task to another status
const moved = await moveTask(workspacePath, filePath, "doing");

// Archive task (soft delete)
await archiveTask(workspacePath, filePath);

// Read task body (not truncated)
const body = await readTaskBody(workspacePath, filePath);

// Read raw markdown file
const raw = await readTaskRaw(workspacePath, filePath);

// Write raw markdown file
const result = await writeTaskRaw(workspacePath, filePath, rawContent);

// Resolve task path from ID
const path = await resolveTaskPath(workspacePath, "T-001");
```

### Worktree Operations

```typescript
import {
  createWorktreeForTask,
  teardownWorktreeForTask,
  listWorktrees,
  detectWorktreeBaseBranch,
  listBranches,
  getDiff,
  getFileDiff,
  readFileAtBranch,
  deriveBranchName,
  WorktreeError,
} from "@grove/runtime";

// Create a worktree for a task
const result = await createWorktreeForTask(workspacePath, taskId, taskTitle);

// Remove worktree
await teardownWorktreeForTask(workspacePath, worktreePath);

// List all worktrees
const worktrees = await listWorktrees(repoPath);

// Get diff summary
const diff = await getDiff(worktreePath, baseBranch);

// Get file diff
const fileDiff = await getFileDiff(worktreePath, baseBranch, "src/main.ts");

// Read file from branch
const content = await readFileAtBranch(repoPath, "main", "src/main.ts");
```

### Execution Operations

```typescript
import { AgentRunner } from "@grove/runtime";

const runner = new AgentRunner();

// Run an agent
runner.run(
  taskId,
  "execute",
  "opencode",
  null,
  message,
  displayMessage,
  sessionId,
  cwd,
  taskFilePath,
  workspacePath,
);

// Check if tmux is available
const available = await runner.isTmuxAvailable();

// Cancel a run
runner.cancel(`${mode}:${taskId}`, workspacePath);

// List available models
const models = await runner.listModels(workspacePath);

// Reconnect to a session
const result = await runner.reconnectTmuxSession(
  tmuxSession,
  taskId,
  mode,
  agent,
);
```

### Session Management

```typescript
import {
  getTaskSession,
  saveTaskSession,
  clearTaskSession,
} from "@grove/runtime";

// Get saved session info
const session = await getTaskSession(workspacePath, taskId, "execute");

// Save session info
await saveTaskSession(
  workspacePath,
  taskId,
  "execute",
  sessionId,
  "opencode",
  null,
);

// Clear session info
await clearTaskSession(workspacePath, taskId, "execute");
```

## Architecture

```
src/runtime/
├── index.ts              # Public API exports
├── fileWriter.ts         # Atomic file write utilities
├── taskService.ts        # Task CRUD operations
├── gitService.ts         # Git and worktree operations
├── agentOutputParser.ts  # Parse agent JSON output
├── contextGenerator.ts   # Generate CONTEXT.md for worktrees
├── tmuxService.ts        # Tmux session management
├── agentService.ts       # Agent execution (spawn or tmux)
└── sessionService.ts     # Session persistence
```

## Testing

Runtime tests are in `src/runtime/__tests__/` and run with vitest without Electron:

```bash
npm test
```

## Usage in Electron

The main process imports runtime modules directly:

```typescript
import { createTask } from "../runtime/taskService";
import { AgentRunner } from "../runtime/agentService";
```

## Usage in Future CLI

The CLI will import runtime as a library:

```typescript
import { createTask, listTasks } from "grove-runtime";
```
