# GitHub Repository Skills Browser Design

## Summary

Add a read-only GitHub repository skills browser that accepts a public GitHub repository URL and lists the skills found in that repository without cloning it locally. The browser reads the repository default branch, finds `SKILL.md` files via the GitHub API, extracts each skill's name, description, and repository path, and exposes the result through a reusable core API plus a CLI entry point.

## Goals

- Support browsing skills from a public GitHub repository without `git clone`
- Reuse the feature as core logic, with the CLI as the first consumer
- Display `skillName`, `description`, and repository-relative `path`
- Support quick local filtering on name, description, and path
- Keep output consistent with the existing plain-text CLI style

## Non-Goals

- Private repository support in v1
- GitHub Enterprise support
- Custom refs (`branch`, `tag`, `commit`) in v1
- Local persistent caching
- JSON output, pagination, or alternate sort modes

## User Experience

### Command

```bash
skill browse <github-repo-url> [--filter <text>]
```

### Input Rules

- Accept only public GitHub repository root URLs
- Read only the repository default branch
- Reject non-GitHub URLs and repository subpaths like `/tree/main`

### Output

The command prints:

1. Repository summary
2. Default branch
3. Total skill count after filtering
4. Per-skill blocks with name, description, and path

Example:

```text
Repository: obra/superpowers
Default branch: main
Skills: 2

  brainstorming
    description: Explore requirements before implementation.
    path: skills/brainstorming/SKILL.md

  writing-plans
    description: Turn a spec into an implementation plan.
    path: skills/writing-plans/SKILL.md
```

### Filtering

- `--filter` does a case-insensitive substring match
- The filter matches any of:
  - `skillName`
  - `description`
  - `path`

## Architecture

This feature adds a new remote browsing path in parallel with the existing install/discovery flow. The current local-source pipeline is intentionally left unchanged because it assumes filesystem access and cloned content.

### Modules

#### 1. GitHub Repository URL Parsing

Responsibility:

- Validate the input URL
- Normalize it into `owner`, `repo`, `displayName`, and canonical web URL

Constraints:

- Only `https://github.com/<owner>/<repo>` is accepted
- Root repository URLs only

#### 2. GitHub API Client

Responsibility:

- Read repository metadata to find the default branch
- Read the recursive tree for the default branch
- Read matching `SKILL.md` blobs

Notes:

- Use GitHub REST API
- Use Node's built-in `fetch`
- Map remote failures to stable `SourceError` messages

#### 3. Remote Skill Discovery

Responsibility:

- Filter the tree to blob entries ending in `/SKILL.md`
- Derive `skillName` from the parent directory name
- Preserve the repository-relative path

#### 4. Skill Markdown Parsing

Responsibility:

- Extract `description` from YAML frontmatter when present
- Fall back to the first body paragraph when frontmatter lacks `description`
- Return an empty string when neither source yields a description

#### 5. Browse Orchestrator

Responsibility:

- Combine repository parsing, remote reads, discovery, and markdown parsing
- Return a reusable typed result for future consumers

#### 6. CLI Command

Responsibility:

- Parse command arguments
- Apply local filtering
- Render the plain-text output

## Data Flow

1. User passes a GitHub repository URL to `skill browse`
2. URL parser normalizes it into `owner/repo`
3. GitHub client reads repository metadata and gets the default branch
4. GitHub client reads the recursive tree for that branch
5. Browser filters the tree to `SKILL.md` blobs
6. Browser fetches each blob body with small bounded concurrency
7. Markdown parser extracts descriptions
8. Browser returns normalized skill records to the CLI
9. CLI applies optional local filtering and prints the result

## Error Handling

### User Input Errors

- Invalid URL
- Non-GitHub URL
- GitHub URL not pointing to the repository root

These map to `SkillCliError` with `ExitCode.USER_INPUT`.

### Source Errors

- Repository missing or not publicly accessible
- GitHub API rate limit exceeded
- Repository metadata read failed
- Tree read failed
- Blob read or decode failed

These map to `SourceError` with clear user-facing messages.

### Description Parsing

- Missing frontmatter description is not fatal
- Missing first paragraph is not fatal
- A skill may have an empty description string in the final output

## Testing Strategy

### Unit Tests

- Repository URL parsing
- Markdown description extraction
- Filter matching
- Skill name derivation from path

### Core Integration Tests

- Successful browse flow via stubbed `fetch`
- Missing repository
- Rate limit mapping
- Empty skill set

### Command Tests

- Plain-text output rendering
- Filtering behavior
- Empty result messages

## Acceptance Criteria

- `skill browse <github-repo-url>` works for a public GitHub repository
- The implementation does not clone the repository locally
- The browser reads only the default branch
- Results include `skillName`, `description`, and `path`
- Description extraction prefers `frontmatter.description`, then first paragraph
- `--filter` performs case-insensitive matching on name, description, and path
- Errors are stable and understandable
- Automated tests cover the new core and command behavior
