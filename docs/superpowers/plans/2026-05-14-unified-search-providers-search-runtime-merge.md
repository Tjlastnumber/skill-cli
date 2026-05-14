# Unified Search Providers Search Runtime Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `skill search` runtime, CLI entrypoint, and matching tests from `unified-search-providers` into `main` without bringing over the README changes.

**Architecture:** Treat this as a bounded file-level migration rather than a redesign. First import the search tests so they define the target behavior, then import the shared search runtime under `src/core/search/`, then import the provider implementations and CLI wiring, and finally verify that README files stayed untouched while the migrated tests pass.

**Tech Stack:** TypeScript, commander, vitest, git file restore from another local branch, existing Node runtime and search support modules

---

## File Structure

- Modify: `src/cli.ts`
- Modify: `src/commands/search.ts`
- Create: `src/core/search/discover-local-skills.ts`
- Create: `src/core/search/discovery-policy.ts`
- Create: `src/core/search/parse-search-source.ts`
- Create: `src/core/search/parse-skill-markdown.ts`
- Create: `src/core/search/providers/git-clone.ts`
- Create: `src/core/search/providers/github-api.ts`
- Create: `src/core/search/search-source-skills.ts`
- Create: `src/core/search/types.ts`
- Modify: `test/search-command.test.ts`
- Create: `test/search-discovery-policy.test.ts`
- Create: `test/search-git-clone-provider.test.ts`
- Create: `test/search-github-provider.test.ts`
- Create: `test/search-source-parser.test.ts`
- Create: `test/search-source-skills.test.ts`
- Do not modify: `README.md`
- Do not modify: `README.zh-CN.md`

### Task 1: Import the Search Tests First

**Files:**
- Modify: `test/search-command.test.ts`
- Create: `test/search-discovery-policy.test.ts`
- Create: `test/search-git-clone-provider.test.ts`
- Create: `test/search-github-provider.test.ts`
- Create: `test/search-source-parser.test.ts`
- Create: `test/search-source-skills.test.ts`

- [ ] **Step 1: Restore the search tests from `unified-search-providers`**

```bash
git restore --source unified-search-providers --worktree -- \
  test/search-command.test.ts \
  test/search-discovery-policy.test.ts \
  test/search-git-clone-provider.test.ts \
  test/search-github-provider.test.ts \
  test/search-source-parser.test.ts \
  test/search-source-skills.test.ts
```

- [ ] **Step 2: Run the migrated search tests to verify the current `main` implementation is still missing the new runtime**

Run: `pnpm test -- test/search-command.test.ts test/search-discovery-policy.test.ts test/search-source-parser.test.ts test/search-source-skills.test.ts`
Expected: FAIL with module-not-found errors under `src/core/search/*` and/or type or runtime mismatches because `main` still has the older GitHub-only `search` implementation.

- [ ] **Step 3: Confirm the test-only diff does not include README files**

Run: `git diff --name-only -- README.md README.zh-CN.md`
Expected: no output.

- [ ] **Step 4: Optional commit if a commit is requested later**

```bash
git add test/search-command.test.ts test/search-discovery-policy.test.ts test/search-git-clone-provider.test.ts test/search-github-provider.test.ts test/search-source-parser.test.ts test/search-source-skills.test.ts
git commit -m "test: add unified search coverage"
```

### Task 2: Import the Shared Search Runtime

**Files:**
- Create: `src/core/search/discover-local-skills.ts`
- Create: `src/core/search/discovery-policy.ts`
- Create: `src/core/search/parse-search-source.ts`
- Create: `src/core/search/parse-skill-markdown.ts`
- Create: `src/core/search/search-source-skills.ts`
- Create: `src/core/search/types.ts`
- Test: `test/search-discovery-policy.test.ts`
- Test: `test/search-source-parser.test.ts`
- Test: `test/search-source-skills.test.ts`

- [ ] **Step 1: Restore the shared search runtime files from `unified-search-providers`**

```bash
git restore --source unified-search-providers --worktree -- \
  src/core/search/discover-local-skills.ts \
  src/core/search/discovery-policy.ts \
  src/core/search/parse-search-source.ts \
  src/core/search/parse-skill-markdown.ts \
  src/core/search/search-source-skills.ts \
  src/core/search/types.ts
```

- [ ] **Step 2: Run the parser and shared-runtime tests**

Run: `pnpm test -- test/search-discovery-policy.test.ts test/search-source-parser.test.ts test/search-source-skills.test.ts`
Expected: FAIL because `search-source-skills.ts` still depends on provider modules that have not been migrated yet, while parser and policy tests may begin passing.

- [ ] **Step 3: Sanity-check that no non-search source files were introduced**

Run: `git diff --name-only -- src`
Expected: only `src/commands/search.ts`, `src/cli.ts`, and `src/core/search/*` appear after the full migration; at this stage only `src/core/search/*` should be new.

- [ ] **Step 4: Optional commit if a commit is requested later**

```bash
git add src/core/search/discover-local-skills.ts src/core/search/discovery-policy.ts src/core/search/parse-search-source.ts src/core/search/parse-skill-markdown.ts src/core/search/search-source-skills.ts src/core/search/types.ts
git commit -m "feat: add shared search runtime"
```

### Task 3: Import the Search Providers

**Files:**
- Create: `src/core/search/providers/git-clone.ts`
- Create: `src/core/search/providers/github-api.ts`
- Test: `test/search-git-clone-provider.test.ts`
- Test: `test/search-github-provider.test.ts`
- Test: `test/search-source-skills.test.ts`

- [ ] **Step 1: Restore the provider implementations from `unified-search-providers`**

```bash
git restore --source unified-search-providers --worktree -- \
  src/core/search/providers/git-clone.ts \
  src/core/search/providers/github-api.ts
```

- [ ] **Step 2: Run the provider and orchestrator tests**

Run: `pnpm test -- test/search-git-clone-provider.test.ts test/search-github-provider.test.ts test/search-source-skills.test.ts`
Expected: PASS if the provider dependencies already exist on `main`; otherwise FAIL only on minimal compatibility issues that need to be fixed inside the migrated search files.

- [ ] **Step 3: Fix only minimal migration breakage inside the imported search files if the tests expose branch drift**

```ts
// Allowed edit scope for compatibility fixes, if needed:
// src/core/search/**/*.ts
// Keep behavior aligned with unified-search-providers.
```

- [ ] **Step 4: Re-run the provider and orchestrator tests**

Run: `pnpm test -- test/search-git-clone-provider.test.ts test/search-github-provider.test.ts test/search-source-skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Optional commit if a commit is requested later**

```bash
git add src/core/search/providers/git-clone.ts src/core/search/providers/github-api.ts
git commit -m "feat: add search providers"
```

### Task 4: Import the CLI Wiring and Command Runtime

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/commands/search.ts`
- Test: `test/search-command.test.ts`

- [ ] **Step 1: Restore the CLI and command files from `unified-search-providers`**

```bash
git restore --source unified-search-providers --worktree -- \
  src/cli.ts \
  src/commands/search.ts
```

- [ ] **Step 2: Run the command-focused tests**

Run: `pnpm test -- test/search-command.test.ts`
Expected: PASS, including the raw source pass-through case and the fallback notice behavior.

- [ ] **Step 3: Re-run the full migrated search test suite together**

Run: `pnpm test -- test/search-command.test.ts test/search-discovery-policy.test.ts test/search-git-clone-provider.test.ts test/search-github-provider.test.ts test/search-source-parser.test.ts test/search-source-skills.test.ts`
Expected: PASS.

- [ ] **Step 4: Optional commit if a commit is requested later**

```bash
git add src/cli.ts src/commands/search.ts test/search-command.test.ts
git commit -m "feat: wire search command to unified providers"
```

### Task 5: Verify Scope and Leave README Untouched

**Files:**
- Verify unchanged: `README.md`
- Verify unchanged: `README.zh-CN.md`
- Verify current migration set: `src/cli.ts`
- Verify current migration set: `src/commands/search.ts`
- Verify current migration set: `src/core/search/**/*.ts`
- Verify current migration set: `test/search*.test.ts`

- [ ] **Step 1: Check the final changed-file list**

Run: `git diff --name-only`
Expected: includes the search runtime, CLI, and test files above, plus any pre-existing unrelated dirty files that were already present before this task; it must not include `README.md` or `README.zh-CN.md` from this migration.

- [ ] **Step 2: Confirm the README files have no diff**

Run: `git diff -- README.md README.zh-CN.md`
Expected: no output.

- [ ] **Step 3: Run one final focused verification command**

Run: `pnpm test -- test/search-command.test.ts test/search-discovery-policy.test.ts test/search-git-clone-provider.test.ts test/search-github-provider.test.ts test/search-source-parser.test.ts test/search-source-skills.test.ts`
Expected: PASS.

- [ ] **Step 4: Optional commit if a commit is requested later**

```bash
git add src/cli.ts src/commands/search.ts src/core/search test/search-command.test.ts test/search-discovery-policy.test.ts test/search-git-clone-provider.test.ts test/search-github-provider.test.ts test/search-source-parser.test.ts test/search-source-skills.test.ts
git commit -m "feat: merge unified search runtime"
```
