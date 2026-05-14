import { describe, expect, it, vi } from "vitest";

import { SourceError } from "../src/core/errors.js";
import { searchSourceSkills } from "../src/core/search/search-source-skills.js";
import { SearchProviderFallbackError } from "../src/core/search/types.js";

describe("searchSourceSkills", () => {
  it("tries the GitHub API provider first for GitHub sources", async () => {
    const githubProvider = {
      search: vi.fn().mockResolvedValue({
        repository: {
          displayName: "acme/skills",
          sourceLabel: "acme/skills",
          webUrl: "https://github.com/acme/skills",
          resolvedBy: "github-api",
          defaultBranch: "main",
        },
        skills: [],
      }),
    };
    const cloneProvider = { search: vi.fn() };

    await expect(searchSourceSkills("acme/skills", { githubProvider, cloneProvider })).resolves.toEqual({
      repository: {
        displayName: "acme/skills",
        sourceLabel: "acme/skills",
        webUrl: "https://github.com/acme/skills",
        resolvedBy: "github-api",
        defaultBranch: "main",
      },
      skills: [],
    });

    expect(githubProvider.search).toHaveBeenCalledTimes(1);
    expect(cloneProvider.search).not.toHaveBeenCalled();
  });

  it("falls back to clone once on SearchProviderFallbackError and emits one notice", async () => {
    const onFallback = vi.fn();
    const githubProvider = {
      search: vi.fn().mockRejectedValue(new SearchProviderFallbackError("fallback")),
    };
    const cloneProvider = {
      search: vi.fn().mockResolvedValue({
        repository: {
          displayName: "acme/skills",
          sourceLabel: "git@github.com:acme/skills.git",
          webUrl: "https://github.com/acme/skills",
          resolvedBy: "git-clone",
        },
        skills: [],
      }),
    };

    await expect(searchSourceSkills("git@github.com:acme/skills.git", {
      githubProvider,
      cloneProvider,
      onFallback,
    })).resolves.toEqual({
      repository: {
        displayName: "acme/skills",
        sourceLabel: "git@github.com:acme/skills.git",
        webUrl: "https://github.com/acme/skills",
        resolvedBy: "git-clone",
      },
      skills: [],
    });

    expect(githubProvider.search).toHaveBeenCalledTimes(1);
    expect(cloneProvider.search).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith("GitHub API search unavailable, falling back to git clone");
  });

  it("does not fall back on non-fallback GitHub provider errors", async () => {
    const githubProvider = {
      search: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const cloneProvider = { search: vi.fn() };

    await expect(searchSourceSkills("acme/skills", { githubProvider, cloneProvider })).rejects.toThrow("boom");

    expect(cloneProvider.search).not.toHaveBeenCalled();
  });

  it("does not fall back when the GitHub provider rejects with a content validation SourceError", async () => {
    const githubProvider = {
      search: vi.fn().mockRejectedValue(
        new SourceError(
          "Duplicate skill names discovered for tool 'search': reviewer",
          "Use unique parent directory names for SKILL.md files",
        ),
      ),
    };
    const cloneProvider = { search: vi.fn() };
    const onFallback = vi.fn();

    await expect(searchSourceSkills("acme/skills", { githubProvider, cloneProvider, onFallback })).rejects.toMatchObject({
      name: SourceError.name,
      message: "Duplicate skill names discovered for tool 'search': reviewer",
      suggestion: "Use unique parent directory names for SKILL.md files",
    });

    expect(cloneProvider.search).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("routes non-GitHub sources directly to the clone provider", async () => {
    const githubProvider = { search: vi.fn() };
    const cloneProvider = {
      search: vi.fn().mockResolvedValue({
        repository: {
          displayName: "https://gitlab.example.com/org/skills.git",
          sourceLabel: "https://gitlab.example.com/org/skills.git",
          resolvedBy: "git-clone",
        },
        skills: [],
      }),
    };

    await expect(searchSourceSkills("https://gitlab.example.com/org/skills.git", {
      githubProvider,
      cloneProvider,
    })).resolves.toEqual({
      repository: {
        displayName: "https://gitlab.example.com/org/skills.git",
        sourceLabel: "https://gitlab.example.com/org/skills.git",
        resolvedBy: "git-clone",
      },
      skills: [],
    });

    expect(githubProvider.search).not.toHaveBeenCalled();
    expect(cloneProvider.search).toHaveBeenCalledTimes(1);
  });
});
