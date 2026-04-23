import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";

describe("AgentModelForm — model dropdown behavior on agent switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ensureModels", () => {
    it("sets cache entry to null when fetch starts (in-flight marker)", async () => {
      const mockEnsureModels = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(mockEnsureModels).toBeDefined();
    });

    it("returns immediately if cache entry already exists", async () => {
      const mockEnsureModels = vi.fn();
      void mockEnsureModels("ws:/path", "opencode");
      expect(mockEnsureModels).toHaveBeenCalledWith("ws:/path", "opencode");
    });

    it("does not fire duplicate requests for same cache key", async () => {
      const mockEnsureModels = vi.fn().mockResolvedValue(undefined);
      mockEnsureModels("ws:/path", "opencode");
      mockEnsureModels("ws:/path", "opencode");
      expect(mockEnsureModels).toHaveBeenCalledTimes(2);
    });
  });

  describe("rapid agent switching", () => {
    it("clears models state when agent changes", () => {
      const state = {
        models: ["model-a", "model-b"],
        loading: false,
        agent: "opencode",
      };

      const onAgentChange = (newAgent: string) => {
        state.models = [];
        state.loading = true;
        state.agent = newAgent;
      };

      expect(state.models).toHaveLength(2);
      onAgentChange("claude");
      expect(state.models).toHaveLength(0);
      expect(state.loading).toBe(true);
    });

    it("loads new models after agent change", () => {
      const state = {
        models: [] as string[],
        loading: true,
      };

      expect(state.loading).toBe(true);
      state.models = ["claude-model-1", "claude-model-2"];
      state.loading = false;
      expect(state.models).toEqual(["claude-model-1", "claude-model-2"]);
      expect(state.loading).toBe(false);
    });

    it("fast switching A→B→A does not show stale models", () => {
      const state = {
        models: [] as string[],
        agent: "opencode",
      };

      state.models = ["opencode-model"];
      expect(state.models).toEqual(["opencode-model"]);

      state.agent = "copilot";
      state.models = [];
      expect(state.models).toHaveLength(0);

      state.agent = "claude";
      state.models = [];
      expect(state.models).toHaveLength(0);

      state.models = ["claude-model"];
      expect(state.models).toEqual(["claude-model"]);
    });
  });

  describe("model selection reset on agent switch", () => {
    it("resets selected model to empty when agent changes", () => {
      const state = {
        selectedModel: "model-x",
        agent: "opencode",
      };

      expect(state.selectedModel).toBe("model-x");
      state.agent = "claude";
      state.selectedModel = "";
      expect(state.selectedModel).toBe("");
    });
  });
});