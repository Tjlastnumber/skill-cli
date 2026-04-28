# skill-cli v1 Todo List

## Usage Notes

- Status values: `pending`, `in_progress`, `blocked`, `done`
- Priority values: `P0`, `P1`, `P2`
- Keep this file updated as implementation progresses.

## Phase 0 - Project Setup

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T001 | Initialize Node.js + TypeScript CLI project skeleton | P0 | done | Includes build/dev/test scripts and project layout |
| T002 | Add command framework (recommended: commander) | P0 | done | Base CLI with command skeleton is in place |
| T003 | Add shared error model and exit code map | P1 | done | `src/core/errors.ts` added |
| T004 | Add logging and output formatting utility | P1 | done | `src/core/output.ts` added |

## Phase 1 - Configuration System

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T101 | Implement global/project config loading | P0 | done | Implemented in `src/core/config/load.ts` |
| T102 | Implement config merge priority (flags > env > project > global > defaults) | P0 | done | Covered by tests |
| T103 | Implement config schema validation | P0 | done | Zod schemas and invalid-config tests added |
| T104 | Ship built-in tool defaults for claude-code/codex/opencode | P0 | done | Implemented in `src/core/config/defaults.ts` |
| T105 | Implement dynamic tool extension via config | P1 | in_progress | Merge path supports custom tool keys; needs dedicated tests |

## Phase 2 - Source Resolution and Fetch

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T201 | Implement source string parser (auto-detect local/git/npm) | P0 | done | `src/core/source/parse.ts` + parser tests added |
| T202 | Implement local path source handler | P0 | done | Implemented in `src/core/source/fetch.ts` |
| T203 | Implement git source handler (public/private) | P0 | done | Git clone handler implemented with shell runner injection |
| T204 | Implement npm source handler (public/private) | P0 | done | `pnpm pack` + `tar` extraction handler implemented |
| T205 | Implement source fetch cache key strategy | P1 | done | `src/core/source/cache-key.ts` implemented |

## Phase 3 - Store and Discovery

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T301 | Implement canonical store layout under `~/.skills` (configurable) | P0 | done | Implemented with cache-keyed store paths |
| T302 | Implement per-tool discovery via configured `entryPattern` | P0 | done | Discovery implemented (current matcher supports common patterns) |
| T303 | Implement skill naming strategy (`parentDir` default) | P0 | done | Implemented with duplicate name checks |
| T304 | Implement discovery diagnostics output | P1 | pending | Show matched entries and skipped paths |

## Phase 4 - Linking and Live State

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T401 | Implement target path resolver for `--global/--project/--dir` | P0 | done | Implemented in install workflow |
| T402 | Implement symlink creation engine | P0 | done | Implemented in `src/core/linker/link-skill.ts` |
| T403 | Implement conflict policy + `--force` | P0 | done | Existing target blocks by default; `--force` replaces |
| T404 | Remove registry persistence and derive install state from live scans | P0 | done | Registryless live-state model is in place |
| T405 | Implement idempotent install behavior | P1 | in_progress | Symlink idempotency is in place; broader flow tests pending |

## Phase 5 - Commands

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T501 | Implement `install` command | P0 | done | Source parse/fetch/store/discovery/link path implemented |
| T502 | Implement `remove` command | P0 | done | Removes live managed bundles and project selections |
| T503 | Implement `list` command | P0 | done | Bundle-level managed/discovered output with filters/expand from live scans |
| T504 | Implement `doctor` command | P0 | done | Summary checks plus project drift guidance from live state and `skills-lock.yaml` |
| T505 | Remove `relink` command from project scope | P1 | done | Recovery now comes from reinstalling desired state via `skills-lock.yaml` |
| T506 | Implement `prune` command | P1 | done | Removes unreferenced store cache directories with size summary |
| T507 | Remove `register` command from project scope | P1 | done | Registry backfill is no longer part of the product |

## Phase 6 - Multi-Tool and Batch UX

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T601 | Implement `--tool all` execution flow | P0 | done | Per-tool execution with partial-failure handling |
| T602 | Implement per-tool result aggregation report | P0 | in_progress | Install/list/remove summaries implemented; richer all-tool failure report pending |
| T603 | Implement consistent machine-readable exit codes | P1 | pending | Useful for CI scripting |

## Phase 7 - Testing

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T701 | Unit tests: config module | P0 | done | Config load/merge/validation tests added |
| T702 | Unit tests: source parser and handlers | P0 | done | Added parser/cache/fetch test coverage |
| T703 | Unit tests: discovery and naming | P0 | in_progress | Covered indirectly through install tests; dedicated tests pending |
| T704 | Unit tests: linker and conflict logic | P0 | in_progress | Covered indirectly through install conflict tests |
| T705 | Integration tests: install/remove/list | P0 | done | Added install/list/remove integration-style tests |
| T706 | Integration tests: doctor/prune | P1 | done | Added doctor/prune command tests for live-state workflows |
| T707 | Integration tests: `--tool all` partial failure behavior | P1 | pending | Aggregated result correctness |
| T708 | Integration tests: discovered/managed list and command removals | P1 | done | Added live-state list coverage and CLI removal tests |

## Phase 8 - Documentation and Release Prep

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T801 | Write README quickstart and command reference | P0 | pending | Include examples for global/project/custom |
| T802 | Document private source auth behavior | P0 | pending | Clarify credential pass-through model |
| T803 | Add sample config for custom tool extensions | P1 | pending | Demonstrate adding a new tool id |
| T804 | Add troubleshooting section | P1 | pending | Common fs/auth/link issues |
| T805 | Final release checklist and versioning | P1 | pending | Verify acceptance criteria |

## Acceptance Gate Checklist

- [ ] All P0 tasks complete
- [ ] Commands work for claude-code, codex, opencode
- [ ] `--tool all` works with summary output
- [ ] Only symlinks are written to target skill directories
- [ ] Private source workflows validated with existing credentials
- [ ] `doctor` can detect and report broken links and config errors
- [x] `prune` behavior verified in integration tests
