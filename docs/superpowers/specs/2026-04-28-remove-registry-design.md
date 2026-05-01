# Registryless Install State Design

## Summary

Remove the persisted install registry from `skill-cli`. The repository does not use a `register.json` file today; the real persisted file is `registry.json`. This design removes both the `skill register` workflow and the broader `registry.json` dependency so command behavior is derived from the current filesystem state, store metadata, and the current project's `skills-lock.yaml` where project-scoped intent is relevant, instead of a separately maintained registry snapshot.

The motivation is reliability. Users can manually delete local skills directories without running a cleanup command first. A persisted registry then drifts away from reality and causes command behavior to depend on stale metadata. After this change, live symlink scans become the source of truth.

## Goals

- Remove `skill register`
- Remove `doctor --repair-registry`
- Stop creating, reading, migrating, or updating `registry.json`
- Rebuild command behavior from current live installs and existing store metadata
- Reuse the current project's `skills-lock.yaml` as project-scoped desired-state input when it exists
- Keep installed-store bundles identifiable via `.skill-cli-source.json`
- Preserve the current install, remove, list, doctor, lock, and prune product surface where the behavior can be derived reliably from live state
- Prefer small changes that reuse existing scan and bundle-grouping logic

## Non-Goals

- No backward-compatible support for partial registry behavior
- No replacement persisted state file for bundle membership tracking
- No attempt to remember previously used custom `--dir` targets across future runs
- No attempt to recover deleted symlinks after the fact
- No attempt to preserve the current `skill relink` contract without a reliable source of truth
- No historical changelog rewrite

## User Experience

### Removed Commands and Flags

These entry points are removed from the CLI:

- `skill register`
- `skill doctor --repair-registry`
- `skill relink`

If users try to use the removed commands after the change, the CLI should behave like any other unknown command or unknown option case handled by `commander`.

### Source of Truth

The source of truth becomes:

1. The current symlinks under the selected target directories
2. Whether those symlinks point into the skill-cli store
3. The metadata persisted beside stored sources in `.skill-cli-source.json`
4. The current project's `skills-lock.yaml` for project-scoped desired state and recovery

Behavior should no longer depend on whether a prior registration step happened.

`skills-lock.yaml` is not a universal replacement for the registry. It applies only to project-scoped flows rooted at the current project. Global and custom-directory behavior must still come from live scan results.

### `list` Semantics

`list` keeps the `managed` and `discovered` vocabulary, but the meaning changes:

- `managed`: a live installed bundle whose members point into the skill-cli store and can be grouped into a bundle from current scan results
- `discovered`: a live installed bundle that exists in scan results but does not resolve to a skill-cli-managed stored source

This keeps the current UX shape while eliminating the registry-backed interpretation of “managed”.

### `doctor` Semantics

`doctor` becomes a pure validation command over live state.

It should still report:

- managed bundle count
- discovered bundle count
- broken symlink count

It should no longer suggest `skill register` or perform repair by backfilling registry state.

When a project `skills-lock.yaml` exists, `doctor` may also use it as project-scoped intent input to report drift between declared project skills and currently installed project skills.

It should otherwise stop claiming it can detect silently missing intended members once the symlink entry itself is gone. Without persisted per-install membership state, that distinction is not recoverable for global and custom targets. After this change, `doctor` is authoritative for live and broken entries everywhere, and can use `skills-lock.yaml` only for current-project intent.

### Custom Directory Behavior

Custom directory scans remain supported only when the user passes `--dir <path>` for the current command.

The previous behavior that reused old registry entries to remember custom scan roots is removed. After this change:

- `list --dir <path>` scans that path for the current run only
- `doctor --dir <path>` scans that path for the current run only
- `remove --dir <path>` operates on that path for the current run only
- `install --dir <path>` installs there and does not persist that target for future discovery
- `prune --dir <path>` includes that custom directory for the current run only

Because `prune` can delete store content, it should accept repeatable `--dir <path>` input so users can protect multiple active custom directories in one run without relying on persisted scan roots.

## Architecture

### Reuse Existing Scan Pipeline

The implementation should keep the existing discovery path centered on:

- `scanInstalledSkills()`
- `groupScannedSkillsIntoBundles()`
- `parseStoredSourceFromPath()`
- `.skill-cli-source.json` metadata read by bundle identity helpers

These pieces already know how to:

- identify live symlinked installs
- detect broken symlinks
- determine whether an installed skill points into the managed store
- infer bundle identity for stored sources and external sources

### Reuse Project Lockfile As Intent Metadata

The existing `skills-lock.yaml` flow should become an explicit part of the registryless design for project scope.

It should be treated as:

- a project-local desired-state file
- the recovery source for `skill install` lockfile mode
- optional comparison input for project-scoped validation

It should not be treated as:

- a source of truth for global installs
- a source of truth for custom-directory installs
- a liveness signal for `prune`

### Remove Registry Infrastructure

Delete the registry persistence layer entirely:

- `src/core/registry/registry.ts`
- `src/commands/register.ts`

Also remove any import sites or code paths that reference:

- `loadRegistry()`
- `upsertRegistryBundles()`
- `removeRegistryBundles()`

### Replace Registry-Managed State With Live Managed State

Commands that currently depend on registry entries should instead derive bundle state from current grouped scan results.

The key rule is:

- if a grouped bundle has a non-`unknown` store-backed `cacheKey` and a store-backed `storedSourceDir`, it is treated as managed
- otherwise it is treated as discovered

This rule intentionally ties “managed” to the current symlink target and store layout, not to historical bookkeeping.

This also means commands lose the ability to distinguish:

- an intentionally partial install
- a once-managed member that was later deleted without leaving a broken symlink behind

For the current project, `skills-lock.yaml` can narrow this ambiguity by preserving desired source and skill selections. The design still accepts the ambiguity outside project scope in exchange for removing the stale central registry.

### Store Metadata Remains

Keep `.skill-cli-source.json` as the persisted metadata file inside each stored source directory.

It remains necessary because it provides:

- stable bundle naming
- canonical source kind
- canonical source string for lockfile export

This metadata is colocated with the stored source and naturally disappears with the source, unlike a central registry.

## Command Responsibilities

### `install`

`install` should keep its current store-persist and symlink-creation workflow, but stop writing any central registry file.

To preserve current partial-install and refresh behavior, `install` should:

1. resolve the destination target root
2. scan the live installed bundles for that tool and target
3. find the current managed bundle, if any, by logical identity derived from live bundles rather than registry entries
4. merge requested skills with already live managed members when doing selective installs
5. refresh or remove links based on current live membership

This preserves the valuable current behavior without central state.

### `remove`

`remove` should stop looking up bundles from registry.

Instead, for each selected tool and resolved target root, it should:

1. scan current live installed bundles for that target
2. match bundles by `bundleName`
3. remove the matched live link paths

The command result should no longer mention removed registry entries.

For project targets, `remove` still works primarily from live bundles. Any desired-state cleanup remains mediated by the existing lockfile sync flow rather than by directly editing `skills-lock.yaml` as a separate source of truth.

### `list`

`list` should be purely scan-based.

It should:

1. resolve default scan roots plus any explicit `--dir`
2. scan live installs
3. group bundles
4. split grouped results into `managed` vs `discovered`
5. print the same section-oriented output shape as today

If a status filter asks for `managed`, the filter now applies to live store-backed bundles only.

### `doctor`

`doctor` should also be purely scan-based.

It should:

1. resolve default scan roots plus any explicit `--dir`
2. scan live installs including broken symlinks
3. group valid bundles
4. classify bundles as managed/discovered from live state
5. detect broken symlinks directly from scan results
6. when running in a project with `skills-lock.yaml`, optionally compare declared project entries against currently installed project bundles

It should not:

- suggest a registration step
- backfill any central metadata
- delete stale central metadata
- infer that a deleted-but-absent symlink was previously intended to exist outside the scope of current-project lockfile intent

### `lock`

`lock` should export directly from live managed project bundles rather than registry-managed project bundles.

Eligible bundles become:

- target type `project`
- currently present in the current project scan
- managed by virtue of being store-backed
- healthy enough to resolve all required source data

The existing source-resolution rules stay the same:

- git: exact source plus commit SHA
- npm: exact package plus version
- local: project-relative path only if the stored source maps to a path inside the project root

### `prune`

`prune` should compute live cache keys from current managed bundle scans instead of registry bundles.

It should keep store entries only when at least one current live managed bundle references that `cacheKey`.

This means prune behavior follows actual currently installed symlinks rather than historical installs.

To avoid deleting store entries that are still referenced from custom directories, `prune` should add repeatable `--dir <path>` support and include those directories in its scan set for the current run.

`prune` should ignore `skills-lock.yaml` when deciding store liveness. Declared desired state is not the same as currently referenced store state, and project installs can be recreated from the lockfile later if needed.

### `relink`

Remove `relink`.

Without a central registry, the CLI no longer has a reliable record of which symlinks should exist after they have already been deleted. Reconstructing that behavior from remaining store content alone would be guessy and risks recreating links the user intentionally removed.

## Data Flow

### Managed Bundle Detection

1. Resolve scan targets for the current command
2. Scan live entries from the filesystem
3. Group scanned entries into bundles
4. For each grouped bundle, inspect `cacheKey` and `storedSourceDir`
5. Treat store-backed groups as managed and external groups as discovered

### Install Refresh Without Registry

1. Persist the fetched source in the store
2. Write `.skill-cli-source.json`
3. Scan the current target root before mutating links
4. Match an existing live managed bundle for the same logical bundle identity
5. Use that live bundle membership to decide which members to retain, add, refresh, or remove
6. Apply link mutations

### Remove Without Registry

1. Resolve the requested target root
2. Scan the current target root
3. Group bundles
4. Match by bundle name
5. Remove currently live link paths for the matched bundle

### Lock/Prune Without Registry

1. Scan the current relevant target roots
2. Group live bundles
3. Filter to managed store-backed bundles
4. Export locked sources or collect live cache keys from those bundles

### Project Recovery Without Registry

1. User remains in a project with `skills-lock.yaml`
2. The project skills directory is deleted or partially removed
3. Live scans reflect the missing state immediately
4. `doctor` can use `skills-lock.yaml` to report project drift when applicable
5. `skill install` with no explicit source can reinstall from `skills-lock.yaml`

## Error Handling

### Missing or Deleted Skill Directories

If users manually delete installed links or the skills directory, commands should simply reflect that live state:

- `list` stops showing the deleted bundles
- `doctor` reports broken symlinks if broken links remain
- `prune` can reclaim store entries once no live managed bundle references them

If the deleted state is inside a project that still has `skills-lock.yaml`, the lockfile remains the recovery path for reinstalling the intended project skills.

No command should fail because a missing central registry entry cannot be found.

### Partially Broken Managed Bundles

For store-backed bundles where some members remain live and broken symlink entries still exist for others:

- `doctor` should continue surfacing stale or broken state
- `lock` should exclude bundles that are not healthy enough for reliable export
- `install` can still reconcile the bundle on the next install of the same source

If a member symlink is fully deleted and no broken entry remains, the system cannot distinguish that case from an intentional partial install. That ambiguity is accepted.

For current-project installs backed by `skills-lock.yaml`, `doctor` may still report project drift at the source-or-skill-selection level even when a deleted symlink no longer exists on disk.

### Unknown External Installs

Symlinks pointing outside the store remain visible as `discovered` but cannot participate in:

- lockfile export
- store pruning decisions
- managed bundle refresh logic

### Manual `--dir` Omission

If a user previously installed into a custom directory and later runs `list`, `doctor`, or `remove` without `--dir`, that directory is not scanned. This is an intentional change in favor of explicitness and removal of stale central state.

## Testing Strategy

### Command Tests to Remove

- delete `test/register-command.test.ts`
- delete `test/registry-migration.test.ts`

### Command Tests to Rewrite

- `test/install-command.test.ts`
  - stop asserting on `registry.json`
  - assert live scan behavior, store metadata, refresh behavior, and safe link mutation behavior instead
- `test/remove-command.test.ts`
  - assert removal based on live grouped bundles and updated result reporting
- `test/list-command.test.ts`
  - assert managed/discovered status comes from live store-backed vs external bundles
- `test/doctor-command.test.ts`
  - remove register suggestions and repair-registry behavior
  - keep broken-link coverage
  - replace registry-backed stale-member expectations with project lockfile drift expectations where appropriate
- `test/lock-command.test.ts`
  - remove registry fixture setup and derive eligible bundles from live managed project scans
- `test/prune-command.test.ts`
  - add coverage for explicit repeatable `--dir` protection of active custom-dir installs
- `test/search-command.test.ts`
  - no changes required because its “register” usage is unrelated CLI command registration language

### New Expectations

- install writes store metadata but no `registry.json`
- remove works for live managed bundles without prior registry state
- list correctly reports live managed and discovered bundles
- doctor reports live counts and problems without offering registry repair
- doctor can use current-project `skills-lock.yaml` as intent input when available
- lock exports from live managed project bundles only
- prune removes unreferenced store entries based on live bundle scans only
- custom `--dir` behavior works only when explicitly supplied for the current command
- prune preserves active custom-dir installs only when those directories are supplied explicitly
- relink command is no longer present in the CLI

## Documentation Changes

Update:

- `README.md`
- `README.zh-CN.md`
- `docs/TODO.md`

Remove mentions of:

- `register`
- `repair-registry`
- registry backfill
- `registry.json` as the central source of truth

Update product descriptions so they explain:

- live scan based managed/discovered classification
- project-scoped use of `skills-lock.yaml` for desired state and recovery
- explicit custom-dir scanning
- removal of relink support

Historical changelog entries may remain as-is.

## Acceptance Criteria

- `skill register` is removed
- `skill doctor --repair-registry` is removed
- `skill relink` is removed
- `skill-cli` no longer reads or writes `registry.json`
- install, remove, list, doctor, lock, and prune derive behavior from live filesystem state plus store metadata, with `skills-lock.yaml` as a project-scoped desired-state input
- `list` still exposes `managed` and `discovered` views with the new live-state semantics
- broken symlink conditions are still detectable via `doctor`
- `doctor` can use current-project `skills-lock.yaml` to detect project drift, but does not depend on historical central membership state
- lockfile generation continues to work for healthy live managed project bundles
- store pruning keeps only cache entries referenced by current live managed bundles
- `prune` can include active custom directories only when the user passes explicit repeatable `--dir` flags
- docs and tests no longer describe registry-based workflows
