#!/usr/bin/env node

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { attachCommand } from "./commands/attach.js";
import { listCommand } from "./commands/list.js";
import { execCommand } from "./commands/exec.js";
import { killCommand } from "./commands/kill.js";

const program = new Command();

program
  .name("grove")
  .description("Grove CLI - task orchestration")
  .version("1.0.0");

program
  .command("run [agent] [message]")
  .description("Start a task runtime and launch an interactive agent session")
  .option("-b, --branch <name>", "Create or use a git worktree for the task")
  .option("-t, --task <id>", "Specify existing task ID to run (e.g., T-004)")
  .option("-m, --model <name>", "Specify model to use")
  .option("-w, --workspace <path>", "Workspace path")
  .action(runCommand);

program
  .command("attach <task-id>")
  .description("Attach to an existing running task/session")
  .option("-w, --workspace <path>", "Workspace path")
  .action(attachCommand);

program
  .command("list")
  .description("List tasks")
  .option("-w, --workspace <path>", "Workspace path")
  .action(listCommand);

program
  .command("exec <cmd> [args...]")
  .description("Execute a command in the task's execution environment")
  .option("-t, --task <id>", "Task ID (e.g., T-004)")
  .option("-w, --workspace <path>", "Workspace path")
  .option("--tty", "Allocate a pseudo-TTY for interactive commands")
  .action(execCommand);

program
  .command("kill [task-id]")
  .description("Kill a running task session (container + tmux)")
  .option("-a, --all", "Kill all running sessions")
  .option("-w, --workspace <path>", "Workspace path")
  .action(killCommand);

program.parse(process.argv);
