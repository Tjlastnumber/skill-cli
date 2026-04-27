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
- capturing project skill sources in `skills-lock.yaml` so the same setup can be recreated across machines

## Features

- Install skills from `git`, `npm`, or local paths
- Generate `skills-lock.yaml` from managed project installs with `skill lock`
- Install all bundle sources from `skills-lock.yaml` with `skill install`
- Search repository-root and nested skills from public GitHub repositories without cloning
- Manage skills for `claude-code`, `codex`, and `opencode`
- Install targets: `--global`, `--project`, and `--dir <path>`
- Bundle-level registry with member tracking
- `managed` vs `discovered` visibility in `list`
- Registry backfill for existing installs via `register`
- Health checks and repair flows via `doctor` and `relink`
- Store cleanup via `prune`

Git installs resolve the requested branch, tag, or remote `HEAD` to a concrete commit before persisting to `~/.skills/store`, so the same repository commit is stored once and reused across projects.

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

Generate a project lockfile from the currently installed managed project bundles:

```bash
skill lock
```

Install from `skills-lock.yaml` in the current project:

```bash
skill install --tool opencode --project
```

Run the same lockfile install flow without a global install:

```bash
npx @tjlastnumber/skill-cli install --tool opencode --project
```

List bundles:

```bash
skill list --tool opencode
skill list --tool opencode --expand
```

Search a public GitHub repository on its default branch, including a repository-root `SKILL.md` and nested skill files:

```bash
skill search https://github.com/owner/repo
```

Filter search results with a case-insensitive substring match against skill name, description, or path:

```bash
skill search https://github.com/owner/repo --filter browser
```

Repair registry from already installed links:

```bash
skill register --tool opencode
skill doctor --tool opencode --repair-registry
```

## Command reference

| Command | Description |
| --- | --- |
| `skill search <github-repo-url> [--filter <text>]` | Search a public GitHub repository default branch for a repository-root `SKILL.md` and nested skill files without cloning; `--filter` does a case-insensitive substring match against skill name, description, and path |
| `skill install [source] [--tool <tool-or-all>] [one target: --global / --project / --dir <path>]` | Install one bundle from git/npm/local source, or install all bundle sources from `skills-lock.yaml` when `source` is omitted |
| `skill lock [--tool <tool-or-all>] [--output <path>] [--force]` | Generate `skills-lock.yaml` from currently installed managed project bundles |
| `skill list [--tool <tool-or-all>] [--status <all,managed,discovered>] [--expand]` | List bundles and optionally expand member skills |
| `skill remove <bundle-name> --tool <tool-or-all> (one target: --global / --project / --dir <path>)` | Remove an installed bundle |
| `skill register [--tool <tool-or-all>]` | Backfill registry from discovered installs |
| `skill doctor [--tool <tool-or-all>] [--repair-registry]` | Validate install state and optionally repair registry |
| `skill relink [--tool <tool-or-all>]` | Recreate missing or broken symlinks |
| `skill prune` | Remove unreferenced store entries |

When `skill install` runs in an interactive terminal, missing install inputs are prompted in this order: install scope first, then custom directory path when scope is `--dir`, then tool selection. Tool selection supports configured tool ids and `all`.

In non-interactive environments, missing required install inputs do not trigger prompts. The command exits with a user-input error instead.

## Lockfiles

`skill lock` writes `skills-lock.yaml` at the project root by default. It only emits sources from bundles that are:

- installed in the current project's `project` targets
- managed by the registry
- still present and healthy in the current project scan

`skill install` with no `source` argument reads `skills-lock.yaml` from the project root and installs each listed bundle source sequentially.

Generated lockfiles use this shape:

```yaml
version: 1
bundles:
  - source: git@github.com:obra/superpowers.git#0123456789abcdef0123456789abcdef01234567
  - source: "@acme/skills@1.2.3"
  - source: ./skills/local-bundle
```

Notes:

- generated local bundle sources must live inside the project root so they can be written as project-relative paths
- relative sources in `skills-lock.yaml` are resolved from the project root, not the nested shell cwd

## How it works

1. Resolve source (`git`, `npm`, or local path)
2. For git sources, resolve the requested ref to a concrete remote commit SHA
3. Fetch and persist into local store (default `~/.skills`)
4. Discover skill members via tool rules (default `**/SKILL.md`)
5. Create symlinks in target tool directories
6. Track bundle + members in registry (`registry.json`)

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
