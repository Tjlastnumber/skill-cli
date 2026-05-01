# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-05-01

### Added

- Add repeatable `skill prune --dir <path>` support so store cleanup can preserve active custom-directory installs.

### Changed

- Derive managed and discovered install state from live symlink scans plus project `skills-lock.yaml` instead of maintaining a central `registry.json`.
- Expand `doctor` to validate live install state, compare current project installs against `skills-lock.yaml`, and surface managed project bundle provenance problems.

### Removed

- Remove `skill register`, `skill relink`, and `doctor --repair-registry`.
- Remove central registry-backed install-state persistence from normal install, list, remove, doctor, lock, and prune workflows.

### Fixed

- Keep local-source provenance distinct even when two different local source directories have identical contents.
- Stop `skill lock` and automatic project lockfile sync from silently clearing lockfiles when managed project bundles still exist but their source provenance is no longer recoverable.

## [0.5.0] - 2026-04-28

### Added

- Add `skill install <source> --skill <name>` with repeatable `--skill` support, including `--skill '*'` for installing every discovered skill from a source.
- Keep previously installed named skills when the same source is installed again with different `--skill` selections for the same tool and target.
- Auto-sync the default project `skills-lock.yaml` after successful `skill install <source> --project` and `skill remove <bundle-name> --project` operations.

### Changed

- Change `skills-lock.yaml` from bundle-based v1 entries to skill-based v2 entries and drop v1 compatibility; regenerate existing lockfiles with `skill lock --force`.

### Fixed

- Stop restoring previously full-installed project skills from stale registry state after the project skill links were deleted and a later `skill install --skill <name>` only requests one skill.

## [0.4.0] - 2026-04-27

### Added

- Add `skill lock` to generate `skills-lock.yaml` from managed project bundle sources.
- Add lockfile-based `skill install` and interactive prompts for missing install scope, tool, and custom directory inputs.

### Fixed

- Deduplicate git bundle installs by resolved commit so the same repository revision is stored once and reused across refs.

## [0.3.1] - 2026-04-24

### Fixed

- Fix GitHub Actions publish workflow by using the `packageManager` pnpm version instead of specifying a second pnpm version in the workflow.

## [0.3.0] - 2026-04-24

### Changed

- Rename the public GitHub repository skills command from `skill browse` to `skill search`.

## [0.2.0] - 2026-04-24

### Added

- Add `skill browse <github-repo-url> [--filter <text>]` for browsing public GitHub repository skills without cloning.
- Add remote GitHub skill discovery for repository-root and nested `SKILL.md` files on the default branch.
- Add description extraction from `SKILL.md` frontmatter or the first body paragraph for browse results.

### Fixed

- Fail explicitly when the GitHub recursive tree API returns a truncated response instead of returning partial skill lists.

## [0.1.1] - 2026-04-10

### Added

- Initial public release of `@tjlastnumber/skill-cli`.
- Core CLI command set: `install`, `list`, `remove`, `register`, `doctor`, `relink`, `prune`.
- Source installation support for local paths, git repositories, and npm packages.
- Tool support for `claude-code`, `codex`, and `opencode`.
- Install target modes: `--global`, `--project`, and `--dir`.
- Bundle-level skill management with member tracking.
- Registry backfill capability for already installed skills (`register` and `doctor --repair-registry`).
- Bundle/member inspection via `list --expand` and status filtering via `list --status`.
- Link recovery via `relink` and store cleanup via `prune`.
- Open-source project docs1(`README.md`, `README.zh-CN.md`) and MIT licensing.
