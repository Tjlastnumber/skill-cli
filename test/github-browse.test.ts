import { describe, expect, it } from "vitest";

import { SourceError } from "../src/core/errors.js";
import { browseRepositorySkills } from "../src/core/github/browse-repository-skills.js";
import * as publicApi from "../src/index.js";

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("browseRepositorySkills", () => {
  it("is exported from the package entrypoint", () => {
    expect(publicApi.browseRepositorySkills).toBe(browseRepositorySkills);
  });

  it("reads repository metadata and returns repository skills with descriptions", async () => {
    const requestedUrls: string[] = [];

    const fetchStub: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url === "https://api.github.com/repos/acme/skills") {
        return createJsonResponse({
          default_branch: "trunk",
          description: "A public collection of coding skills",
        });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/trees/trunk?recursive=1") {
        return createJsonResponse({
          tree: [
            { path: "skills/alpha-skill/SKILL.md", type: "blob", sha: "alpha-sha" },
            { path: "skills/beta-skill/SKILL.md", type: "blob", sha: "beta-sha" },
            { path: "skills/README.md", type: "blob", sha: "readme-sha" },
            { path: "skills/gamma-skill", type: "tree", sha: "tree-sha" },
          ],
        });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/blobs/alpha-sha") {
        return createJsonResponse({
          encoding: "base64",
          content: encodeBase64("---\ndescription: Alpha summary\n---\n\nIgnored body."),
        });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/blobs/beta-sha") {
        return createJsonResponse({
          encoding: "base64",
          content: encodeBase64("# Beta Skill\n\nBeta paragraph description.\n\nMore details."),
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await expect(
      browseRepositorySkills("https://github.com/acme/skills", { fetch: fetchStub }),
    ).resolves.toEqual({
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
          skillName: "beta-skill",
          description: "Beta paragraph description.",
          path: "skills/beta-skill/SKILL.md",
        },
      ],
    });

    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/acme/skills",
      "https://api.github.com/repos/acme/skills/git/trees/trunk?recursive=1",
      "https://api.github.com/repos/acme/skills/git/blobs/alpha-sha",
      "https://api.github.com/repos/acme/skills/git/blobs/beta-sha",
    ]);
  });

  it("maps repository-not-found responses to a stable SourceError", async () => {
    const fetchStub: typeof fetch = async () => {
      return createJsonResponse({ message: "Not Found" }, { status: 404 });
    };

    await expect(
      browseRepositorySkills("https://github.com/acme/missing", { fetch: fetchStub }),
    ).rejects.toThrowError(
      new SourceError("GitHub repository not found or not public: acme/missing"),
    );
  });

  it("maps rate-limit responses to a stable SourceError", async () => {
    const fetchStub: typeof fetch = async () => {
      return createJsonResponse(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        },
      );
    };

    await expect(
      browseRepositorySkills("https://github.com/acme/skills", { fetch: fetchStub }),
    ).rejects.toThrowError(new SourceError("GitHub API rate limit exceeded"));
  });

  it("maps invalid blob content to a stable decode SourceError", async () => {
    const fetchStub: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://api.github.com/repos/acme/skills") {
        return createJsonResponse({ default_branch: "main" });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/trees/main?recursive=1") {
        return createJsonResponse({
          tree: [{ path: "skills/alpha-skill/SKILL.md", type: "blob", sha: "alpha-sha" }],
        });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/blobs/alpha-sha") {
        return createJsonResponse({
          encoding: "base64",
          content: "%%%not-base64%%%",
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await expect(
      browseRepositorySkills("https://github.com/acme/skills", { fetch: fetchStub }),
    ).rejects.toThrowError(
      new SourceError("Failed to decode GitHub blob: acme/skills/skills/alpha-skill/SKILL.md"),
    );
  });

  it("fails explicitly when the recursive tree response is truncated", async () => {
    const fetchStub: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://api.github.com/repos/acme/skills") {
        return createJsonResponse({ default_branch: "main" });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/trees/main?recursive=1") {
        return createJsonResponse({
          truncated: true,
          tree: [{ path: "skills/alpha-skill/SKILL.md", type: "blob", sha: "alpha-sha" }],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await expect(
      browseRepositorySkills("https://github.com/acme/skills", { fetch: fetchStub }),
    ).rejects.toThrowError(
      new SourceError("GitHub repository tree response was truncated: acme/skills#main"),
    );
  });

  it("includes a root-level SKILL.md using the repository name as the skill name", async () => {
    const fetchStub: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://api.github.com/repos/acme/skills") {
        return createJsonResponse({
          default_branch: "main",
          description: "A public collection of coding skills",
        });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/trees/main?recursive=1") {
        return createJsonResponse({
          tree: [{ path: "SKILL.md", type: "blob", sha: "root-skill" }],
        });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/blobs/root-skill") {
        return createJsonResponse({
          encoding: "base64",
          content: encodeBase64("# Root Skill\n\nRepository root description.\n"),
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await expect(
      browseRepositorySkills("https://github.com/acme/skills", { fetch: fetchStub }),
    ).resolves.toEqual({
      repository: {
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
        summary: "A public collection of coding skills",
        defaultBranch: "main",
      },
      skills: [
        {
          skillName: "skills",
          description: "Repository root description.",
          path: "SKILL.md",
        },
      ],
    });
  });

  it("returns repository metadata with an empty skill list when the default branch has no skill files", async () => {
    const fetchStub: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://api.github.com/repos/acme/skills") {
        return createJsonResponse({
          default_branch: "main",
          description: "A public collection of coding skills",
        });
      }

      if (url === "https://api.github.com/repos/acme/skills/git/trees/main?recursive=1") {
        return createJsonResponse({
          tree: [{ path: "README.md", type: "blob", sha: "readme-sha" }],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await expect(
      browseRepositorySkills("https://github.com/acme/skills", { fetch: fetchStub }),
    ).resolves.toEqual({
      repository: {
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
        summary: "A public collection of coding skills",
        defaultBranch: "main",
      },
      skills: [],
    });
  });
});
