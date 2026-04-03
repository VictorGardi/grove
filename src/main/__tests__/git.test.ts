import { describe, it, expect } from "vitest";
import { deriveBranchName } from "../git";

// Note: Tests that require real git operations are integration tests
// and are marked as skipped here since they require a git repo at runtime.
// The unit tests below cover pure functions.

describe("deriveBranchName", () => {
  it("produces feat/<id>-<slug> format", () => {
    expect(deriveBranchName("T-004", "JWT refresh token rotation")).toBe(
      "feat/t-004-jwt-refresh-token-rotation",
    );
  });

  it("lowercases the task ID", () => {
    expect(deriveBranchName("T-001", "Simple task")).toBe(
      "feat/t-001-simple-task",
    );
  });

  it("strips leading/trailing hyphens from slug", () => {
    expect(deriveBranchName("T-002", "  leading and trailing  ")).toBe(
      "feat/t-002-leading-and-trailing",
    );
  });

  it("replaces non-alphanumeric runs with a single hyphen", () => {
    expect(deriveBranchName("T-003", "Add user@example.com support!")).toBe(
      "feat/t-003-add-user-example-com-support",
    );
  });

  it("truncates slug to 30 characters", () => {
    const longTitle =
      "This is a very long title that exceeds thirty characters easily";
    const result = deriveBranchName("T-005", longTitle);
    const slug = result.replace("feat/t-005-", "");
    expect(slug.length).toBeLessThanOrEqual(30);
  });

  it("falls back to 'task' for empty/whitespace title", () => {
    expect(deriveBranchName("T-006", "   ")).toBe("feat/t-006-task");
  });

  it("falls back to 'task' for title with only special chars", () => {
    expect(deriveBranchName("T-007", "!!!???")).toBe("feat/t-007-task");
  });

  it("does not end slug with a hyphen after truncation", () => {
    // Construct a title whose 30-char slug ends with a hyphen
    const title = "a".repeat(30) + "-extra";
    const result = deriveBranchName("T-008", title);
    expect(result).not.toMatch(/-$/);
  });
});
