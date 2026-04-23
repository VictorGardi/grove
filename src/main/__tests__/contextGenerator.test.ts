import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// We test generateContextFile by mocking atomicWrite and the fs reads,
// and then asserting the generated content.

// Mock the atomicWrite utility before importing contextGenerator
vi.mock("../fileWriter", () => ({
  atomicWrite: vi.fn().mockResolvedValue(undefined),
}));

import { generateContextFile } from "../contextGenerator";
import { atomicWrite } from "../fileWriter";
import type { TaskInfo } from "@shared/types";

function makeTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "T-001",
    title: "Test Task",
    status: "doing",
    agent: null,
    worktree: ".worktrees/T-001",
    branch: "feat/t-001-test-task",
    created: "2026-04-03",
    tags: [],
    decisions: [],
    description: "A task description",
    dodTotal: 0,
    dodDone: 0,
    filePath: ".grove/tasks/doing/T-001-test-task.md",
    workspacePath: "/test/workspace",
    useWorktree: true,
    planSessionId: null,
    planSessionAgent: null,
    planModel: null,
    execSessionId: null,
    execSessionAgent: null,
    execModel: null,
    terminalPlanSession: null,
    terminalExecSession: null,
    terminalExecContextSent: false,
    planLastExitCode: null,
    execLastExitCode: null,
    completed: null,
    ...overrides,
  };
}

const BODY_WITH_SECTIONS = `
## Description

This is the description.

## Definition of Done

- [x] First item done
- [ ] Second item todo

## Context for agent

Some context for the agent.
`.trim();

describe("generateContextFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grove-test-"));
    vi.mocked(atomicWrite).mockClear();
  });

  it("writes CONTEXT.md with task metadata", async () => {
    const task = makeTask();
    await generateContextFile(tmpDir, task, BODY_WITH_SECTIONS, tmpDir);

    expect(atomicWrite).toHaveBeenCalledOnce();
    const [filePath, content] = vi.mocked(atomicWrite).mock.calls[0] as [
      string,
      string,
    ];

    expect(filePath).toBe(path.join(tmpDir, "CONTEXT.md"));
    expect(content).toContain("# Task Context: Test Task");
    expect(content).toContain("**ID:** T-001");
    expect(content).toContain("**Branch:** feat/t-001-test-task");
  });

  it("includes description section content", async () => {
    const task = makeTask();
    await generateContextFile(tmpDir, task, BODY_WITH_SECTIONS, tmpDir);

    const [, content] = vi.mocked(atomicWrite).mock.calls[0] as [
      string,
      string,
    ];
    expect(content).toContain("This is the description.");
  });

  it("includes DoD checklist with correct checked state", async () => {
    const task = makeTask();
    await generateContextFile(tmpDir, task, BODY_WITH_SECTIONS, tmpDir);

    const [, content] = vi.mocked(atomicWrite).mock.calls[0] as [
      string,
      string,
    ];
    expect(content).toContain("- [x] First item done");
    expect(content).toContain("- [ ] Second item todo");
  });

  it("includes context for agent section", async () => {
    const task = makeTask();
    await generateContextFile(tmpDir, task, BODY_WITH_SECTIONS, tmpDir);

    const [, content] = vi.mocked(atomicWrite).mock.calls[0] as [
      string,
      string,
    ];
    expect(content).toContain("Some context for the agent.");
  });

  it("falls back to (no description provided) when body is empty", async () => {
    const task = makeTask({ description: "" });
    await generateContextFile(tmpDir, task, "", tmpDir);

    const [, content] = vi.mocked(atomicWrite).mock.calls[0] as [
      string,
      string,
    ];
    expect(content).toContain("(no description provided)");
  });

  it("omits linked decisions section when task has no decisions", async () => {
    const task = makeTask({ decisions: [] });
    await generateContextFile(tmpDir, task, BODY_WITH_SECTIONS, tmpDir);

    const [, content] = vi.mocked(atomicWrite).mock.calls[0] as [
      string,
      string,
    ];
    expect(content).not.toContain("## Linked Decisions");
  });

  it("renders decision not-found note when decision file is missing", async () => {
    const task = makeTask({ decisions: ["D-999"] });
    // workspacePath has no .grove/decisions/ dir, so file lookup will fail
    await generateContextFile(tmpDir, task, BODY_WITH_SECTIONS, tmpDir);

    const [, content] = vi.mocked(atomicWrite).mock.calls[0] as [
      string,
      string,
    ];
    expect(content).toContain("## Linked Decisions");
    expect(content).toContain("D-999");
    expect(content).toContain("Decision file not found");
  });

  it("includes the generation date in the header", async () => {
    const task = makeTask();
    const before = new Date().getFullYear().toString();
    await generateContextFile(tmpDir, task, "", tmpDir);

    const [, content] = vi.mocked(atomicWrite).mock.calls[0] as [
      string,
      string,
    ];
    expect(content).toContain(before);
    expect(content).toContain("Generated by Grove on");
  });
});
