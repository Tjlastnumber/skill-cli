import { describe, expect, it } from "vitest";

import { ExitCode, SkillCliError } from "../src/core/errors.js";
import { parseGitHubRepositoryUrl } from "../src/core/github/parse-repository-url.js";

describe("parseGitHubRepositoryUrl", () => {
  it("parses a valid GitHub repository root URL", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/acme/skills")).toEqual({
      owner: "acme",
      repo: "skills",
      displayName: "acme/skills",
      webUrl: "https://github.com/acme/skills",
    });
  });

  it("normalizes a .git suffix to the canonical web URL", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/acme/skills.git")).toEqual({
      owner: "acme",
      repo: "skills",
      displayName: "acme/skills",
      webUrl: "https://github.com/acme/skills",
    });
  });

  it("accepts a trailing slash on the repository root URL", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/acme/skills/")).toEqual({
      owner: "acme",
      repo: "skills",
      displayName: "acme/skills",
      webUrl: "https://github.com/acme/skills",
    });
  });

  it("rejects non-GitHub URLs", () => {
    expectInvalidInput("https://example.com/acme/skills");
  });

  it("rejects repository subpaths", () => {
    expectInvalidInput("https://github.com/acme/skills/tree/main");
  });

  it("rejects malformed double-slash repository paths", () => {
    expectInvalidInput("https://github.com/acme//skills");
  });

  it("rejects incomplete repository URLs", () => {
    expectInvalidInput("https://github.com/acme");
  });

  it("rejects invalid owner names", () => {
    expectInvalidInput("https://github.com/-acme/skills");
    expectInvalidInput("https://github.com/acme-/skills");
    expectInvalidInput("https://github.com/ac_me/skills");
    expectInvalidInput("https://github.com/ac.me/skills");
  });

  it("rejects invalid repository names", () => {
    expectInvalidInput("https://github.com/acme/.git");
    expectInvalidInput("https://github.com/acme/skills%20browser");
  });
});

function expectInvalidInput(input: string): void {
  const error = getThrownError(() => parseGitHubRepositoryUrl(input));

  expect(error).toBeInstanceOf(SkillCliError);
  expect(error).toMatchObject({
    exitCode: ExitCode.USER_INPUT,
  });
}

function getThrownError(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }

  throw new Error("Expected callback to throw");
}
