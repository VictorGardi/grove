import { describe, it, expect, beforeEach } from "vitest";
import { usePlanStore } from "../usePlanStore";

const SESSION_KEY = "plan:T-001";

/** Initialise a clean session and add an in-flight agent message. */
function setupRunningSession(): void {
  usePlanStore.getState().initSession(SESSION_KEY, "opencode", null, null);
  usePlanStore.getState().startAgentMessage(SESSION_KEY);
}

describe("usePlanStore — state transitions", () => {
  beforeEach(() => {
    usePlanStore.getState().clearSession(SESSION_KEY);
  });

  // ── startAgentMessage ──────────────────────────────────────────────────────

  describe("startAgentMessage", () => {
    it("sets isRunning to true", () => {
      usePlanStore.getState().initSession(SESSION_KEY, "opencode", null, null);
      usePlanStore.getState().startAgentMessage(SESSION_KEY);
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.isRunning).toBe(
        true,
      );
    });

    it("adds an agent message bubble with isStreaming: true", () => {
      usePlanStore.getState().initSession(SESSION_KEY, "opencode", null, null);
      usePlanStore.getState().startAgentMessage(SESSION_KEY);
      const session = usePlanStore.getState().sessions[SESSION_KEY];
      const last = session?.messages[session.messages.length - 1];
      expect(last?.role).toBe("agent");
      expect(last?.isStreaming).toBe(true);
    });

    it("does not add a duplicate bubble if the last message is already an agent message", () => {
      usePlanStore.getState().initSession(SESSION_KEY, "opencode", null, null);
      usePlanStore.getState().startAgentMessage(SESSION_KEY);
      usePlanStore.getState().startAgentMessage(SESSION_KEY);
      const messages = usePlanStore.getState().sessions[SESSION_KEY]?.messages;
      expect(messages?.filter((m) => m.role === "agent").length).toBe(1);
    });
  });

  // ── applyChunk — done ──────────────────────────────────────────────────────

  describe("applyChunk — done", () => {
    it("clears isRunning when exit code is 0", () => {
      setupRunningSession();
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "done", content: "0" });
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.isRunning).toBe(
        false,
      );
    });

    it("sets lastExitCode to 0 on clean exit", () => {
      setupRunningSession();
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "done", content: "0" });
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.lastExitCode).toBe(
        0,
      );
    });

    it("clears isRunning when exit code is 1", () => {
      setupRunningSession();
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "done", content: "1" });
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.isRunning).toBe(
        false,
      );
    });

    it("sets lastExitCode to 1 on non-zero exit", () => {
      setupRunningSession();
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "done", content: "1" });
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.lastExitCode).toBe(
        1,
      );
    });

    it("sets lastExitCode to null when content is not a valid integer", () => {
      setupRunningSession();
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "done", content: "null" });
      expect(
        usePlanStore.getState().sessions[SESSION_KEY]?.lastExitCode,
      ).toBeNull();
    });

    it("marks the last message as no longer streaming", () => {
      setupRunningSession();
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "done", content: "0" });
      const session = usePlanStore.getState().sessions[SESSION_KEY];
      const last = session?.messages[session.messages.length - 1];
      expect(last?.isStreaming).toBe(false);
    });

    it("resets sessionStatus to idle (clears the reconnected banner)", () => {
      setupRunningSession();
      usePlanStore.getState().setSessionStatus(SESSION_KEY, "running");
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "done", content: "0" });
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.sessionStatus).toBe(
        "idle",
      );
    });
  });

  // ── applyChunk — error ─────────────────────────────────────────────────────

  describe("applyChunk — error", () => {
    it("clears isRunning", () => {
      setupRunningSession();
      usePlanStore.getState().applyChunk(SESSION_KEY, {
        type: "error",
        content: "Something went wrong",
      });
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.isRunning).toBe(
        false,
      );
    });

    it("sets lastExitCode to 1 so the board card shows 'session failed'", () => {
      setupRunningSession();
      usePlanStore.getState().applyChunk(SESSION_KEY, {
        type: "error",
        content: "Something went wrong",
      });
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.lastExitCode).toBe(
        1,
      );
    });

    it("appends the error message to the last agent bubble", () => {
      setupRunningSession();
      usePlanStore.getState().applyChunk(SESSION_KEY, {
        type: "error",
        content: "oh no",
      });
      const session = usePlanStore.getState().sessions[SESSION_KEY];
      const last = session?.messages[session.messages.length - 1];
      expect(last?.text).toContain("Error: oh no");
    });

    it("marks the last message as no longer streaming", () => {
      setupRunningSession();
      usePlanStore.getState().applyChunk(SESSION_KEY, {
        type: "error",
        content: "oh no",
      });
      const session = usePlanStore.getState().sessions[SESSION_KEY];
      const last = session?.messages[session.messages.length - 1];
      expect(last?.isStreaming).toBe(false);
    });
  });

  // ── applyChunk — text (streaming re-assertion) ─────────────────────────────

  describe("applyChunk — text", () => {
    it("appends text content to the agent bubble", () => {
      setupRunningSession();
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "text", content: "hello" });
      const session = usePlanStore.getState().sessions[SESSION_KEY];
      const last = session?.messages[session.messages.length - 1];
      expect(last?.text).toBe("hello");
    });

    it("keeps isRunning true while text chunks arrive", () => {
      setupRunningSession();
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "text", content: "hello" });
      expect(usePlanStore.getState().sessions[SESSION_KEY]?.isRunning).toBe(
        true,
      );
    });
  });

  // ── applyChunk — guard: no-op when no agent message ───────────────────────

  describe("applyChunk — guard", () => {
    it("is a no-op when the last message is not an agent message", () => {
      usePlanStore.getState().initSession(SESSION_KEY, "opencode", null, null);
      usePlanStore.getState().appendUserMessage(SESSION_KEY, "hello");
      const before = usePlanStore.getState().sessions[SESSION_KEY];
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "text", content: "response" });
      const after = usePlanStore.getState().sessions[SESSION_KEY];
      // State should be unchanged
      expect(after?.messages).toEqual(before?.messages);
      expect(after?.isRunning).toBe(before?.isRunning);
    });

    it("is a no-op when there are no messages at all", () => {
      usePlanStore.getState().initSession(SESSION_KEY, "opencode", null, null);
      const before = usePlanStore.getState().sessions[SESSION_KEY];
      usePlanStore
        .getState()
        .applyChunk(SESSION_KEY, { type: "text", content: "response" });
      const after = usePlanStore.getState().sessions[SESSION_KEY];
      expect(after?.messages).toEqual(before?.messages);
    });
  });

  // ── applyChunk — tokens ────────────────────────────────────────────────────

  describe("applyChunk — tokens", () => {
    it("accumulates totalTokens without touching isRunning", () => {
      setupRunningSession();
      const tokenChunk = {
        type: "tokens" as const,
        content: "",
        data: {
          total: 42,
          input: 10,
          output: 32,
          reasoning: 0,
          cache: { write: 0, read: 0 },
        },
      };
      usePlanStore.getState().applyChunk(SESSION_KEY, tokenChunk);
      const session = usePlanStore.getState().sessions[SESSION_KEY];
      expect(session?.totalTokens).toBe(42);
      // isRunning must not have been clobbered by the fall-through path
      expect(session?.isRunning).toBe(true);
    });
  });
});
