# Unified Search Providers Design

## Summary

Upgrade `skill search` from a GitHub-root-URL-only browser into a repo-level remote search command backed by a unified source parser and pluggable discovery providers. The new command should accept GitHub shorthand, GitHub HTTPS URLs, GitHub SSH URLs, and generic git HTTPS/SSH URLs. It should prefer a lightweight GitHub API provider when the source can be resolved to a GitHub repository, and fall back to a clone-based provider when API search is unavailable or when the source is a non-GitHub git repository.

The goal is to preserve the current fast path for public GitHub repositories while making `search` useful for SSH sources, private GitHub repositories, and other git hosts. Search results should also become more install-oriented: instead of listing every path that looks like `SKILL.md`, the command should list only skills that pass explicit discovery and frontmatter validation rules.

## Goals

- Expand `skill search` input support to repo-level remote git sources, including GitHub shorthand and SSH URLs
- Keep a no-clone fast path for GitHub repositories when API discovery can answer the request
- Add a clone-based fallback path that works for SSH, private repositories, and non-GitHub git hosts
- Unify search results behind one typed result shape regardless of provider
- Make search discovery semantics closer to install semantics by requiring valid `SKILL.md` frontmatter
- Keep the current CLI output shape and `--filter` behavior as stable as possible
- Isolate source parsing, provider selection, discovery policy, and output rendering into separate modules

## Non-Goals

- No support in this iteration for `.../tree/...` repository subpaths
- No support in this iteration for `#ref`, `@skill`, or other install-only source syntax on `search`
- No support in this iteration for local paths, npm sources, or well-known HTTP skill indexes
- No GitHub Enterprise specific handling
- No persistent caching of search results
- No JSON output or alternate output modes
- No new install behavior changes as part of the search redesign

## User Experience

### Command

```bash
skill search <source> [--filter <text>]
```

### Supported Input Forms

The command should accept repo-level remote sources only:

- `https://github.com/owner/repo`
- `owner/repo`
- `git@github.com:owner/repo.git`
- `https://host/org/repo.git`
- `ssh://host/org/repo.git`
- other `git@host:path.git` forms that the clone provider can execute

### Unsupported Input Forms

These inputs should fail with a clear user-input error in this iteration:

- `https://github.com/owner/repo/tree/main/...`
- `source#ref`
- `source@skill`
- local filesystem paths
- npm package specs
- well-known URL sources

### Output

The command should continue to print:

1. Repository summary
2. Default branch when known
3. Total skill count after filtering
4. Per-skill blocks with name, description, and path

Example:

```text
Repository: vercel-labs/agent-skills
Default branch: main
Skills: 2

  frontend-design
    description: Design and ship high-quality frontend experiences.
    path: skills/frontend-design/SKILL.md

  writing-plans
    description: Turn an approved design into an implementation plan.
    path: skills/writing-plans/SKILL.md
```

When a GitHub API search cannot complete and the command falls back to cloning, the CLI may print one extra informational line before the result body, for example:

```text
GitHub API search unavailable, falling back to git clone
```

This fallback notice is the only intended output-shape change.

### Filtering

- `--filter` remains a case-insensitive substring match
- The filter matches any of:
  - `skillName`
  - `description`
  - `path`

## Architecture

The redesign should separate `search` into four concerns:

1. source parsing
2. provider selection
3. provider-specific discovery
4. shared result rendering

`runSearchCommand()` should stop depending directly on GitHub URL parsing and GitHub-only remote reads. Instead, it should orchestrate a parsed source, choose the appropriate provider path, apply local filtering, and print the final results.

### Modules

#### 1. Search Source Parser

Responsibility:

- Validate that the input is a supported repo-level remote search source
- Normalize supported forms into a search-specific source descriptor
- Preserve the original raw source text for clone fallback
- Extract GitHub repository identity when the source maps to `owner/repo`

Notes:

- This parser should be search-specific rather than reusing install parsing wholesale, because `search` intentionally supports a narrower syntax surface than `install`
- The parser should reject subpaths, refs, skill filters, and local paths early with `SkillCliError`

Suggested descriptor shape:

```ts
interface SearchSourceDescriptor {
  raw: string;
  kind: "github" | "git";
  cloneUrl: string;
  github?: {
    owner: string;
    repo: string;
    displayName: string;
    webUrl: string;
  };
}
```

#### 2. Search Provider Interface

Responsibility:

- Define a common interface that all search implementations satisfy
- Return one shared result structure to the CLI

Suggested interface:

```ts
interface SearchProviderResult {
  repository: {
    displayName: string;
    sourceLabel: string;
    webUrl?: string;
    resolvedBy: "github-api" | "git-clone";
    defaultBranch?: string;
  };
  skills: Array<{
    skillName: string;
    description: string;
    path: string;
  }>;
}

interface SearchProvider {
  search(source: SearchSourceDescriptor): Promise<SearchProviderResult>;
}
```

This contract keeps the CLI agnostic to whether the results came from GitHub API reads or a cloned repository.

#### 3. GitHub API Search Provider

Responsibility:

- Handle GitHub-resolvable sources without cloning when possible
- Read repository metadata and recursive tree from the GitHub API
- Read matching `SKILL.md` blobs
- Apply the shared search discovery policy to remote tree entries and markdown contents

Provider selection rule:

- If the parsed search source includes a GitHub `owner/repo`, the command should try this provider first
- This applies even when the original raw input was SSH, as long as GitHub identity can be extracted

The provider should return a typed fallback signal when it cannot complete for reasons where clone-based search is appropriate, including:

- repository not public through the unauthenticated API
- rate limit exceeded
- metadata, tree, or blob read failures
- any discovery-policy mismatch that makes API results incomplete relative to clone discovery

#### 4. Git Clone Search Provider

Responsibility:

- Clone the source to a temporary directory
- Run the local discovery engine against the cloned repository
- Return the same result structure as the API provider

Selection rule:

- This provider is used directly for non-GitHub sources
- This provider is also the fallback path for GitHub sources when API search cannot complete

Important constraint:

- Clone must use the original source semantics, not a lossy canonicalized GitHub HTTPS URL, so SSH and private repository access keep working

#### 5. Shared Search Discovery Policy

Responsibility:

- Define one source-independent rule for what counts as a searchable skill
- Be reused conceptually by both providers so API and clone results stay consistent

This logic may be implemented as shared helpers plus thin provider adapters, but the semantics must be identical across providers.

## Discovery Policy

Search results should stop being a loose `SKILL.md` browser and become a stricter repo-level skill discovery pipeline.

### Priority Search Roots

Both providers should apply the same priority roots before falling back to broader recursion:

- repository root
- `skills/`
- `.claude/skills/`
- `.codex/skills/`
- `.opencode/skills/`

The exact root list should be centralized in one module so the API provider and clone provider cannot drift. This iteration should not infer extra roots from user config; it should use one fixed built-in list.

### Search Order

1. Search priority roots first
2. If one or more skills are found in priority roots, use those results
3. If no skills are found in priority roots, fall back to recursive discovery with a bounded depth

This matches the approved design direction and avoids treating arbitrary deep `SKILL.md` files as first-class results when the repository already follows a conventional skills layout.

Within each priority root, providers should accept only:

- a `SKILL.md` directly at that root
- a direct child directory of that root containing `SKILL.md`

Examples that should count during the priority-root phase:

- `SKILL.md`
- `skills/frontend-design/SKILL.md`
- `.opencode/skills/reviewer/SKILL.md`

Examples that should not count during the priority-root phase and should instead rely on recursive fallback:

- `skills/team/frontend-design/SKILL.md`
- `.claude/skills/internal/reviewer/SKILL.md`

### Depth Rules

- The API path and the clone path must use the same effective recursive depth limit
- The implementation should not preserve the current asymmetry where remote GitHub search can see arbitrarily deep `SKILL.md` files while clone-style discovery is more constrained

The exact max depth should be explicit in code and tests. The important design requirement is equality between providers, not the specific numeric value.

### `SKILL.md` Validation

A file qualifies as a search result only if:

- it is named `SKILL.md`
- its frontmatter parses successfully
- `name` exists and is a string
- `description` exists and is a string

Results should use:

- `skillName = frontmatter.name`
- `description = frontmatter.description`
- `path = repository-relative path to SKILL.md`

Search should no longer derive `skillName` from a directory name, and should no longer fall back to the first body paragraph for description extraction.

### Internal Skills

- `metadata.internal: true` skills should be hidden by default
- This iteration does not add a `search` flag or environment variable to override that behavior

That keeps search output aligned with the default install/discovery semantics rather than exposing internal or work-in-progress skills by accident.

### Deduplication

- Results should be deduplicated by normalized `skillName`
- The first match in deterministic discovery order should win
- The selected result keeps its own repository-relative path for display

This makes duplicate `SKILL.md` definitions stable and testable.

## Data Flow

### GitHub Source Without Fallback

1. User passes a supported GitHub-identifiable source to `skill search`
2. Search source parser validates the input and extracts `owner/repo`
3. Provider selection chooses the GitHub API provider first
4. GitHub API provider reads repository metadata and recursive tree
5. Shared discovery policy selects candidate `SKILL.md` paths
6. Provider reads matching blobs and validates frontmatter
7. Provider returns normalized results
8. CLI applies optional local filtering and prints the output

### GitHub Source With Fallback

1. Steps 1-3 are the same
2. GitHub API provider detects a fallback-worthy failure
3. CLI or orchestration layer emits one fallback notice
4. Git clone provider clones using the raw source semantics
5. Clone provider runs local discovery with the shared discovery policy
6. Provider returns normalized results
7. CLI applies optional local filtering and prints the output

### Non-GitHub Git Source

1. User passes a supported non-GitHub git source
2. Search source parser validates the input as repo-level git
3. Provider selection chooses the clone provider directly
4. Clone provider clones the repository into a temporary directory
5. Local discovery applies the shared discovery policy
6. Provider returns normalized results to the CLI

## Error Handling

### User Input Errors

Reject with `SkillCliError` and `ExitCode.USER_INPUT` when:

- the source is empty
- the source is a local path
- the source includes unsupported repo subpaths
- the source includes unsupported ref or skill-filter syntax
- the source does not match any supported repo-level remote source format

Suggestions should name the accepted forms at a high level, for example GitHub shorthand, GitHub HTTPS, GitHub SSH, and generic git HTTPS/SSH URLs.

### Provider Fallback Errors

Fallback should happen when the GitHub API path is unavailable but clone-based search is still a valid next step. Examples:

- repository not public through GitHub API
- rate limit exceeded
- recursive tree read failed
- blob fetch failed
- remote discovery cannot guarantee parity with clone semantics

These conditions should not immediately fail the command when clone fallback is still possible.

### Final Source Errors

Fail with a clear source error when:

- clone fallback also fails
- the remote source is inaccessible with the provided raw URL semantics
- the repository contains no discoverable skills under the shared discovery policy

If API search fails and clone also fails, the final error should be the clone failure because that is the last executable strategy available to the user.

## CLI Rendering Rules

- Keep the current section order and line-oriented formatting
- Print `Default branch` only when the provider can state it truthfully
- Do not invent a branch name for clone-only non-GitHub sources
- Keep `--filter` behavior entirely local to the CLI layer
- Continue returning the filtered skills array from `runSearchCommand()` so tests and future callers see the same logical result as the user

## Testing Strategy

### Source Parser Tests

- GitHub shorthand parses successfully
- GitHub HTTPS URL parses successfully
- GitHub SSH URL parses successfully
- generic git HTTPS parses successfully
- generic git SSH parses successfully
- local path is rejected
- `tree` subpath is rejected
- `#ref` is rejected
- `@skill` is rejected
- malformed inputs fail with stable user-input errors

### Provider Selection Tests

- GitHub-identifiable sources try the API provider first
- GitHub SSH still resolves to the API-first path when `owner/repo` is extractable
- API fallback-worthy failures route to clone provider
- non-GitHub sources route directly to clone provider

### Discovery Consistency Tests

- API provider and clone provider return the same skill set for the same repository fixture
- priority-root hits suppress broader recursive fallback results
- recursive fallback works when priority roots are empty
- frontmatter validation rejects missing or non-string `name`
- frontmatter validation rejects missing or non-string `description`
- internal skills are hidden
- duplicate names are deduplicated deterministically

### Command Tests

- standard GitHub HTTPS search output still works
- shorthand search output works
- SSH GitHub search output works
- generic git search output works through the clone provider
- `--filter` still matches name, description, and path
- no-skill repositories print the correct empty-state message
- fallback notice appears exactly when API search falls back to clone

### Regression Tests

- current public GitHub search success path does not regress in output format
- current filter behavior does not regress
- current GitHub API error mapping remains understandable where it still applies

## Acceptance Criteria

- `skill search` accepts GitHub shorthand, GitHub HTTPS URLs, GitHub SSH URLs, and generic git HTTPS/SSH repo sources
- GitHub-identifiable sources prefer an API search path before cloning
- GitHub API failures that are suitable for fallback automatically fall back to clone-based search
- Non-GitHub git sources use clone-based search directly
- Both providers return the same result shape and apply the same discovery policy
- Search results require valid frontmatter `name` and `description`
- Internal skills are hidden by default
- CLI output stays stable apart from an optional one-line fallback notice
- `--filter` remains a local case-insensitive substring match over name, description, and path
- Tests cover parser behavior, provider selection, discovery consistency, CLI output, and regression of the current GitHub path
