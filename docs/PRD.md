# Skill CLI Product Requirements Document (PRD)

## 1. Document Info

- Product: skill-cli
- Version: v1.0
- Date: 2026-04-08
- Status: Approved for implementation

## 2. Background

Developers use multiple coding agents and CLIs, each with its own skill directory conventions.
Installing and maintaining reusable skills across tools is repetitive and error-prone.

The product goal is to provide one local CLI that can install and manage skills from common sources,
while exposing them to target tools via symlinks only.

## 3. Goals

1. Provide a single install and management workflow for skills.
2. Support three built-in tools in v1:
   - claude-code
   - codex
   - opencode
3. Allow tool definitions to be extended via configuration.
4. Support install targets:
   - global
   - project
   - custom directory
5. Keep one canonical local store (default: `~/.skills`).
6. Ensure target directories only contain symlinks, not copied skill content.
7. Support private and public sources through existing user credentials.

## 4. Non-Goals (v1)

1. No cloud-hosted registry service.
2. No skill package standard enforcement (no required `skill.json`).
3. No Windows-specific symlink compatibility guarantees in v1.
4. No UI/TUI workflow; CLI only.

## 5. Target Users

1. Individual developers using one or more coding CLIs.
2. Teams wanting repeatable local skill installation behavior.
3. Maintainers who need tool-specific directory mapping from one source.

## 6. Product Scope

### 6.1 Source Input

Users provide one `source` argument. The CLI auto-detects and resolves source type.

Supported source categories in v1:

1. Git-based sources (including GitHub URLs/shorthand and private repos)
2. npm package sources (including private registries)
3. local path sources

User experience requirement:

- Users do not need to explicitly specify `npm` vs `github` in normal usage.

### 6.2 Tool Support

Built-in tool ids:

1. `claude-code`
2. `codex`
3. `opencode`

Tool behavior is config-driven and extensible.

### 6.3 Install Targets

Mutually exclusive install target flags:

1. `--global`
2. `--project`
3. `--dir <path>`

Project root rule for `--project`:

- nearest git root from current working directory
- fallback to current working directory if no git root exists

### 6.4 Multi-Tool Install

`--tool` accepts:

1. a single tool id
2. `all` to install into all configured tools

`--tool all` behavior:

- execute per tool
- continue on per-tool failure
- print final aggregated result summary

### 6.5 Storage and Linking Model

1. Canonical store directory default: `~/.skills`
2. Store override via configuration
3. Installation to tool directories must always be symlink-based
4. No direct copy into target tool skill directories

Conflict policy:

- if target name exists, fail by default
- `--force` allows replacing existing symlink/entry

## 7. Functional Requirements

### FR-1 Install

The CLI must install skills from a source to one or multiple tools.

Command:

`skill install <source> [--tool <tool|all>] [--global|--project|--dir <path>] [--force]`

Expected behavior:

1. resolve and fetch source
2. store content in canonical store
3. discover skill entries using tool-specific discovery rules
4. create symlinks in target directories
5. record installation state in local registry
6. in interactive terminals, prompt for missing inputs in this order: install scope, custom directory path when scope is `dir`, then tool selection
7. tool selection must support a single configured tool id or `all`
8. in non-interactive environments, missing required install inputs must return a user-input error instead of prompting

### FR-2 Remove

Command:

`skill remove <skill-name> --tool <tool|all> [--global|--project|--dir <path>]`

Expected behavior:

1. remove target symlink(s)
2. preserve store content by default
3. update local registry

### FR-3 List

Command:

`skill list [--tool <tool|all>]`

Expected behavior:

1. show installed skills
2. show per-tool install locations
3. show source and store references where available

### FR-4 Doctor

Command:

`skill doctor`

Expected behavior:

1. validate configuration
2. validate directory permissions
3. detect broken symlinks
4. detect registry mismatch
5. provide actionable fixes

### FR-5 Relink

Command:

`skill relink [--tool <tool|all>]`

Expected behavior:

1. rebuild missing/broken symlinks from registry + store metadata
2. skip healthy links unless forced by options

### FR-6 Prune

Command:

`skill prune`

Expected behavior:

1. remove unreferenced store artifacts
2. keep referenced artifacts intact
3. print reclaimed size summary

## 8. Configuration Requirements

### 8.1 Config Locations

1. Global config: `~/.config/skill-cli/config.json`
2. Project config: `./skill-cli.config.json`

Priority order:

1. CLI flags
2. environment variables
3. project config
4. global config
5. built-in defaults

### 8.2 Config Shape

```json
{
  "storeDir": "~/.skills",
  "tools": {
    "claude-code": {
      "globalDir": "~/.claude/skills",
      "projectDir": ".claude/skills",
      "entryPattern": "**/SKILL.md",
      "nameStrategy": "parentDir"
    },
    "codex": {
      "globalDir": "~/.codex/skills",
      "projectDir": ".codex/skills",
      "entryPattern": "**/SKILL.md",
      "nameStrategy": "parentDir"
    },
    "opencode": {
      "globalDir": "~/.config/opencode/skills",
      "projectDir": ".opencode/skills",
      "entryPattern": "**/SKILL.md",
      "nameStrategy": "parentDir"
    }
  }
}
```

Config extensibility requirement:

- New tools can be added by config only (no core code edits expected for common cases).

## 9. Registry and Metadata

The CLI must maintain local metadata for install management.

Suggested registry location:

- `~/.skills/registry.json`

Registry minimum fields:

1. skill name
2. tool id
3. install target path
4. symlink path
5. source descriptor
6. store path
7. install/update timestamps

## 10. Authentication and Private Sources

v1 authentication model:

1. Reuse existing user credentials for git/github access
2. Reuse existing npm auth (`.npmrc`, token, registry config)
3. No custom token vault in skill-cli v1

Security requirements:

1. Never print secrets in logs
2. Do not persist raw secrets in registry/config
3. Keep command output safe for shared terminal logs

## 11. Architecture Requirements

Recommended module boundaries:

1. `config` (load, merge, validate)
2. `source` (detect, fetch, unpack)
3. `discovery` (find skill entries)
4. `store` (cache/content store)
5. `linker` (symlink lifecycle)
6. `registry` (state tracking)
7. `commands` (CLI entrypoints)

Design quality requirement:

- high cohesion, low coupling across modules

## 12. Error Handling and UX Requirements

1. Errors must include reason and concrete fix suggestion.
2. Batch operations (`--tool all`) must produce a per-tool status summary.
3. Exit codes should distinguish user error, source/auth error, and filesystem error.

## 13. Testing Requirements

v1 minimum test layers:

1. unit tests for config/source/discovery/linker/registry
2. integration tests for command flows
3. symlink conflict and recovery tests
4. private source auth pass-through tests (mocked where needed)

## 14. Acceptance Criteria

1. `install --tool all` installs into all configured tools via symlink only.
2. global/project/custom target installs all work with expected path resolution.
3. broken link scenarios are detectable by `doctor` and recoverable by `relink`.
4. unsupported source or auth failure produces clear diagnostics.
5. a new tool can be added by config and used by `install/list/remove`.

## 15. Milestones

1. M1: CLI skeleton + config system + built-in tool defaults
2. M2: source detection/fetch/unpack (local/git/npm)
3. M3: discovery + install/link + registry write
4. M4: remove/list/doctor/relink/prune
5. M5: tests, docs, release-ready polish
