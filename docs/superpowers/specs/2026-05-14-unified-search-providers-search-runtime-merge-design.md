# Unified Search Providers Search Runtime Merge Design

## Summary

Merge the `skill search` runtime redesign from `unified-search-providers` into `main`, but only for the CLI entrypoint, the search runtime modules under `src/core/search/`, and the matching automated tests. Do not merge the README changes from the source branch as part of this work.

The goal is to bring the repo-level unified search behavior to `main` with the smallest safe change set. The implementation should preserve the source branch behavior for `search` while keeping unrelated documentation and changelog work on `main` untouched.

## Goals

- Bring the `search` command behavior from `unified-search-providers` to `main`
- Include the CLI wiring change in `src/cli.ts`
- Include the search runtime modules in `src/core/search/`
- Include the matching automated tests so `main` gains coverage for the migrated behavior
- Preserve the current uncommitted changelog and planning-file changes already present on `main`
- Keep the merge boundary narrow and auditable

## Non-Goals

- Do not merge `README.md`
- Do not merge `README.zh-CN.md`
- Do not change changelog files as part of this merge
- Do not pull in unrelated branch history or non-search files
- Do not refactor the migrated search code beyond what is required to make it apply and pass on `main`

## Source Scope

The source branch work is concentrated in commit `14ea4ff` (`feat: expand search to repo-level git sources`). This merge should take only the code and test files from that change set.

### Included Files

- `src/cli.ts`
- `src/commands/search.ts`
- `src/core/search/discover-local-skills.ts`
- `src/core/search/discovery-policy.ts`
- `src/core/search/parse-search-source.ts`
- `src/core/search/parse-skill-markdown.ts`
- `src/core/search/providers/git-clone.ts`
- `src/core/search/providers/github-api.ts`
- `src/core/search/search-source-skills.ts`
- `src/core/search/types.ts`
- `test/search-command.test.ts`
- `test/search-discovery-policy.test.ts`
- `test/search-git-clone-provider.test.ts`
- `test/search-github-provider.test.ts`
- `test/search-source-parser.test.ts`
- `test/search-source-skills.test.ts`

### Excluded Files

- `README.md`
- `README.zh-CN.md`

## User Experience After Merge

After the merge, `skill search <source> [--filter <text>]` on `main` should behave like the source branch version.

Expected changes:

- `search` accepts repo-level GitHub shorthand, GitHub HTTPS, GitHub SSH, and generic git URLs
- GitHub-resolvable sources try the GitHub API path first
- Fallback to clone-based search is available when API search cannot complete
- Output keeps the same basic repository header, optional default branch line, filtered count, and per-skill blocks
- The CLI may print one fallback notice line before results when the clone fallback is used

Expected non-changes:

- README content on `main` remains as-is
- Existing changelog edits on `main` remain as-is
- No new CLI surface outside the `search` command path

## Architecture Boundary

This is a bounded code migration, not a reimplementation. `main` should adopt the source branch's search architecture with the same module split:

1. `src/cli.ts` updates the `search` command argument description only
2. `src/commands/search.ts` stops calling the GitHub-only browser directly and delegates to the unified search orchestrator
3. `src/core/search/parse-search-source.ts` parses supported search sources
4. `src/core/search/discovery-policy.ts`, `parse-skill-markdown.ts`, and `discover-local-skills.ts` define shared search discovery semantics
5. `src/core/search/providers/github-api.ts` implements the GitHub fast path
6. `src/core/search/providers/git-clone.ts` implements clone-based discovery
7. `src/core/search/search-source-skills.ts` chooses providers and handles fallback
8. `src/core/search/types.ts` defines the shared result contracts

The existing GitHub-only browsing implementation outside `src/core/search/` should remain in place unless the migrated files already depend on it indirectly.

## Merge Strategy

### Recommended Approach

Apply a file-scoped migration from `unified-search-providers` into `main` using only the included file list above.

Why this approach:

- It matches the requested scope exactly
- It avoids bringing README edits into the working tree and then removing them again
- It keeps the diff easy to inspect against the approved boundary
- It reduces the chance of mixing unrelated branch changes with the current dirty `main` worktree

### Rejected Alternatives

#### Cherry-pick Then Remove README

This would start from `git cherry-pick -n 14ea4ff` and then manually exclude the README files. It is valid, but it unnecessarily broadens the temporary worktree diff and is a poorer fit for the current dirty `main` branch.

#### Manual Reimplementation

Rebuilding the behavior by hand on `main` would be slower and increases the chance of drifting from the already-tested source branch implementation.

## Safety Constraints

- Do not modify or revert existing uncommitted changes in `CHANGELOG.md`, `CHANGELOG.zh-CN.md`, or unrelated files
- Do not stage or commit documentation files that are outside the approved scope
- If the source branch files no longer apply cleanly to `main`, resolve only the minimal compatibility issues needed for the migrated tests to pass
- Prefer direct file adoption from the source branch over editorial cleanup

## Verification

The merge is complete when all of the following are true:

1. The included files on `main` match the intended search implementation from `unified-search-providers`
2. The excluded README files remain unchanged on `main`
3. The relevant tests pass on `main`
4. No unrelated tracked or untracked files were modified as part of the migration

At minimum, verification should cover the migrated search tests and any directly impacted CLI tests.
