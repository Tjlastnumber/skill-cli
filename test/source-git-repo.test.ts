import { describe, expect, it } from "vitest";

import { canonicalizeGitRepository, describeGitRepository } from "../src/core/source/git-repo.js";

describe("canonicalizeGitRepository", () => {
  it("normalizes trailing slashes on equivalent HTTPS repository URLs", () => {
    expect(canonicalizeGitRepository("https://github.com/acme/skills.git")).toBe(
      "github.com/acme/skills",
    );
    expect(canonicalizeGitRepository("https://github.com/acme/skills.git/")).toBe(
      "github.com/acme/skills",
    );
  });

  it("drops default HTTPS ports from equivalent repository URLs", () => {
    expect(canonicalizeGitRepository("https://github.com:443/acme/skills.git")).toBe(
      "github.com/acme/skills",
    );
  });
});

describe("describeGitRepository", () => {
  it("derives the bundle name from the normalized repository path", () => {
    expect(describeGitRepository("https://github.com:443/acme/skills.git/")).toEqual({
      canonical: "github.com/acme/skills",
      bundleName: "skills",
    });
  });
});
