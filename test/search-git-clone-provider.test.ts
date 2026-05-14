import { describe, expect, it, vi } from "vitest";

import { SourceError } from "../src/core/errors.js";
import { GitCloneSearchProvider } from "../src/core/search/providers/git-clone.js";

describe("GitCloneSearchProvider", () => {
  it("clones from the parsed clone URL, discovers local skills, and cleans up the temp directory", async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const discoverLocalSearchSkills = vi.fn().mockResolvedValue([
      {
        skillName: "reviewer",
        description: "Reviews changes",
        path: "skills/reviewer/SKILL.md",
      },
    ]);
    const cleanupTempDir = vi.fn().mockResolvedValue(undefined);

    const provider = new GitCloneSearchProvider({
      createTempDir: async () => "/tmp/skill-cli-search-provider",
      cleanupTempDir,
      runCommand,
      discoverLocalSearchSkills,
    });

    await expect(provider.search({
      raw: "git@github.com:acme/private-skills.git",
      cloneUrl: "git@github.com:acme/private-skills.git",
      github: {
        owner: "acme",
        repo: "private-skills",
        displayName: "acme/private-skills",
        webUrl: "https://github.com/acme/private-skills",
      },
    })).resolves.toEqual({
      repository: {
        displayName: "acme/private-skills",
        sourceLabel: "git@github.com:acme/private-skills.git",
        webUrl: "https://github.com/acme/private-skills",
        resolvedBy: "git-clone",
      },
      skills: [
        {
          skillName: "reviewer",
          description: "Reviews changes",
          path: "skills/reviewer/SKILL.md",
        },
      ],
    });

    expect(runCommand).toHaveBeenCalledWith("git", [
      "clone",
      "--depth",
      "1",
      "git@github.com:acme/private-skills.git",
      "/tmp/skill-cli-search-provider",
    ]);
    expect(discoverLocalSearchSkills).toHaveBeenCalledWith("/tmp/skill-cli-search-provider", {
      rootSkillName: "private-skills",
    });
    expect(cleanupTempDir).toHaveBeenCalledWith("/tmp/skill-cli-search-provider");
  });

  it("cleans up the temp directory when local discovery fails", async () => {
    const cleanupTempDir = vi.fn().mockResolvedValue(undefined);

    const provider = new GitCloneSearchProvider({
      createTempDir: async () => "/tmp/skill-cli-search-provider",
      cleanupTempDir,
      runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      discoverLocalSearchSkills: async () => {
        throw new Error("discovery failed");
      },
    });

    await expect(provider.search({
      raw: "https://gitlab.example.com/org/skills.git",
      cloneUrl: "https://gitlab.example.com/org/skills.git",
    })).rejects.toThrow("discovery failed");

    expect(cleanupTempDir).toHaveBeenCalledWith("/tmp/skill-cli-search-provider");
  });

  it("redacts HTTPS clone credentials from clone failure errors", async () => {
    const cleanupTempDir = vi.fn().mockResolvedValue(undefined);

    const provider = new GitCloneSearchProvider({
      createTempDir: async () => "/tmp/skill-cli-search-provider",
      cleanupTempDir,
      runCommand: async () => {
        throw new SourceError(
          "Command failed: git clone --depth 1 https://alice:super-secret@gitlab.example.com/org/skills.git /tmp/skill-cli-search-provider",
          "fatal: could not read Username for 'https://alice:super-secret@gitlab.example.com/org/skills.git': terminal prompts disabled",
        );
      },
    });

    await expect(provider.search({
      raw: "https://alice:super-secret@gitlab.example.com/org/skills.git",
      cloneUrl: "https://alice:super-secret@gitlab.example.com/org/skills.git",
    })).rejects.toMatchObject({
      message: "Command failed: git clone --depth 1 https://gitlab.example.com/org/skills.git /tmp/skill-cli-search-provider",
      suggestion: "fatal: could not read Username for 'https://gitlab.example.com/org/skills.git': terminal prompts disabled",
    });

    await expect(provider.search({
      raw: "https://alice:super-secret@gitlab.example.com/org/skills.git",
      cloneUrl: "https://alice:super-secret@gitlab.example.com/org/skills.git",
    })).rejects.not.toThrow("super-secret");

    expect(cleanupTempDir).toHaveBeenCalledWith("/tmp/skill-cli-search-provider");
  });

  it("uses a credential-free repository label for successful generic HTTPS searches", async () => {
    const provider = new GitCloneSearchProvider({
      createTempDir: async () => "/tmp/skill-cli-search-provider",
      cleanupTempDir: async () => undefined,
      runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      discoverLocalSearchSkills: async () => [
        {
          skillName: "skills",
          description: "Root skill",
          path: "SKILL.md",
        },
      ],
    });

    await expect(provider.search({
      raw: "https://alice:super-secret@gitlab.example.com/org/skills.git",
      cloneUrl: "https://alice:super-secret@gitlab.example.com/org/skills.git",
    })).resolves.toEqual({
      repository: {
        displayName: "gitlab.example.com/org/skills",
        sourceLabel: "gitlab.example.com/org/skills",
        resolvedBy: "git-clone",
      },
      skills: [
        {
          skillName: "skills",
          description: "Root skill",
          path: "SKILL.md",
        },
      ],
    });
  });
});
