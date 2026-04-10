# @tjlastnumber/skill-cli

English | [简体中文](README.zh-CN.md)

`skill-cli` is a local CLI for installing and managing AI coding-agent skills across multiple tools using a shared local store and symlink-based targets.

It is designed for developers who use more than one agent CLI and want a single workflow for install, list, repair, and cleanup.

## Why this project

Different coding CLIs use different skill directories. Managing the same skill set in several places is repetitive and easy to break.

`skill-cli` solves this by:

- keeping one canonical local store
- linking skills into tool directories instead of copying files
- tracking installs with a bundle-aware local registry

## Features

- Install skills from `git`, `npm`, or local paths
- Manage skills for `claude-code`, `codex`, and `opencode`
- Install targets: `--global`, `--project`, and `--dir <path>`
- Bundle-level registry with member tracking
- `managed` vs `discovered` visibility in `list`
- Registry backfill for existing installs via `register`
- Health checks and repair flows via `doctor` and `relink`
- Store cleanup via `prune`

## Installation

```bash
npm i -g @tjlastnumber/skill-cli
```

Then verify:

```bash
skill --help
```

## Quick start

Install a bundle into your current project for OpenCode:

```bash
skill install git@github.com:obra/superpowers.git --tool opencode --project
```

List bundles:

```bash
skill list --tool opencode
skill list --tool opencode --expand
```

Repair registry from already installed links:

```bash
skill register --tool opencode
skill doctor --tool opencode --repair-registry
```

## Command reference

| Command | Description |
| --- | --- |
| `skill install <source> --tool <tool-or-all> (one target: --global / --project / --dir <path>)` | Install bundle from git/npm/local source |
| `skill list [--tool <tool-or-all>] [--status <all,managed,discovered>] [--expand]` | List bundles and optionally expand member skills |
| `skill remove <bundle-name> --tool <tool-or-all> (one target: --global / --project / --dir <path>)` | Remove an installed bundle |
| `skill register [--tool <tool-or-all>]` | Backfill registry from discovered installs |
| `skill doctor [--tool <tool-or-all>] [--repair-registry]` | Validate install state and optionally repair registry |
| `skill relink [--tool <tool-or-all>]` | Recreate missing or broken symlinks |
| `skill prune` | Remove unreferenced store entries |

## How it works

1. Resolve source (`git`, `npm`, or local path)
2. Fetch and persist into local store (default `~/.skills`)
3. Discover skill members via tool rules (default `**/SKILL.md`)
4. Create symlinks in target tool directories
5. Track bundle + members in registry (`registry.json`)

## Supported tools and defaults

- `claude-code`
  - global: `~/.claude/skills`
  - project: `.claude/skills`
- `codex`
  - global: `~/.codex/skills`
  - project: `.codex/skills`
- `opencode`
  - global: `~/.config/opencode/skills`
  - project: `.opencode/skills`

You can extend tool definitions in config.

## Local development

```bash
pnpm install
pnpm test
pnpm build
pnpm verify:manual
```

Link local CLI binary globally:

```bash
pnpm link --global
skill --help
```

## Project status

Active development. Core install/list/remove/register/doctor/relink/prune flows are implemented and covered by tests.

## Contributing

Issues and PRs are welcome. If you plan a larger change, open an issue first to align on scope and behavior.

## License

This project is licensed under the MIT License. See `LICENSE` for details.
