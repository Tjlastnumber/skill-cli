# GitHub Repository Skills Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable GitHub skills browsing core and a `skill browse` CLI command that lists skills from a public GitHub repository default branch without cloning.

**Architecture:** Add a GitHub-specific read-only core parallel to the existing local install/discovery flow. The new core validates repository URLs, queries the GitHub API for metadata, recursive tree entries, and `SKILL.md` blobs, then extracts normalized skill records that the CLI can filter and render.

**Tech Stack:** TypeScript, Node 20 built-in `fetch`, commander, vitest

---

## File Structure

- Create: `src/core/github/parse-repository-url.ts`
- Create: `src/core/github/skill-markdown.ts`
- Create: `src/core/github/client.ts`
- Create: `src/core/github/browse-repository-skills.ts`
- Create: `src/commands/browse.ts`
- Create: `test/github-repository-url.test.ts`
- Create: `test/github-skill-markdown.test.ts`
- Create: `test/github-browse.test.ts`
- Create: `test/browse-command.test.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

### Task 1: GitHub Repository URL Parsing

**Files:**
- Create: `src/core/github/parse-repository-url.ts`
- Test: `test/github-repository-url.test.ts`

- [ ] Write failing tests for valid GitHub URLs, `.git` suffix normalization, and invalid URL cases.
- [ ] Implement `parseGitHubRepositoryUrl()` returning `owner`, `repo`, `displayName`, and canonical `webUrl`.
- [ ] Use `SkillCliError` with `ExitCode.USER_INPUT` for invalid input.
- [ ] Run `pnpm test -- test/github-repository-url.test.ts`.

### Task 2: SKILL.md Description Extraction

**Files:**
- Create: `src/core/github/skill-markdown.ts`
- Test: `test/github-skill-markdown.test.ts`

- [ ] Write failing tests for frontmatter description extraction, first-paragraph fallback, and empty description fallback.
- [ ] Implement `extractSkillDescription()` with simple frontmatter parsing and fallback behavior.
- [ ] Keep the implementation dependency-free.
- [ ] Run `pnpm test -- test/github-skill-markdown.test.ts`.

### Task 3: GitHub Browse Core

**Files:**
- Create: `src/core/github/client.ts`
- Create: `src/core/github/browse-repository-skills.ts`
- Modify: `src/index.ts`
- Test: `test/github-browse.test.ts`

- [ ] Write failing tests for successful repository browsing, repository-not-found mapping, rate-limit mapping, and empty repository results.
- [ ] Implement a minimal GitHub client that reads repository metadata, tree entries, and blob bodies using injected `fetch`.
- [ ] Implement `browseRepositorySkills()` that filters tree entries to `/SKILL.md`, fetches blob content with bounded concurrency, derives `skillName`, and extracts descriptions.
- [ ] Export the new browse core from `src/index.ts`.
- [ ] Run `pnpm test -- test/github-browse.test.ts`.

### Task 4: Browse Command and CLI Wiring

**Files:**
- Create: `src/commands/browse.ts`
- Modify: `src/cli.ts`
- Test: `test/browse-command.test.ts`

- [ ] Write failing tests for command output, filtering behavior, no-skill output, and filter-no-match output.
- [ ] Implement `runBrowseCommand()` that calls the core browser, applies local filter matching, and renders the plain-text output.
- [ ] Register `browse` in `src/cli.ts` as `skill browse <github-repo-url> [--filter <text>]`.
- [ ] Run `pnpm test -- test/browse-command.test.ts`.
- [ ] Run `pnpm build`.

### Task 5: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] Add the new browse feature to the feature list in both READMEs.
- [ ] Add quick-start examples for `skill browse` and `--filter`.
- [ ] Add the command reference row for `skill browse` in both READMEs.
- [ ] Run `pnpm test -- test/github-repository-url.test.ts test/github-skill-markdown.test.ts test/github-browse.test.ts test/browse-command.test.ts`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.

## Constraints

- Do not modify the existing local install/discovery pipeline for this feature.
- Do not add private repository support in v1.
- Do not add ref selection, JSON output, or persistent caching.
- Keep the implementation dependency-free unless a blocker appears.

## Verification Checklist

- New tests cover URL parsing, markdown parsing, remote browsing, and CLI output.
- All existing tests continue to pass.
- Build succeeds with no TypeScript errors.
- `skill browse` output matches the approved plain-text format.
