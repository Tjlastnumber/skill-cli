import { afterEach, describe, expect, it, vi } from "vitest";

import * as browseCommandModule from "../src/commands/browse.js";
import { runCli } from "../src/cli.js";
import { runBrowseCommand } from "../src/commands/browse.js";

function captureOutput() {
  const logs: string[] = [];
  return {
    output: {
      info: (message: string) => logs.push(`INFO:${message}`),
      warn: (message: string) => logs.push(`WARN:${message}`),
      error: (message: string) => logs.push(`ERROR:${message}`),
    },
    logs,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("runBrowseCommand", () => {
  it("prints the approved repository header and indented skill blocks", async () => {
    const capture = captureOutput();

    await runBrowseCommand(
      { repositoryUrl: "https://github.com/acme/skills" },
      {
        output: capture.output,
        browser: async () => ({
          repository: {
            displayName: "acme/skills",
            webUrl: "https://github.com/acme/skills",
            summary: "A public collection of coding skills",
            defaultBranch: "main",
          },
          skills: [
            {
              skillName: "alpha-skill",
              description: "Alpha summary",
              path: "skills/alpha-skill/SKILL.md",
            },
            {
              skillName: "beta-skill",
              description: "Beta summary",
              path: "skills/beta-skill/SKILL.md",
            },
          ],
        }),
      },
    );

    expect(capture.logs).toEqual([
      "INFO:Repository: acme/skills",
      "INFO:Default branch: main",
      "INFO:Skills: 2",
      "INFO:",
      "INFO:  alpha-skill",
      "INFO:    description: Alpha summary",
      "INFO:    path: skills/alpha-skill/SKILL.md",
      "INFO:",
      "INFO:  beta-skill",
      "INFO:    description: Beta summary",
      "INFO:    path: skills/beta-skill/SKILL.md",
    ]);
  });

  it("applies a case-insensitive substring filter over name, description, and path", async () => {
    const capture = captureOutput();

    await runBrowseCommand(
      {
        repositoryUrl: "https://github.com/acme/skills",
        filter: "BETA",
      },
      {
        output: capture.output,
        browser: async () => ({
          repository: {
            displayName: "acme/skills",
            webUrl: "https://github.com/acme/skills",
            summary: "A public collection of coding skills",
            defaultBranch: "trunk",
          },
          skills: [
            {
              skillName: "alpha-skill",
              description: "Alpha summary",
              path: "skills/alpha-skill/SKILL.md",
            },
            {
              skillName: "gamma-skill",
              description: "Useful for beta workflows",
              path: "skills/gamma-skill/SKILL.md",
            },
          ],
        }),
      },
    );

    expect(capture.logs).toContain("INFO:Skills: 1");
    expect(capture.logs).toContain("INFO:  gamma-skill");
    expect(capture.logs).not.toContain("INFO:  alpha-skill");
  });

  it("prints a no-skills message when the repository contains no skills", async () => {
    const capture = captureOutput();

    await runBrowseCommand(
      { repositoryUrl: "https://github.com/acme/skills" },
      {
        output: capture.output,
        browser: async () => ({
          repository: {
            displayName: "acme/skills",
            webUrl: "https://github.com/acme/skills",
            summary: "A public collection of coding skills",
            defaultBranch: "main",
          },
          skills: [],
        }),
      },
    );

    expect(capture.logs).toEqual([
      "INFO:Repository: acme/skills",
      "INFO:Default branch: main",
      "INFO:Skills: 0",
      "INFO:",
      "INFO:No skills found in repository",
    ]);
  });

  it("prints a no-match message when the filter excludes all skills", async () => {
    const capture = captureOutput();

    await runBrowseCommand(
      {
        repositoryUrl: "https://github.com/acme/skills",
        filter: "delta",
      },
      {
        output: capture.output,
        browser: async () => ({
          repository: {
            displayName: "acme/skills",
            webUrl: "https://github.com/acme/skills",
            summary: "A public collection of coding skills",
            defaultBranch: "main",
          },
          skills: [
            {
              skillName: "alpha-skill",
              description: "Alpha summary",
              path: "skills/alpha-skill/SKILL.md",
            },
          ],
        }),
      },
    );

    expect(capture.logs).toEqual([
      "INFO:Repository: acme/skills",
      "INFO:Default branch: main",
      "INFO:Skills: 0",
      "INFO:",
      "INFO:No skills matched filter: delta",
    ]);
  });
});

describe("runCli browse", () => {
  it("registers the browse command and passes the filter option through", async () => {
    const runBrowseCommandSpy = vi
      .spyOn(browseCommandModule, "runBrowseCommand")
      .mockResolvedValue({
        repository: {
          displayName: "acme/skills",
          webUrl: "https://github.com/acme/skills",
          summary: "A public collection of coding skills",
          defaultBranch: "main",
        },
        skills: [],
      });

    await runCli(["node", "skill", "browse", "https://github.com/acme/skills", "--filter", "beta"]);

    expect(runBrowseCommandSpy).toHaveBeenCalledTimes(1);
    expect(runBrowseCommandSpy).toHaveBeenCalledWith({
      repositoryUrl: "https://github.com/acme/skills",
      filter: "beta",
    });
  });
});
