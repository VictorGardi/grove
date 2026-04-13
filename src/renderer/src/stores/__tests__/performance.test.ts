import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDataStore } from "../useDataStore";

vi.mock("../../hooks/useKeyboardShortcuts", () => ({}));

describe("Task Switcher Performance", () => {
  beforeEach(() => {
    useDataStore.getState().clear();
  });

  it("should cache task metadata to avoid disk read", () => {
    const workspacePath = "/test";
    const testTasks = [{ id: "T-1", title: "Test" }] as any;

    useDataStore.getState().setCachedTasks(workspacePath, testTasks);

    const cached = useDataStore.getState().getCachedTasks(workspacePath);
    expect(cached).toBeDefined();
    expect(cached?.length).toBe(1);
    expect(cached?.[0].id).toBe("T-1");
  });

  it("should return undefined for uncached workspace", () => {
    const cached = useDataStore.getState().getCachedTasks("/uncached");
    expect(cached).toBeUndefined();
  });

  it("should preserve cache across multiple workspaces", () => {
    const testTasks1 = [{ id: "T-1" }] as any;
    const testTasks2 = [{ id: "T-2" }] as any;

    useDataStore.getState().setCachedTasks("/ws1", testTasks1);
    useDataStore.getState().setCachedTasks("/ws2", testTasks2);

    const cached1 = useDataStore.getState().getCachedTasks("/ws1");
    const cached2 = useDataStore.getState().getCachedTasks("/ws2");

    expect(cached1?.length).toBe(1);
    expect(cached1?.[0].id).toBe("T-1");
    expect(cached2?.length).toBe(1);
    expect(cached2?.[0].id).toBe("T-2");
  });
});
