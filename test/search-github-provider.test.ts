import { describe, expect, it } from "vitest";

import { SourceError } from "../src/core/errors.js";
import { GitHubApiSearchProvider } from "../src/core/search/providers/github-api.js";
import { SearchProviderFallbackError } from "../src/core/search/types.js";

describe("GitHubApiSearchProvider", () => {
  it("returns validated skills from GitHub API candidates", async () => {
    const provider = new GitHubApiSearchProvider({
      fetch: async (input) => {
        const url = String(input);

        if (url === "https://api.github.com/repos/acme/skills") {
          return new Response(JSON.stringify({ default_branch: "main", description: "Repository summary" }));
        }

        if (url === "https://api.github.com/repos/acme/skills/git/trees/main?recursive=1") {
          return new Response(JSON.stringify({
            tree: [
              { path: "SKILL.md", type: "blob", sha: "root" },
              { path: "skills/reviewer/SKILL.md", type: "blob", sha: "reviewer" },
              { path: ".claude/skills/linter/SKILL.md", type: "blob", sha: "linter" },
              { path: "skills/invalid/SKILL.md", type: "blob", sha: "invalid" },
              { path: "nested/ignored/SKILL.md", type: "blob", sha: "ignored" },
            ],
          }));
        }

        if (url === "https://api.github.com/repos/acme/skills/git/blobs/root") {
          return new Response(JSON.stringify({
            encoding: "base64",
            content: Buffer.from("---\nname: Different frontmatter name\ndescription: Root skill\n---\n").toString("base64"),
          }));
        }

        if (url === "https://api.github.com/repos/acme/skills/git/blobs/reviewer") {
          return new Response(JSON.stringify({
            encoding: "base64",
            content: Buffer.from("---\nname: Different frontmatter name\ndescription: Reviews changes\n---\n").toString("base64"),
          }));
        }

        if (url === "https://api.github.com/repos/acme/skills/git/blobs/linter") {
          return new Response(JSON.stringify({
            encoding: "base64",
            content: Buffer.from("---\nname: Another frontmatter name\ndescription: Lints changes\n---\n").toString("base64"),
          }));
        }

        if (url === "https://api.github.com/repos/acme/skills/git/blobs/invalid") {
          return new Response(JSON.stringify({
            encoding: "base64",
            content: Buffer.from("---\nname: invalid\n---\n").toString("base64"),
          }));
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(provider.search({
      raw: "git@github.com:acme/skills.git",
      cloneUrl: "git@github.com:acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    })).resolves.toEqual({
      repository: {
        displayName: "acme/skills",
        sourceLabel: "git@github.com:acme/skills.git",
        webUrl: "https://github.com/acme/skills",
        resolvedBy: "github-api",
        defaultBranch: "main",
      },
      skills: [
        {
          skillName: "linter",
          description: "Lints changes",
          path: ".claude/skills/linter/SKILL.md",
        },
        {
          skillName: "skills",
          description: "Root skill",
          path: "SKILL.md",
        },
        {
          skillName: "reviewer",
          description: "Reviews changes",
          path: "skills/reviewer/SKILL.md",
        },
      ],
    });
  });

  it("raises a typed fallback signal when the repository is not public", async () => {
    const provider = new GitHubApiSearchProvider({
      fetch: async (input) => {
        const url = String(input);

        if (url === "https://api.github.com/repos/acme/skills") {
          return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(provider.search({
      raw: "acme/skills",
      cloneUrl: "https://github.com/acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    })).rejects.toBeInstanceOf(SearchProviderFallbackError);
  });

  it("raises a typed fallback signal when the GitHub API rate limit is exceeded", async () => {
    const provider = new GitHubApiSearchProvider({
      fetch: async (input) => {
        const url = String(input);

        if (url === "https://api.github.com/repos/acme/skills") {
          return new Response(JSON.stringify({ message: "rate limited" }), {
            status: 403,
            headers: { "x-ratelimit-remaining": "0" },
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(provider.search({
      raw: "acme/skills",
      cloneUrl: "https://github.com/acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    })).rejects.toBeInstanceOf(SearchProviderFallbackError);
  });

  it("fails clearly when final install-compatible skill names collide", async () => {
    const provider = new GitHubApiSearchProvider({
      fetch: async (input) => {
        const url = String(input);

        if (url === "https://api.github.com/repos/acme/skills") {
          return new Response(JSON.stringify({ default_branch: "main", description: "Repository summary" }));
        }

        if (url === "https://api.github.com/repos/acme/skills/git/trees/main?recursive=1") {
          return new Response(JSON.stringify({
            tree: [
              { path: "skills/reviewer/SKILL.md", type: "blob", sha: "reviewer" },
              { path: ".claude/skills/reviewer/SKILL.md", type: "blob", sha: "reviewer-shadow" },
            ],
          }));
        }

        if (url === "https://api.github.com/repos/acme/skills/git/blobs/reviewer") {
          return new Response(JSON.stringify({
            encoding: "base64",
            content: Buffer.from("---\nname: First frontmatter name\ndescription: Reviews changes\n---\n").toString("base64"),
          }));
        }

        if (url === "https://api.github.com/repos/acme/skills/git/blobs/reviewer-shadow") {
          return new Response(JSON.stringify({
            encoding: "base64",
            content: Buffer.from("---\nname: Second frontmatter name\ndescription: Duplicate final name\n---\n").toString("base64"),
          }));
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(provider.search({
      raw: "git@github.com:acme/skills.git",
      cloneUrl: "git@github.com:acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    })).rejects.toMatchObject({
      name: SourceError.name,
      message: "Duplicate skill names discovered for tool 'search': reviewer",
      suggestion: "Use unique parent directory names for SKILL.md files",
    });
  });
});
