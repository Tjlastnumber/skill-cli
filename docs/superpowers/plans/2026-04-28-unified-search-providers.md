# Unified Search Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `skill search` into a repo-level remote search command that accepts GitHub shorthand/HTTPS/SSH and generic git URLs, prefers a GitHub API fast path, and falls back to clone-based search when needed.

**Architecture:** Add a search-specific core under `src/core/search/` with four layers: source parsing, shared discovery policy, provider implementations, and one orchestrator that selects providers and handles fallback. Keep the existing GitHub-only `browseRepositorySkills()` API intact for compatibility while switching the CLI `search` command to the new core.

**Tech Stack:** TypeScript, Node 20 built-in `fetch`, Node `fs/promises`, `child_process.spawn`, commander, vitest, existing `yaml` dependency

---

## File Structure

- Create: `src/core/search/types.ts`
- Create: `src/core/search/parse-search-source.ts`
- Create: `src/core/search/discovery-policy.ts`
- Create: `src/core/search/parse-skill-markdown.ts`
- Create: `src/core/search/discover-local-skills.ts`
- Create: `src/core/search/providers/github-api.ts`
- Create: `src/core/search/providers/git-clone.ts`
- Create: `src/core/search/search-source-skills.ts`
- Create: `test/search-source-parser.test.ts`
- Create: `test/search-discovery-policy.test.ts`
- Create: `test/search-github-provider.test.ts`
- Create: `test/search-git-clone-provider.test.ts`
- Create: `test/search-source-skills.test.ts`
- Modify: `src/commands/search.ts`
- Modify: `src/cli.ts`
- Modify: `test/search-command.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

## Constraints

- Do not remove or rewrite `src/core/github/browse-repository-skills.ts`; leave it as the existing GitHub-only public core.
- Do not widen `search` to local paths, `#ref`, `@skill`, `tree/...`, npm, or well-known URLs in this implementation.
- Use the raw input source when the clone provider executes git commands so SSH/private access semantics remain intact.
- Make GitHub API and clone discovery return the same logical skill set for the same repository fixture.
- Hide `metadata.internal: true` skills by default.

### Task 1: Search Source Parser

**Files:**
- Create: `src/core/search/types.ts`
- Create: `src/core/search/parse-search-source.ts`
- Test: `test/search-source-parser.test.ts`

- [ ] **Step 1: Write the failing parser tests**

```ts
import { describe, expect, it } from "vitest";

import { ExitCode, SkillCliError } from "../src/core/errors.js";
import { parseSearchSource } from "../src/core/search/parse-search-source.js";

describe("parseSearchSource", () => {
  it("parses GitHub shorthand into a GitHub search descriptor", () => {
    expect(parseSearchSource("acme/skills")).toEqual({
      raw: "acme/skills",
      kind: "github",
      cloneUrl: "https://github.com/acme/skills.git",
      github: {
        owner: "acme",
        repo: "skills",
        displayName: "acme/skills",
        webUrl: "https://github.com/acme/skills",
      },
    });
  });

  it("parses GitHub SSH into a GitHub search descriptor", () => {
    expect(parseSearchSource("git@github.com:acme/skills.git").github?.displayName).toBe("acme/skills");
  });

  it("parses generic git HTTPS as clone-only git", () => {
    expect(parseSearchSource("https://gitlab.example.com/org/skills.git")).toMatchObject({
      kind: "git",
      cloneUrl: "https://gitlab.example.com/org/skills.git",
    });
  });

  it("rejects unsupported ref and subpath forms", () => {
    expectInvalidInput("https://github.com/acme/skills/tree/main");
    expectInvalidInput("acme/skills#main");
    expectInvalidInput("acme/skills@reviewer");
  });
});

function expectInvalidInput(input: string): void {
  const error = getThrownError(() => parseSearchSource(input));
  expect(error).toBeInstanceOf(SkillCliError);
  expect(error).toMatchObject({ exitCode: ExitCode.USER_INPUT });
}

function getThrownError(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }

  throw new Error("Expected callback to throw");
}
```

- [ ] **Step 2: Run the parser test to verify it fails**

Run: `pnpm test -- test/search-source-parser.test.ts`
Expected: FAIL with module-not-found or missing export errors for `parse-search-source.ts`.

- [ ] **Step 3: Implement the search source types and parser**

```ts
// src/core/search/types.ts
export interface SearchRepositorySummary {
  displayName: string;
  sourceLabel: string;
  webUrl?: string;
  resolvedBy: "github-api" | "git-clone";
  defaultBranch?: string;
}

export interface SearchSkillRecord {
  skillName: string;
  description: string;
  path: string;
}

export interface SearchProviderResult {
  repository: SearchRepositorySummary;
  skills: SearchSkillRecord[];
}

export interface SearchSourceDescriptor {
  raw: string;
  kind: "github" | "git";
  cloneUrl: string;
  github?: {
    owner: string;
    repo: string;
    displayName: string;
    webUrl: string;
  };
}

export class SearchProviderFallbackError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = "SearchProviderFallbackError";
  }
}
```

```ts
// src/core/search/parse-search-source.ts
import { ExitCode, SkillCliError } from "../errors.js";
import type { SearchSourceDescriptor } from "./types.js";

const GITHUB_SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_SSH = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/;

export function parseSearchSource(input: string): SearchSourceDescriptor {
  const raw = input.trim();
  if (!raw) {
    throw invalidSearchSource(input);
  }

  if (raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("/") || raw.includes("#") || raw.includes("/tree/")) {
    throw invalidSearchSource(raw);
  }

  if (GITHUB_SHORTHAND.test(raw)) {
    const [owner, repo] = raw.split("/");
    return githubDescriptor(raw, owner!, repo!.replace(/\.git$/, ""), `https://github.com/${raw.replace(/\.git$/, "")}.git`);
  }

  const sshMatch = raw.match(GITHUB_SSH);
  if (sshMatch) {
    return githubDescriptor(raw, sshMatch[1]!, sshMatch[2]!, raw);
  }

  if (raw.startsWith("https://github.com/")) {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parsed.search || parsed.hash) {
      throw invalidSearchSource(raw);
    }
    return githubDescriptor(raw, parts[0]!, parts[1]!.replace(/\.git$/, ""), `${parsed.origin}/${parts[0]}/${parts[1]!.replace(/\.git$/, "")}.git`);
  }

  if (/^(git@|ssh:\/\/|https?:\/\/).+\.git$/.test(raw)) {
    return { raw, kind: "git", cloneUrl: raw };
  }

  throw invalidSearchSource(raw);
}

function githubDescriptor(raw: string, owner: string, repo: string, cloneUrl: string): SearchSourceDescriptor {
  return {
    raw,
    kind: "github",
    cloneUrl,
    github: {
      owner,
      repo,
      displayName: `${owner}/${repo}`,
      webUrl: `https://github.com/${owner}/${repo}`,
    },
  };
}

function invalidSearchSource(input: string): SkillCliError {
  return new SkillCliError(
    `Invalid search source: ${input}`,
    ExitCode.USER_INPUT,
    "Use a repo-level source like owner/repo, https://github.com/owner/repo, or git@github.com:owner/repo.git",
  );
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

Run: `pnpm test -- test/search-source-parser.test.ts`
Expected: PASS with shorthand, GitHub HTTPS, GitHub SSH, generic git, and invalid-input coverage green.

- [ ] **Step 5: Commit**

```bash
git add src/core/search/types.ts src/core/search/parse-search-source.ts test/search-source-parser.test.ts
git commit -m "feat: add search source parser"
```

### Task 2: Shared Discovery Policy and Local Discovery

**Files:**
- Create: `src/core/search/discovery-policy.ts`
- Create: `src/core/search/parse-skill-markdown.ts`
- Create: `src/core/search/discover-local-skills.ts`
- Test: `test/search-discovery-policy.test.ts`

- [ ] **Step 1: Write failing tests for priority roots, fallback recursion, frontmatter validation, and internal filtering**

```ts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { discoverLocalSearchSkills } from "../src/core/search/discover-local-skills.js";
import { selectSearchSkillCandidatePaths } from "../src/core/search/discovery-policy.js";
import { parseSearchSkillMarkdown } from "../src/core/search/parse-skill-markdown.js";

describe("selectSearchSkillCandidatePaths", () => {
  it("prefers priority-root matches over deeper recursive matches", () => {
    expect(
      selectSearchSkillCandidatePaths([
        "skills/reviewer/SKILL.md",
        "skills/team/reviewer/SKILL.md",
      ]),
    ).toEqual(["skills/reviewer/SKILL.md"]);
  });
});

describe("parseSearchSkillMarkdown", () => {
  it("requires string name and description and hides internal skills", () => {
    expect(parseSearchSkillMarkdown("---\nname: reviewer\ndescription: Reviews changes\n---\n")).toMatchObject({
      skillName: "reviewer",
      description: "Reviews changes",
    });
    expect(parseSearchSkillMarkdown("---\nname: reviewer\nmetadata:\n  internal: true\ndescription: hidden\n---\n")).toBeUndefined();
    expect(parseSearchSkillMarkdown("---\ndescription: missing name\n---\n")).toBeUndefined();
  });
});

describe("discoverLocalSearchSkills", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to recursive search when priority roots are empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-cli-search-policy-"));
    cleanupDirs.push(root);
    await mkdir(join(root, "nested", "reviewer"), { recursive: true });
    await writeFile(join(root, "nested", "reviewer", "SKILL.md"), "---\nname: reviewer\ndescription: Reviews changes\n---\n");

    await expect(discoverLocalSearchSkills(root)).resolves.toEqual([
      {
        skillName: "reviewer",
        description: "Reviews changes",
        path: "nested/reviewer/SKILL.md",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the discovery-policy test to verify it fails**

Run: `pnpm test -- test/search-discovery-policy.test.ts`
Expected: FAIL with missing module errors for discovery policy, markdown parser, and local discovery helpers.

- [ ] **Step 3: Implement shared candidate selection, markdown validation, and local discovery**

```ts
// src/core/search/discovery-policy.ts
export const SEARCH_PRIORITY_ROOTS = ["", "skills", ".claude/skills", ".codex/skills", ".opencode/skills"] as const;

export function selectSearchSkillCandidatePaths(paths: string[], maxDepth = 5): string[] {
  const normalized = paths.filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md")).sort();

  for (const root of SEARCH_PRIORITY_ROOTS) {
    const prefix = root ? `${root}/` : "";
    const matches = normalized.filter((path) => {
      if (root === "" && path === "SKILL.md") return true;
      if (!path.startsWith(prefix)) return false;
      const rest = path.slice(prefix.length);
      return rest === "SKILL.md" || /^[^/]+\/SKILL\.md$/.test(rest);
    });
    if (matches.length > 0) {
      return matches;
    }
  }

  return normalized.filter((path) => path.split("/").length - 1 <= maxDepth);
}
```

```ts
// src/core/search/parse-skill-markdown.ts
import { parse as parseYaml } from "yaml";

export interface ParsedSearchSkillMarkdown {
  skillName: string;
  description: string;
}

export function parseSearchSkillMarkdown(markdown: string): ParsedSearchSkillMarkdown | undefined {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return undefined;

  const data = parseYaml(match[1]) as { name?: unknown; description?: unknown; metadata?: { internal?: unknown } };
  if (typeof data?.name !== "string" || typeof data?.description !== "string") {
    return undefined;
  }
  if (data.metadata?.internal === true) {
    return undefined;
  }

  return {
    skillName: data.name.trim(),
    description: data.description.trim(),
  };
}
```

```ts
// src/core/search/discover-local-skills.ts
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { SearchSkillRecord } from "./types.js";
import { parseSearchSkillMarkdown } from "./parse-skill-markdown.js";
import { selectSearchSkillCandidatePaths } from "./discovery-policy.js";

export async function discoverLocalSearchSkills(rootDir: string): Promise<SearchSkillRecord[]> {
  const allPaths = await walkSkillMarkdownPaths(rootDir);
  const candidates = selectSearchSkillCandidatePaths(allPaths);
  const results: SearchSkillRecord[] = [];
  const seen = new Set<string>();

  for (const relativePath of candidates) {
    const markdown = await readFile(join(rootDir, relativePath), "utf8");
    const parsed = parseSearchSkillMarkdown(markdown);
    if (!parsed || seen.has(parsed.skillName.toLowerCase())) continue;
    seen.add(parsed.skillName.toLowerCase());
    results.push({ skillName: parsed.skillName, description: parsed.description, path: relativePath });
  }

  return results;
}

async function walkSkillMarkdownPaths(rootDir: string): Promise<string[]> {
  const output: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        output.push(relative(rootDir, entryPath).replace(/\\/g, "/"));
      }
    }
  }

  return output.sort((left, right) => left.localeCompare(right));
}
```

- [ ] **Step 4: Run the discovery-policy test to verify it passes**

Run: `pnpm test -- test/search-discovery-policy.test.ts`
Expected: PASS with priority-root selection, recursive fallback, frontmatter validation, and internal-skill hiding green.

- [ ] **Step 5: Commit**

```bash
git add src/core/search/discovery-policy.ts src/core/search/parse-skill-markdown.ts src/core/search/discover-local-skills.ts test/search-discovery-policy.test.ts
git commit -m "feat: add shared search discovery policy"
```

### Task 3: GitHub API Provider

**Files:**
- Create: `src/core/search/providers/github-api.ts`
- Test: `test/search-github-provider.test.ts`

- [ ] **Step 1: Write failing tests for successful API discovery and fallback-worthy GitHub failures**

```ts
import { describe, expect, it } from "vitest";

import { GitHubApiSearchProvider } from "../src/core/search/providers/github-api.js";
import { SearchProviderFallbackError } from "../src/core/search/types.js";

describe("GitHubApiSearchProvider", () => {
  it("returns only validated skills from priority-root candidates", async () => {
    const provider = new GitHubApiSearchProvider({
      fetch: async (input) => {
        const url = String(input);
        if (url === "https://api.github.com/repos/acme/skills") {
          return new Response(JSON.stringify({ default_branch: "main", description: "Repo" }));
        }
        if (url === "https://api.github.com/repos/acme/skills/git/trees/main?recursive=1") {
          return new Response(JSON.stringify({
            tree: [
              { path: "skills/reviewer/SKILL.md", type: "blob", sha: "reviewer" },
              { path: "skills/team/reviewer/SKILL.md", type: "blob", sha: "deep" },
            ],
          }));
        }
        if (url === "https://api.github.com/repos/acme/skills/git/blobs/reviewer") {
          return new Response(JSON.stringify({ encoding: "base64", content: Buffer.from("---\nname: reviewer\ndescription: Reviews changes\n---\n").toString("base64") }));
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(provider.search({
      raw: "acme/skills",
      kind: "github",
      cloneUrl: "https://github.com/acme/skills.git",
      github: { owner: "acme", repo: "skills", displayName: "acme/skills", webUrl: "https://github.com/acme/skills" },
    })).resolves.toMatchObject({ skills: [{ skillName: "reviewer", path: "skills/reviewer/SKILL.md" }] });
  });

  it("converts not-public and rate-limit errors into fallback signals", async () => {
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
      raw: "git@github.com:acme/skills.git",
      kind: "github",
      cloneUrl: "git@github.com:acme/skills.git",
      github: { owner: "acme", repo: "skills", displayName: "acme/skills", webUrl: "https://github.com/acme/skills" },
    })).rejects.toBeInstanceOf(SearchProviderFallbackError);
  });
});
```

- [ ] **Step 2: Run the GitHub provider test to verify it fails**

Run: `pnpm test -- test/search-github-provider.test.ts`
Expected: FAIL with missing provider implementation and missing fallback error type usage.

- [ ] **Step 3: Implement the GitHub API provider on top of the existing GitHub client**

```ts
// src/core/search/providers/github-api.ts
import { SourceError } from "../../errors.js";
import { createGitHubClient } from "../../github/client.js";
import type { SearchProviderResult, SearchSourceDescriptor } from "../types.js";
import { SearchProviderFallbackError } from "../types.js";
import { parseSearchSkillMarkdown } from "../parse-skill-markdown.js";
import { selectSearchSkillCandidatePaths } from "../discovery-policy.js";

interface GitHubApiSearchProviderOptions {
  fetch?: typeof fetch;
}

export class GitHubApiSearchProvider {
  constructor(private readonly options: GitHubApiSearchProviderOptions = {}) {}

  async search(source: SearchSourceDescriptor): Promise<SearchProviderResult> {
    const github = source.github;
    if (!github) {
      throw new SearchProviderFallbackError("GitHub identity missing for API provider");
    }

    try {
      const client = createGitHubClient({ fetch: this.options.fetch });
      const metadata = await client.readRepositoryMetadata(github.owner, github.repo);
      const tree = await client.readTree(github.owner, github.repo, metadata.defaultBranch);
      const candidatePaths = selectSearchSkillCandidatePaths(
        tree.filter((entry) => entry.type === "blob").map((entry) => entry.path),
      );

      const skills: SearchProviderResult["skills"] = [];
      const seen = new Set<string>();
      for (const path of candidatePaths) {
        const entry = tree.find((item) => item.path === path && item.type === "blob");
        if (!entry) continue;
        const markdown = await client.readBlob(github.owner, github.repo, entry.sha, entry.path);
        const parsed = parseSearchSkillMarkdown(markdown);
        if (!parsed || seen.has(parsed.skillName.toLowerCase())) continue;
        seen.add(parsed.skillName.toLowerCase());
        skills.push({ skillName: parsed.skillName, description: parsed.description, path: entry.path });
      }

      return {
        repository: {
          displayName: github.displayName,
          sourceLabel: source.raw,
          webUrl: github.webUrl,
          resolvedBy: "github-api",
          defaultBranch: metadata.defaultBranch,
        },
        skills,
      };
    } catch (error) {
      if (error instanceof SourceError) {
        throw new SearchProviderFallbackError("GitHub API provider failed", error);
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run the GitHub provider test to verify it passes**

Run: `pnpm test -- test/search-github-provider.test.ts`
Expected: PASS with one successful API discovery case and one fallback-worthy failure case green.

- [ ] **Step 5: Commit**

```bash
git add src/core/search/providers/github-api.ts test/search-github-provider.test.ts src/core/search/types.ts
git commit -m "feat: add GitHub API search provider"
```

### Task 4: Clone Provider and Search Orchestrator

**Files:**
- Create: `src/core/search/providers/git-clone.ts`
- Create: `src/core/search/search-source-skills.ts`
- Test: `test/search-git-clone-provider.test.ts`
- Test: `test/search-source-skills.test.ts`

- [ ] **Step 1: Write failing tests for clone discovery and API-to-clone fallback orchestration**

```ts
import { describe, expect, it, vi } from "vitest";

import { SearchProviderFallbackError } from "../src/core/search/types.js";
import { GitCloneSearchProvider } from "../src/core/search/providers/git-clone.js";
import { searchSourceSkills } from "../src/core/search/search-source-skills.js";

describe("GitCloneSearchProvider", () => {
  it("clones the repo and returns validated local search skills", async () => {
    const provider = new GitCloneSearchProvider({
      createTempDir: async () => "/tmp/repo",
      cleanupTempDir: async () => {},
      runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      discoverLocalSearchSkills: async () => [
        { skillName: "reviewer", description: "Reviews changes", path: "skills/reviewer/SKILL.md" },
      ],
    });

    await expect(provider.search({ raw: "git@github.com:acme/skills.git", kind: "github", cloneUrl: "git@github.com:acme/skills.git", github: { owner: "acme", repo: "skills", displayName: "acme/skills", webUrl: "https://github.com/acme/skills" } })).resolves.toMatchObject({
      repository: { resolvedBy: "git-clone" },
    });
  });
});

describe("searchSourceSkills", () => {
  it("tries GitHub API first and falls back to clone provider", async () => {
    const onFallback = vi.fn();
    const githubProvider = { search: vi.fn().mockRejectedValue(new SearchProviderFallbackError("fallback")) };
    const cloneProvider = { search: vi.fn().mockResolvedValue({
      repository: { displayName: "acme/skills", sourceLabel: "git@github.com:acme/skills.git", resolvedBy: "git-clone" },
      skills: [],
    }) };

    await searchSourceSkills("git@github.com:acme/skills.git", { githubProvider, cloneProvider, onFallback });

    expect(githubProvider.search).toHaveBeenCalledTimes(1);
    expect(cloneProvider.search).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith("GitHub API search unavailable, falling back to git clone");
  });
});
```

- [ ] **Step 2: Run the clone/orchestrator tests to verify they fail**

Run: `pnpm test -- test/search-git-clone-provider.test.ts test/search-source-skills.test.ts`
Expected: FAIL with missing provider/orchestrator implementations.

- [ ] **Step 3: Implement the clone provider and orchestrator**

```ts
// src/core/search/providers/git-clone.ts
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SourceError } from "../../errors.js";
import { discoverLocalSearchSkills } from "../discover-local-skills.js";
import type { SearchProviderResult, SearchSourceDescriptor } from "../types.js";

interface GitCloneSearchProviderOptions {
  createTempDir?: () => Promise<string>;
  cleanupTempDir?: (path: string) => Promise<void>;
  runCommand?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  discoverLocalSearchSkills?: typeof discoverLocalSearchSkills;
}

export class GitCloneSearchProvider {
  constructor(private readonly options: GitCloneSearchProviderOptions = {}) {}

  async search(source: SearchSourceDescriptor): Promise<SearchProviderResult> {
    const tempRoot = await (this.options.createTempDir?.() ?? mkdtemp(join(tmpdir(), "skill-cli-search-")));
    const runCommand = this.options.runCommand ?? defaultRunCommand;
    const discover = this.options.discoverLocalSearchSkills ?? discoverLocalSearchSkills;

    try {
      await runCommand("git", ["clone", "--depth", "1", source.cloneUrl, tempRoot]);
      const skills = await discover(tempRoot);
      return {
        repository: {
          displayName: source.github?.displayName ?? source.raw,
          sourceLabel: source.raw,
          webUrl: source.github?.webUrl,
          resolvedBy: "git-clone",
        },
        skills,
      };
    } finally {
      await (this.options.cleanupTempDir?.(tempRoot) ?? rm(tempRoot, { recursive: true, force: true }));
    }
  }
}

async function defaultRunCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      const code = exitCode ?? 1;
      if (code !== 0) {
        rejectPromise(new SourceError(`Command failed: ${command} ${args.join(" ")}`, stderr || stdout || "Unknown command failure"));
        return;
      }
      resolvePromise({ stdout, stderr, exitCode: code });
    });
  });
}
```

```ts
// src/core/search/search-source-skills.ts
import { parseSearchSource } from "./parse-search-source.js";
import { GitHubApiSearchProvider } from "./providers/github-api.js";
import { GitCloneSearchProvider } from "./providers/git-clone.js";
import { SearchProviderFallbackError, type SearchProviderResult } from "./types.js";

export async function searchSourceSkills(
  sourceInput: string,
  options: {
    githubProvider?: Pick<GitHubApiSearchProvider, "search">;
    cloneProvider?: Pick<GitCloneSearchProvider, "search">;
    onFallback?: (message: string) => void;
  } = {},
): Promise<SearchProviderResult> {
  const source = parseSearchSource(sourceInput);
  const githubProvider = options.githubProvider ?? new GitHubApiSearchProvider();
  const cloneProvider = options.cloneProvider ?? new GitCloneSearchProvider();

  if (source.github) {
    try {
      return await githubProvider.search(source);
    } catch (error) {
      if (!(error instanceof SearchProviderFallbackError)) {
        throw error;
      }
      options.onFallback?.("GitHub API search unavailable, falling back to git clone");
    }
  }

  return await cloneProvider.search(source);
}
```

- [ ] **Step 4: Run the clone/orchestrator tests to verify they pass**

Run: `pnpm test -- test/search-git-clone-provider.test.ts test/search-source-skills.test.ts`
Expected: PASS with clone discovery and API fallback orchestration green.

- [ ] **Step 5: Commit**

```bash
git add src/core/search/providers/git-clone.ts src/core/search/search-source-skills.ts test/search-git-clone-provider.test.ts test/search-source-skills.test.ts
git commit -m "feat: add clone fallback for search"
```

### Task 5: CLI Wiring, Docs, and Final Verification

**Files:**
- Modify: `src/commands/search.ts`
- Modify: `src/cli.ts`
- Modify: `test/search-command.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Extend command tests for the new source argument, optional default branch printing, and fallback notice**

```ts
it("passes the raw search source through from the CLI", async () => {
  const runSearchCommandSpy = vi.spyOn(searchCommandModule, "runSearchCommand").mockResolvedValue({
    repository: { displayName: "acme/skills", sourceLabel: "acme/skills", resolvedBy: "github-api", defaultBranch: "main" },
    skills: [],
  });

  await runCli(["node", "skill", "search", "git@github.com:acme/skills.git", "--filter", "beta"]);

  expect(runSearchCommandSpy).toHaveBeenCalledWith({
    repositoryUrl: "git@github.com:acme/skills.git",
    filter: "beta",
  });
});

it("prints fallback info and omits default branch when the provider does not know it", async () => {
  const capture = captureOutput();

  await runSearchCommand(
    { repositoryUrl: "git@gitlab.example.com:org/skills.git" },
    {
      output: capture.output,
      searcher: async (_source, onNotice) => {
        onNotice("GitHub API search unavailable, falling back to git clone");
        return {
          repository: {
            displayName: "org/skills",
            sourceLabel: "git@gitlab.example.com:org/skills.git",
            resolvedBy: "git-clone",
          },
          skills: [{ skillName: "reviewer", description: "Reviews changes", path: "skills/reviewer/SKILL.md" }],
        };
      },
    },
  );

  expect(capture.logs).toContain("INFO:GitHub API search unavailable, falling back to git clone");
  expect(capture.logs).not.toContain("INFO:Default branch: undefined");
});
```

- [ ] **Step 2: Run the command test to verify it fails**

Run: `pnpm test -- test/search-command.test.ts`
Expected: FAIL because `runSearchCommand()` and CLI help text still assume GitHub-root-URL-only behavior.

- [ ] **Step 3: Rewire `search` to the new core and update docs**

```ts
// src/commands/search.ts
import { searchSourceSkills, type SearchProviderResult } from "../core/search/search-source-skills.js";

export interface SearchRuntimeOptions {
  output?: Output;
  searcher?: (source: string, onNotice: (message: string) => void) => Promise<SearchProviderResult>;
}

export async function runSearchCommand(args: SearchCommandArgs, runtime: SearchRuntimeOptions = {}): Promise<SearchProviderResult> {
  const output = runtime.output ?? createOutput();
  const searcher = runtime.searcher ?? ((repositoryUrl: string, onNotice: (message: string) => void) =>
    searchSourceSkills(repositoryUrl, { onFallback: onNotice }));

  const result = await searcher(args.repositoryUrl, (message) => output.info(message));
  output.info(`Repository: ${result.repository.displayName}`);
  if (result.repository.defaultBranch) {
    output.info(`Default branch: ${result.repository.defaultBranch}`);
  }
  const filter = args.filter?.trim();
  const skills = filter ? result.skills.filter((skill) => matchesFilter(skill, filter)) : result.skills;
  output.info(`Skills: ${skills.length}`);
  output.info("");

  if (result.skills.length === 0) {
    output.info("No skills found in repository");
    return { repository: result.repository, skills };
  }

  if (filter && skills.length === 0) {
    output.info(`No skills matched filter: ${filter}`);
    return { repository: result.repository, skills };
  }

  for (const [index, skill] of skills.entries()) {
    if (index > 0) {
      output.info("");
    }
    output.info(`  ${skill.skillName}`);
    output.info(`    description: ${skill.description}`);
    output.info(`    path: ${skill.path}`);
  }

  return { repository: result.repository, skills };
}
```

```ts
// src/cli.ts
program
  .command("search")
  .argument("<source>", "Repo-level GitHub or git source")
  .option("--filter <text>", "Filter skills by name, description, or path")
  .action(async (repositoryUrl: string, options: { filter?: string }) => {
    await runSearchCommand({ repositoryUrl, filter: options.filter });
  });
```

```md
<!-- README.md / README.zh-CN.md -->
- `skill search <source> [--filter <text>]`
- examples:
  - `skill search https://github.com/owner/repo`
  - `skill search owner/repo`
  - `skill search git@github.com:owner/repo.git`
```

- [ ] **Step 4: Run focused verification and then the full suite**

Run: `pnpm test -- test/search-source-parser.test.ts test/search-discovery-policy.test.ts test/search-github-provider.test.ts test/search-git-clone-provider.test.ts test/search-source-skills.test.ts test/search-command.test.ts`
Expected: PASS for the full new search slice.

Run: `pnpm test`
Expected: PASS with existing GitHub browse tests still green.

Run: `pnpm build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/commands/search.ts src/cli.ts test/search-command.test.ts README.md README.zh-CN.md
git commit -m "feat: unify search providers"
```

## Verification Checklist

- Search source parsing covers shorthand, GitHub HTTPS, GitHub SSH, generic git URLs, and invalid input.
- Shared discovery policy enforces one priority-root list and one depth rule for both providers.
- GitHub API provider returns validated skills and raises fallback signals for clone-worthy failures.
- Clone provider uses the raw source semantics and cleans up temporary directories.
- Orchestrator tries GitHub API first when `owner/repo` is extractable and falls back exactly once.
- CLI output keeps the existing structure, prints fallback notices when needed, and omits `Default branch` when unknown.
- Existing `browseRepositorySkills()` tests remain green because the old public GitHub-only core stays intact.
