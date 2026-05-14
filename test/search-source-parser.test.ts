import { describe, expect, it } from "vitest";

import { ExitCode, SkillCliError } from "../src/core/errors.js";
import { parseSearchSource } from "../src/core/search/parse-search-source.js";

describe("parseSearchSource", () => {
  it("parses GitHub owner/repo shorthand", () => {
    expect(parseSearchSource("acme/skills")).toEqual({
      raw: "acme/skills",
      cloneUrl: "https://github.com/acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    });
  });

  it("normalizes owner/repo.git shorthand without duplicating the suffix", () => {
    expect(parseSearchSource("acme/skills.git")).toEqual({
      raw: "acme/skills.git",
      cloneUrl: "https://github.com/acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    });
  });

  it("parses GitHub SSH clone URLs and normalizes the clone suffix in metadata", () => {
    expect(parseSearchSource("git@github.com:acme/skills.git")).toEqual({
      raw: "git@github.com:acme/skills.git",
      cloneUrl: "git@github.com:acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    });
  });

  it("parses GitHub HTTPS repository root URLs", () => {
    expect(parseSearchSource("https://github.com/acme/skills")).toEqual({
      raw: "https://github.com/acme/skills",
      cloneUrl: "https://github.com/acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    });
  });

  it("parses generic HTTPS git clone URLs", () => {
    expect(parseSearchSource("https://git.example.com/acme/skills.git")).toEqual({
      raw: "https://git.example.com/acme/skills.git",
      cloneUrl: "https://git.example.com/acme/skills.git",
    });
  });

  it("parses generic HTTP git clone URLs", () => {
    expect(parseSearchSource("http://git.example.com/acme/skills.git")).toEqual({
      raw: "http://git.example.com/acme/skills.git",
      cloneUrl: "http://git.example.com/acme/skills.git",
    });
  });

  it("treats non-https GitHub .git clone URLs as generic git URLs", () => {
    expect(parseSearchSource("http://github.com/acme/skills.git")).toEqual({
      raw: "http://github.com/acme/skills.git",
      cloneUrl: "http://github.com/acme/skills.git",
    });
  });

  it("parses generic SSH git clone URLs", () => {
    expect(parseSearchSource("git@git.example.com:acme/skills.git")).toEqual({
      raw: "git@git.example.com:acme/skills.git",
      cloneUrl: "git@git.example.com:acme/skills.git",
    });
  });

  it("parses generic git protocol clone URLs", () => {
    expect(parseSearchSource("git://git.example.com/acme/skills.git")).toEqual({
      raw: "git://git.example.com/acme/skills.git",
      cloneUrl: "git://git.example.com/acme/skills.git",
    });
  });

  it("preserves the original raw input exactly", () => {
    expect(parseSearchSource("  acme/skills  ")).toEqual({
      raw: "  acme/skills  ",
      cloneUrl: "https://github.com/acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    });
  });

  it("rejects unsupported search source forms", () => {
    expectInvalidInput("");
    expectInvalidInput("   ");
    expectInvalidInput("./skills");
    expectInvalidInput("../skills");
    expectInvalidInput("/tmp/skills");
    expectInvalidInput("~/skills");
    expectInvalidInput("acme/skills#main");
    expectInvalidInput("acme/.");
    expectInvalidInput("acme/..");
    expectInvalidInput("git@github.com:acme/.git");
    expectInvalidInput("git@github.com:acme/...git");
    expectInvalidInput("@acme/skills");
    expectInvalidInput("https://github.com/acme/skills/tree/main");
    expectInvalidInput("https://github.com/acme");
    expectInvalidInput("not a repo");
  });
});

function expectInvalidInput(input: string): void {
  const error = getThrownError(() => parseSearchSource(input));

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
