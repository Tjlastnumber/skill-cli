# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
