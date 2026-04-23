import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { nextTaskId, createTask } from "../tasks";

describe("nextTaskId", () => {
  let tempDir1: string;
  let tempDir2: string;

  beforeEach(async () => {
    // Create two isolated temp workspace directories
    tempDir1 = fs.mkdtempSync(path.join("/tmp", "grove-test-ws1-"));
    tempDir2 = fs.mkdtempSync(path.join("/tmp", "grove-test-ws2-"));
  });

  afterEach(async () => {
    // Clean up temp directories
    fs.rmSync(tempDir1, { recursive: true, force: true });
    fs.rmSync(tempDir2, { recursive: true, force: true });
  });

  it("fresh workspace starts at T-001", async () => {
    const id = await nextTaskId(tempDir1);
    expect(id).toBe("T-001");
  });

  it("sequential creates increment correctly (T-001, T-002, T-003)", async () => {
    const id1 = await nextTaskId(tempDir1);
    const id2 = await nextTaskId(tempDir1);
    const id3 = await nextTaskId(tempDir1);
    expect(id1).toBe("T-001");
    expect(id2).toBe("T-002");
    expect(id3).toBe("T-003");
  });

  it("existing tasks with higher IDs are respected (if T-072 exists, next is T-073)", async () => {
    // Create a task file with ID T-072 in workspace 1
    const tasksDir = path.join(tempDir1, ".grove", "tasks", "backlog");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(tasksDir, "T-072.md"),
      "---\nid: T-072\ntitle: existing task\nstatus: backlog\n---\n",
    );
    const id = await nextTaskId(tempDir1);
    expect(id).toBe("T-073");
  });

  it("two workspaces are isolated (workspace A at T-072, fresh workspace B starts at T-001)", async () => {
    // Push workspace A counter to T-072
    for (let i = 0; i < 72; i++) {
      await nextTaskId(tempDir1);
    }
    const lastA = await nextTaskId(tempDir1);
    expect(lastA).toBe("T-073");

    // Fresh workspace B should start at T-001
    const firstB = await nextTaskId(tempDir2);
    expect(firstB).toBe("T-001");
  });

  it("rapid successive creates within the same workspace don't produce duplicates", async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, () => nextTaskId(tempDir1)),
    );
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    // All should be sequential starting from T-001
    const expected = Array.from(
      { length: 10 },
      (_, i) => `T-${String(i + 1).padStart(3, "0")}`,
    );
    expect(ids.sort()).toEqual(expected.sort());
  });
});

describe("createTask", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join("/tmp", "grove-test-create-"));
  });

  afterEach(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates tasks with sequential IDs", async () => {
    const task1 = await createTask(tempDir, "First task");
    const task2 = await createTask(tempDir, "Second task");
    const task3 = await createTask(tempDir, "Third task");
    expect(task1.id).toBe("T-001");
    expect(task2.id).toBe("T-002");
    expect(task3.id).toBe("T-003");
  });
});
