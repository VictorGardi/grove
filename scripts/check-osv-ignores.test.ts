import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error plain .mjs script without types
import { checkIgnores } from "./check-osv-ignores.mjs";

describe("check-osv-ignores", () => {
  it("accepts an empty list and comments only", () => {
    expect(checkIgnores("# nothing here\n")).toEqual([]);
  });

  it("accepts a complete entry", () => {
    const toml = `[[IgnoredVulns]]
id = "GHSA-aaaa-bbbb-cccc"
ignoreUntil = 2027-01-31
reason = "No fix exists"
`;
    expect(checkIgnores(toml)).toEqual([]);
  });

  it("rejects an entry missing ignoreUntil", () => {
    const toml = `[[IgnoredVulns]]
id = "GHSA-aaaa-bbbb-cccc"
reason = "No fix exists"
`;
    expect(checkIgnores(toml)).toEqual(["[[IgnoredVulns]] GHSA-aaaa-bbbb-cccc: missing ignoreUntil"]);
  });

  it("rejects an entry missing reason", () => {
    const toml = `[[IgnoredVulns]]
id = "GHSA-aaaa-bbbb-cccc"
ignoreUntil = 2027-01-31
`;
    expect(checkIgnores(toml)).toEqual(["[[IgnoredVulns]] GHSA-aaaa-bbbb-cccc: missing reason"]);
  });

  it("checks every entry, including one that follows a valid one", () => {
    const toml = `[[IgnoredVulns]]
id = "GHSA-1"
ignoreUntil = 2027-01-31
reason = "ok"

[[IgnoredVulns]]
id = "GHSA-2"
`;
    expect(checkIgnores(toml)).toHaveLength(2);
  });

  it("passes for the committed osv-scanner.toml", () => {
    const file = path.resolve(__dirname, "..", "osv-scanner.toml");
    expect(checkIgnores(fs.readFileSync(file, "utf8"))).toEqual([]);
  });
});
