import * as path from "path";
import * as taskService from "../../runtime/taskService.js";
import { resolveWorkspace, getWorkspaces } from "../workspace.js";

interface ListOptions {
  workspace?: string;
}

async function listCommand(options: ListOptions): Promise<void> {
  const wsResult = resolveWorkspace(options.workspace || null);
  if (!wsResult.ok) {
    console.error(`[Error] ${wsResult.error}`);
    process.exit(wsResult.code);
  }
  const workspace = wsResult.workspace;

  console.log(`[grove] Workspace: ${workspace.path}\n`);

  const tasks = await taskService.scanTasks(workspace.path);

  if (tasks.length === 0) {
    console.log("No tasks found.");
    return;
  }

  const statusWidth = 8;
  const idWidth = 8;
  const titleWidth = 40;

  console.log(
    `${"ID".padEnd(idWidth)} ${"Status".padEnd(statusWidth)} ${"Title".slice(0, titleWidth)}`,
  );
  console.log(
    `${"".padEnd(idWidth, "-")} ${"".padEnd(statusWidth, "-")} ${"".padEnd(titleWidth, "-")}`,
  );

  for (const task of tasks) {
    const id = task.id.padEnd(idWidth);
    const status = task.status.padEnd(statusWidth);
    const title = task.title.slice(0, titleWidth);
    console.log(`${id} ${status} ${title}`);
  }

  console.log(`\nTotal: ${tasks.length} tasks`);

  const backlogCount = tasks.filter((t) => t.status === "backlog").length;
  const doingCount = tasks.filter((t) => t.status === "doing").length;
  const reviewCount = tasks.filter((t) => t.status === "review").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  console.log(
    `  backlog: ${backlogCount}  doing: ${doingCount}  review: ${reviewCount}  done: ${doneCount}`,
  );
}

export { listCommand };
