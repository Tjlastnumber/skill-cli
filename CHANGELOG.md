# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
