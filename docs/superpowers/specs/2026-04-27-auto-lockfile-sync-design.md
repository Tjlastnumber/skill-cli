# Automatic Project Lockfile Sync Design

## Summary

Extend the existing `skills-lock.yaml` workflow so project-scoped source installs and project-scoped removals automatically keep the project lockfile in sync. After a successful `skill install <source> --project`, or a successful `skill remove <bundle-name> --project`, `skill-cli` should regenerate the project-root `skills-lock.yaml` from the current managed project installs instead of requiring the user to run `skill lock` manually.

The automatic path must reuse the same export rules as `skill lock` so manual and automatic lockfile output never diverge.

## Goals

- Eliminate the manual `skill lock` step after project-scoped source installs
- Eliminate the manual `skill lock` step after project-scoped removals
- Keep automatic and manual lockfile generation behavior identical
- Ensure `skills-lock.yaml` reflects the current managed, healthy project install state
- Keep the implementation small by reusing the existing lockfile-generation flow

## Non-Goals

- No automatic lockfile sync for `--global` installs or removals
- No automatic lockfile sync for `--dir <path>` installs or removals
- No automatic lockfile sync after `skill install` lockfile mode
- No incremental lockfile patching logic that appends or removes one source in place
- No rollback of successful install/remove work when automatic lockfile sync fails
- No change to the existing manual `skill lock` command contract

## User Experience

### Automatic Sync Triggers

Automatic lockfile sync runs only in these cases:

1. `skill install <source> --project ...`
2. `skill remove <bundle-name> --project ...`

The install case applies only when a source argument is explicitly provided. The existing lockfile install mode (`skill install` with no source) does not rewrite `skills-lock.yaml`.

### Manual vs Automatic Behavior

`skill lock` remains the explicit command for manually rebuilding a lockfile.

Automatic sync uses the same bundle-selection and source-resolution rules as `skill lock`, but differs in one important case:

- Manual `skill lock`: if no eligible managed project bundles exist, fail with a user-facing error
- Automatic sync: if no eligible managed project bundles exist, delete the existing project-root `skills-lock.yaml`; if it does not exist, do nothing

### Success Cases

#### Project Install

```bash
skill install owner/repo --tool opencode --project
```

Behavior:

1. Install succeeds
2. Project lockfile is regenerated automatically
3. Command completes successfully

#### Project Remove

```bash
skill remove superpowers --tool opencode --project
```

Behavior:

1. Removal succeeds
2. Project lockfile is regenerated automatically
3. If no eligible project bundles remain, `skills-lock.yaml` is deleted

### Failure Cases

#### Install/Remove Fails

If the primary install/remove action fails, automatic sync does not run.

#### Install/Remove Succeeds but Lockfile Sync Fails

If the primary install/remove action succeeds but the automatic lockfile sync fails:

1. The install/remove result is not rolled back
2. The command exits non-zero
3. The error message explicitly states that the primary action succeeded but `skills-lock.yaml` sync failed
4. The suggestion points the user to rerun `skill lock` after fixing the underlying problem

## Architecture

### Reusable Project Lockfile Sync Core

Introduce a reusable internal helper that performs project lockfile synchronization based on the current project state rather than command-specific arguments.

Responsibility:

- Scan current project targets
- Filter to registry-managed, healthy project bundles
- Resolve exact locked sources
- Either write `skills-lock.yaml`, delete it, or raise an error depending on mode

This helper should be the single implementation behind both manual `skill lock` and automatic sync.

### Modes

The helper should support two modes:

#### 1. Manual Rebuild Mode

Used by `runLockCommand()`.

Behavior:

- respect `--output`
- respect `--force`
- error when no eligible managed project bundles exist

#### 2. Automatic Sync Mode

Used after successful project install/remove operations.

Behavior:

- always target the default project-root `skills-lock.yaml`
- do not expose `--force`
- overwrite the lockfile directly as part of sync
- delete the lockfile when no eligible managed project bundles remain
- no-op when deleting a file that does not exist

## Command Responsibilities

### `runLockCommand()`

`runLockCommand()` remains the CLI-facing manual command wrapper. It should delegate its real work to the reusable project lockfile sync core.

### `runInstallCommand()`

`runInstallCommand()` should remain focused on install behavior and registry/link management. It should not directly own automatic lockfile sync.

### `runRemoveCommand()`

`runRemoveCommand()` should remain focused on removal behavior and registry cleanup. It should not directly own automatic lockfile sync.

### CLI Layer

The CLI layer should trigger automatic sync after successful command completion:

- `install` command:
  - if `source` is present
  - and resolved target is `project`
  - and `runInstallCommand()` succeeds
  - then run automatic project lockfile sync

- `remove` command:
  - if resolved target is `project`
  - and `runRemoveCommand()` succeeds
  - then run automatic project lockfile sync

This keeps install/remove command modules reusable while treating automatic sync as a product workflow policy.

## Lockfile Export Rules

Automatic sync must produce the same result as `skill lock` for the same project state.

That means it must only include bundle sources that are:

- installed in the current project's `project` targets
- managed by the registry
- still present and healthy in current project scans

Exact source rules remain unchanged:

- git sources: source plus exact commit SHA
- npm sources: package name plus exact version
- local sources: project-relative path only, after resolving symlinks to ensure the bundle actually stays inside the project root

## Data Flow

### Automatic Sync After Install

1. User runs `skill install <source> --project ...`
2. CLI resolves install inputs
3. `runInstallCommand()` performs install and registry updates
4. On success, CLI invokes automatic project lockfile sync
5. Sync core scans current project state and rebuilds the default `skills-lock.yaml`
6. CLI exits success, or exits failure if sync fails

### Automatic Sync After Remove

1. User runs `skill remove <bundle-name> --project ...`
2. CLI resolves remove inputs
3. `runRemoveCommand()` removes links and registry entries
4. On success, CLI invokes automatic project lockfile sync
5. Sync core either rewrites or deletes the default `skills-lock.yaml`
6. CLI exits success, or exits failure if sync fails

## Error Handling

### Primary Action Failure

- install/remove failure remains the primary error
- automatic sync is skipped

### Automatic Sync Failure After Success

Map to `SkillCliError` with a clear message shaped like:

- install case: install succeeded but automatic lockfile sync failed
- remove case: remove succeeded but automatic lockfile sync failed

Suggestion should point to:

```text
Fix the lockfile sync problem and rerun `skill lock` to resync the project lockfile.
```

### Empty Project State

- automatic sync deletes `skills-lock.yaml`
- manual `skill lock` still errors

### `--tool all`

If `install` or `remove` runs with `--tool all` against project targets, automatic sync should run once after the primary action completes, not once per tool.

## Testing Strategy

### Unit and Command Tests

- `skill install <source> --project` creates `skills-lock.yaml` automatically
- a second successful project install rewrites `skills-lock.yaml` to reflect the full current managed project state
- `skill remove <bundle-name> --project` rewrites `skills-lock.yaml` and removes the deleted bundle source
- removing the last eligible managed project bundle deletes `skills-lock.yaml`
- `--global` install/remove does not create or update the project lockfile
- `--dir <path>` install/remove does not create or update the project lockfile
- lockfile install mode does not auto-rewrite `skills-lock.yaml`
- automatic sync output matches the same state exported by manual `skill lock`
- install/remove success followed by sync failure returns a final error with the expected message and suggestion
- install/remove failure skips automatic sync
- `--tool all` runs automatic sync only once per top-level command

### Regression Tests

- automatic sync uses project-root lockfile semantics identical to manual `skill lock`
- empty-project automatic sync deletes a stale lockfile
- sync failure does not roll back successful install/remove side effects

## Acceptance Criteria

- Project-scoped source installs automatically create or update `skills-lock.yaml`
- Project-scoped removals automatically update or delete `skills-lock.yaml`
- Automatic and manual lockfile generation produce the same bundle-source set for the same project state
- Global/custom-target commands do not touch the project lockfile
- Lockfile install mode does not rewrite the lockfile
- Sync failure after a successful install/remove is reported clearly without rolling back the primary action
