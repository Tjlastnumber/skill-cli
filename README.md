# @tjlastnumber/skill-cli

English | [简体中文](README.zh-CN.md)

`skill-cli` is a local CLI for installing and managing AI coding-agent skills across multiple tools using a shared local store and symlink-based targets.

It is designed for developers who use more than one agent CLI and want a single workflow for install, list, recovery, and cleanup.

## Why this project

Different coding CLIs use different skill directories. Managing the same skill set in several places is repetitive and easy to break.

`skill-cli` solves this by:

- keeping one canonical local store
- linking skills into tool directories instead of copying files
- deriving install state from live symlinked bundles
- capturing project skill sources in `skills-lock.yaml` so the same setup can be recreated across machines as desired state

## Features

- Install skills from `git`, `npm`, or local paths
- Install specific skills by name with `skill install --skill <name>` or `--skill '*'`
- Generate skill-level `skills-lock.yaml` v2 from managed project installs with `skill lock`
- Auto-sync `skills-lock.yaml` on `skill install <source> --project` and `skill remove <bundle-name> --project`
- Install all locked sources from `skills-lock.yaml` with `skill install` when `source` is omitted
- Search repository-root and nested skills from public GitHub repositories without cloning
- Manage skills for `claude-code`, `codex`, and `opencode`
- Install targets: `--global`, `--project`, and `--dir <path>`
- `managed` vs `discovered` visibility in `list`, derived from live installed bundles
- Project recovery and desired state via `skills-lock.yaml`
- Health checks and project drift guidance via `doctor`
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

Install only one discovered skill by name (`'*'` means all skills and should be quoted in shells):

```bash
skill install git@github.com:obra/superpowers.git --tool opencode --project --skill using-superpowers
skill install git@github.com:obra/superpowers.git --tool opencode --project --skill '*'
```

Repeated installs from the same `source` accumulate named skills for the same tool + target instead of replacing earlier selections.

That project install also creates or updates `skills-lock.yaml` automatically.

Rebuild the project lockfile manually from the current managed project installs:

```bash
skill lock
```

Install from `skills-lock.yaml` in the current project:

```bash
skill install --tool opencode --project
```

This lockfile-driven install reads `skills-lock.yaml` but does not rewrite it.

Remove a managed project bundle and auto-sync the lockfile:

```bash
skill remove superpowers --tool opencode --project
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

## Command reference

| Command | Description |
| --- | --- |
| `skill search <github-repo-url> [--filter <text>]` | Search a public GitHub repository default branch for a repository-root `SKILL.md` and nested skill files without cloning; `--filter` does a case-insensitive substring match against skill name, description, and path |
| `skill install [source] [--skill <name>]... [--tool <tool-or-all>] [one target: --global / --project / --dir <path>]` | Install one source from git/npm/local input, optionally restricting the install to specific skill names; `--project` installs with an explicit `source` auto-create or update `skills-lock.yaml`; when `source` is omitted, install all locked source groups from `skills-lock.yaml` without rewriting it |
| `skill lock [--tool <tool-or-all>] [--output <path>] [--force]` | Manually generate or rebuild skill-level `skills-lock.yaml` v2 entries from currently installed live managed project skills |
| `skill list [--tool <tool-or-all>] [--status <all,managed,discovered>] [--expand]` | List bundles and optionally expand member skills; `managed` vs `discovered` comes from the current live install scan |
| `skill remove <bundle-name> --tool <tool-or-all> (one target: --global / --project / --dir <path>)` | Remove an installed bundle; `--project` removals auto-update the default `skills-lock.yaml` and delete it when no eligible managed project skills remain |
| `skill doctor [--tool <tool-or-all>] [--dir <path>]` | Validate live install state and report project drift against `skills-lock.yaml` |
| `skill prune` | Remove unreferenced store entries |

When `skill install` runs in an interactive terminal, missing install inputs are prompted in this order: install scope first, then custom directory path when scope is `--dir`, then tool selection. Tool selection supports configured tool ids and `all`.

In non-interactive environments, missing required install inputs do not trigger prompts. The command exits with a user-input error instead.

## Lockfiles

`skill lock` is the manual rebuild command. It writes `skills-lock.yaml` at the project root by default. It only emits skill entries from installs that are:

- installed in the current project's `project` targets
- identified as managed in the current live project scan
- still present and healthy in the current project scan

`skill install <source> --project` automatically creates or updates the default project-root `skills-lock.yaml` after the install succeeds.

`skill remove <bundle-name> --project` automatically updates the default project-root `skills-lock.yaml` after the removal succeeds. If no eligible managed project skills remain, the auto-synced default lockfile is deleted.

`skill install` with no `source` argument reads `skills-lock.yaml` from the project root, groups entries by `source`, and installs each source sequentially, but it does not rewrite the lockfile.

Lockfile v1 is no longer supported. Regenerate older files with `skill lock --force`.

Generated lockfiles use this shape:

```yaml
version: 2
skills:
  - source: git@github.com:obra/superpowers.git#0123456789abcdef0123456789abcdef01234567
    name: "*"
  - source: "@acme/skills@1.2.3"
    name: browser
  - source: ./skills/local-bundle
    name: debugger
```

Notes:

- `name: "*"` means "install every discovered skill from this source"
- generated local sources must live inside the project root so they can be written as project-relative paths
- relative sources in `skills-lock.yaml` are resolved from the project root, not the nested shell cwd
- when no eligible managed project skills remain, `skill lock` fails in manual mode, while automatic project sync removes the default lockfile if present and otherwise leaves no file behind

## How it works

1. Resolve source (`git`, `npm`, or local path)
2. For git sources, resolve the requested ref to a concrete remote commit SHA
3. Fetch and persist into local store (default `~/.skills`)
4. Discover skill members via tool rules (default `**/SKILL.md`)
5. Create symlinks in target tool directories
6. Derive managed vs discovered state from the current live install scan

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

Active development. Core install/list/remove/lock/doctor/prune flows are implemented and covered by tests.

## Contributing

Issues and PRs are welcome. If you plan a larger change, open an issue first to align on scope and behavior.

## License

This project is licensed under the MIT License. See `LICENSE` for details.
