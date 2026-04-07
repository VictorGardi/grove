import type { TaskInfo } from "@shared/types";

export const DEFAULT_PLAN_PERSONA = "planning assistant";
export const DEFAULT_PLAN_REVIEW_PERSONA = "senior software engineer";
export const DEFAULT_EXECUTE_PERSONA = "execution agent";
export const DEFAULT_EXECUTE_REVIEW_PERSONA = "senior software engineer";
export const DEFAULT_EXECUTE_REVIEW_INSTRUCTIONS = `IMPORTANT: After you have checked off all DoD items in the task file, BEFORE stopping your execution (exiting the session), you MUST spawn a {executeReviewPersona} subagent to review your code changes. Use the subagent to:

1. Review the actual code changes (via \`git diff\` or equivalent)
2. Verify each DoD item was genuinely implemented (not just checked off)
3. Check for edge cases and code quality issues
4. Address any issues found before stopping

You may run up to 2 review cycles to avoid infinite loops. When spawning the reviewer, follow these rules:

- Spawn a dedicated reviewer subagent ({executeReviewPersona}). Record and increment a numeric \`reviewCycleCount\` in your session state each time you auto-spawn the reviewer.
- The reviewer MUST inspect the actual diffs (for example by running \`git diff\` in the workspace) and verify each DoD item was implemented. The reviewer should list which DoD items are satisfied and which are not, referencing file paths and diff hunks.
- The reviewer MUST emit an explicit session-end event that clearly indicates PASS or FAIL for the review (e.g. \`SESSION-END: PASS\` or \`SESSION-END: FAIL\`). The execution agent should detect this and act accordingly.
- If the reviewer signals FAIL, address the raised issues and you may re-run the reviewer, but stop auto-spawning after \`reviewCycleCount == 2\`.

Only stop (exit) your session after the reviewer emits a PASS or after you have exhausted the allowed review cycles and have no further automated actions to take.`;

export interface PromptConfig {
  planPersona?: string;
  planReviewPersona?: string;
  executePersona?: string;
  executeReviewPersona?: string;
  executeReviewInstructions?: string;
}

function resolvePersona(
  value: string | undefined,
  defaultValue: string,
): string {
  return value && value.trim() ? value.trim() : defaultValue;
}

function replacePersonaPlaceholder(
  text: string,
  key: string,
  persona: string,
): string {
  return text.split(`{${key}}`).join(persona);
}

// ── Prompt builders ───────────────────────────────────────────────

export function buildFirstPlanMessage(
  task: TaskInfo,
  userText: string,
  taskRawContent: string,
  prompts?: PromptConfig,
): string {
  const absolutePath = task.filePath;
  const planPersona = resolvePersona(
    prompts?.planPersona,
    DEFAULT_PLAN_PERSONA,
  );
  const planReviewPersona = resolvePersona(
    prompts?.planReviewPersona,
    DEFAULT_PLAN_REVIEW_PERSONA,
  );

  return `You are a ${planPersona} for a software task.

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
- Before writing to the task file, spawn a ${planReviewPersona} subagent to critically review the proposed plan. The subagent should verify: Are the DoD items testable and specific? Are there missing edge cases? Is the scope appropriate? Only write to the file if the review passes or the raised issues are addressed.

## User's Request

${userText}`;
}

export function buildFirstExecutionMessage(
  task: TaskInfo,
  taskRawContent: string,
  prompts?: PromptConfig,
): string {
  const executePersona = resolvePersona(
    prompts?.executePersona,
    DEFAULT_EXECUTE_PERSONA,
  );
  const executeReviewPersona = resolvePersona(
    prompts?.executeReviewPersona,
    DEFAULT_EXECUTE_REVIEW_PERSONA,
  );
  let executeReviewInstructions = resolvePersona(
    prompts?.executeReviewInstructions,
    DEFAULT_EXECUTE_REVIEW_INSTRUCTIONS,
  );
  executeReviewInstructions = replacePersonaPlaceholder(
    executeReviewInstructions,
    "executeReviewPersona",
    executeReviewPersona,
  );

  return `You are an ${executePersona} for a software task.

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

${executeReviewInstructions}`;
}
