import type { TaskInfo } from "@shared/types";

// ── Prompt builders ───────────────────────────────────────────────

export function buildFirstPlanMessage(
  task: TaskInfo,
  userText: string,
  taskRawContent: string,
): string {
  const absolutePath = task.filePath;

  return `You are a planning assistant for a software task.

## Task

ID: ${task.id}
Title: ${task.title}
File: ${absolutePath}

## Current Task Content

${taskRawContent}

## Your Role

You are helping a developer plan and define this task — NOT implement it.

Rules:
- Do NOT write any code.
- Do NOT create, delete, or modify any file except the task markdown at the path above.
- Do NOT run shell commands that read or modify the codebase.
- You may use read-only tools (read file, search) to understand the codebase if needed.
- Only update the "## Description" and "## Definition of Done" sections of the task file when the plan is agreed upon.
- Ask clarifying questions freely. The user will respond in this same session.
- Before writing to the task file, spawn a senior software engineer subagent to critically review the proposed plan. The subagent should verify: Are the DoD items testable and specific? Are there missing edge cases? Is the scope appropriate? Only write to the file if the review passes or the raised issues are addressed.

## User's Request

${userText}`;
}

export function buildFirstExecutionMessage(
  task: TaskInfo,
  taskRawContent: string,
): string {
  return `You are an execution agent for a software task.

## Task

ID: ${task.id}
Title: ${task.title}
File: ${task.filePath}

## Current Task Content

${taskRawContent}

## Your Role

Work through the task's Definition of Done checkboxes systematically:

1. Read the task description carefully and understand the full scope.
2. Implement the required changes in the codebase.
3. After completing each DoD item, update the task file at the path above to check it off.
4. When all items are complete, verify your work against the acceptance criteria.

You have full access to read files, write files, and run shell commands. Work autonomously through the entire Definition of Done without waiting for confirmation unless you encounter a genuine blocker.

IMPORTANT: After you have checked off all DoD items in the task file, BEFORE stopping your execution (exiting the session), you MUST spawn a senior software engineer subagent to review your code changes. Use the subagent to:

1. Review the actual code changes (via \`git diff\` or equivalent)
2. Verify each DoD item was genuinely implemented (not just checked off)
3. Check for edge cases and code quality issues
4. Address any issues found before stopping

You may run up to 2 review cycles to avoid infinite loops. Only stop (exit) your session after the review passes or all raised issues are addressed.`;
}
