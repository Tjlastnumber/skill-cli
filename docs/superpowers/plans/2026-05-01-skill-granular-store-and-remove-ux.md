# Skill-Granular Store And Remove UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor skill installation so `--skill` installs persist and manage each selected skill as an independent store entry, and redesign `remove` into a project-first, skill-aware workflow with automatic tool inference and interactive ambiguity resolution.

**Architecture:** Replace the current source-level persistent store model with a skill-level managed store entry model plus a lightweight source manifest for provenance and full-source skill enumeration. Keep live symlink scans as the source of truth, but refactor live grouping so physical skill entries aggregate back into logical source groups for list, lock, doctor, and whole-source removal; add a remove input resolver that defaults to `project`, infers tool from current installs, and uses interactive selection when multiple tools or duplicate skill names match.

**Tech Stack:** TypeScript, Commander, `@clack/prompts`, Vitest, existing live-scan/store/lockfile modules

---

## File Structure

- Create: `src/core/skill-description.ts`
- Create: `src/core/store/source-manifest.ts`
- Create: `src/core/store/persist-skill.ts`
- Create: `src/commands/remove-inputs.ts`
- Create: `test/source-manifest.test.ts`
- Create: `test/remove-inputs.test.ts`
- Create: `test/skill-store-grouping.test.ts`
- Modify: `src/cli.ts`
- Modify: `src/commands/install.ts`
- Modify: `src/commands/remove.ts`
- Modify: `src/commands/list.ts`
- Modify: `src/commands/prune.ts`
- Modify: `src/commands/doctor.ts`
- Modify: `src/core/store/source-metadata.ts`
- Modify: `src/core/store/store-path.ts`
- Modify: `src/core/bundle/identity.ts`
- Modify: `src/core/discovery/group-scanned-bundles.ts`
- Modify: `src/core/discovery/scan-live-bundles.ts`
- Modify: `src/core/lockfile/build-project-lockfile.ts`
- Modify: `src/core/lockfile/resolve-locked-source.ts`
- Modify: `test/install-command.test.ts`
- Modify: `test/remove-command.test.ts`
- Modify: `test/remove-cli.test.ts`
- Modify: `test/list-command.test.ts`
- Modify: `test/lock-command.test.ts`
- Modify: `test/project-lockfile-sync.test.ts`
- Modify: `test/doctor-command.test.ts`
- Modify: `test/prune-command.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/PRD.md`
- Modify: `docs/TODO.md`

## Constraints

- Do not change `fetchSource()` into a partial-fetch implementation in this refactor; temporary full fetch is acceptable, persistent full-source store is not.
- Keep live symlink scans as the source of truth; do not reintroduce registry-backed install state.
- Preserve current repeated `skill install <source> --skill <name>` accumulation semantics for the same tool + target.
- Keep source-group removal via `skill remove <bundle-name>` available.
- Make `skill remove` default to `project` target when no explicit target flag is passed.
- Make `--tool` optional for `remove`; infer from live installs in the resolved target scope.
- When multiple tools match and `--tool` is omitted, prompt to choose the tool in interactive terminals and error in non-interactive terminals.
- When duplicate installed skill names match `remove --skill <name>`, print search-style candidate details with descriptions and prompt to choose one in interactive terminals; error in non-interactive terminals.
- Preserve project remove auto-sync of `skills-lock.yaml`.

### Task 1: Add Shared Skill Description And Source Manifest Models

**Files:**
- Create: `src/core/skill-description.ts`
- Create: `src/core/store/source-manifest.ts`
- Modify: `src/core/store/source-metadata.ts`
- Test: `test/source-manifest.test.ts`

- [ ] **Step 1: Write the failing tests for source manifests and description extraction contracts**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractLocalSkillDescription } from "../src/core/skill-description.js";
import {
  readSourceManifest,
  writeSourceManifest,
  type SourceManifest,
} from "../src/core/store/source-manifest.js";
import { readSourceMetadata, writeSourceMetadata } from "../src/core/store/source-metadata.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("skill description", () => {
  it("extracts description from frontmatter or first paragraph", async () => {
    expect(
      extractLocalSkillDescription(`---
description: Browser automation helper
---
# browser
`),
    ).toBe("Browser automation helper");

    expect(
      extractLocalSkillDescription(`# debugger

Inspect local runtime state safely.
`),
    ).toBe("Inspect local runtime state safely.");
  });
});

describe("source manifest", () => {
  it("writes and reads a manifest with skill entries and descriptions", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-manifest-"));
    cleanupDirs.push(base);

    const manifest: SourceManifest = {
      version: 1,
      sourceKind: "git",
      sourceRaw: "git@github.com:obra/superpowers.git",
      sourceCanonical: "github.com/obra/superpowers",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      sourceDisplayName: "superpowers",
      sourceCacheKey: "cache-key-1",
      skills: [
        {
          skillName: "using-superpowers",
          description: "Bootstrap OpenCode superpowers.",
          relativeSkillDir: "using-superpowers",
        },
      ],
    };

    await writeSourceManifest(join(base, "manifest.json"), manifest);
    await expect(readSourceManifest(join(base, "manifest.json"))).resolves.toEqual(manifest);
  });

  it("stores skill-level metadata with description and manifest linkage", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-metadata-"));
    cleanupDirs.push(base);

    await writeSourceMetadata(base, {
      version: 2,
      storeEntryKind: "skill",
      skillName: "using-superpowers",
      description: "Bootstrap OpenCode superpowers.",
      relativeSkillDir: "using-superpowers",
      sourceKind: "git",
      sourceRaw: "git@github.com:obra/superpowers.git",
      sourceCanonical: "github.com/obra/superpowers",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      sourceDisplayName: "superpowers",
      sourceManifestPath: "/tmp/manifest.json",
      sourceCacheKey: "cache-key-1",
    });

    await expect(readSourceMetadata(base)).resolves.toMatchObject({
      version: 2,
      storeEntryKind: "skill",
      skillName: "using-superpowers",
      description: "Bootstrap OpenCode superpowers.",
      sourceManifestPath: "/tmp/manifest.json",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/source-manifest.test.ts`
Expected: FAIL because `src/core/skill-description.ts` and `src/core/store/source-manifest.ts` do not exist and `source-metadata.ts` only supports v1 source-level metadata.

- [ ] **Step 3: Implement the shared description helper and manifest IO**

```ts
// src/core/skill-description.ts
import { extractSkillDescription } from "./github/skill-markdown.js";

export function extractLocalSkillDescription(markdown: string): string {
  return extractSkillDescription(markdown).trim();
}
```

```ts
// src/core/store/source-manifest.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { FilesystemError } from "../errors.js";

export interface SourceManifestSkill {
  skillName: string;
  description: string;
  relativeSkillDir: string;
}

export interface SourceManifest {
  version: 1;
  sourceKind: "local" | "git" | "npm";
  sourceRaw: string;
  sourceCanonical: string;
  sourceRevision: string;
  sourceDisplayName: string;
  sourceCacheKey: string;
  skills: SourceManifestSkill[];
}

export async function writeSourceManifest(path: string, manifest: SourceManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8").catch((error) => {
    throw new FilesystemError(`Failed to write source manifest: ${path}`, "Check filesystem permissions and retry", error);
  });
}

export async function readSourceManifest(path: string): Promise<SourceManifest | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SourceManifest>;
    if (
      parsed.version !== 1 ||
      typeof parsed.sourceKind !== "string" ||
      typeof parsed.sourceRaw !== "string" ||
      typeof parsed.sourceCanonical !== "string" ||
      typeof parsed.sourceRevision !== "string" ||
      typeof parsed.sourceDisplayName !== "string" ||
      typeof parsed.sourceCacheKey !== "string" ||
      !Array.isArray(parsed.skills)
    ) {
      return undefined;
    }

    return {
      version: 1,
      sourceKind: parsed.sourceKind as "local" | "git" | "npm",
      sourceRaw: parsed.sourceRaw,
      sourceCanonical: parsed.sourceCanonical,
      sourceRevision: parsed.sourceRevision,
      sourceDisplayName: parsed.sourceDisplayName,
      sourceCacheKey: parsed.sourceCacheKey,
      skills: parsed.skills.map((skill) => ({
        skillName: String((skill as { skillName?: unknown }).skillName ?? ""),
        description: String((skill as { description?: unknown }).description ?? ""),
        relativeSkillDir: String((skill as { relativeSkillDir?: unknown }).relativeSkillDir ?? ""),
      })),
    };
  } catch {
    return undefined;
  }
}
```

```ts
// src/core/store/source-metadata.ts
export interface SourceMetadataV2 {
  version: 2;
  storeEntryKind: "skill";
  skillName: string;
  description: string;
  relativeSkillDir: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceRaw: string;
  sourceCanonical: string;
  sourceRevision: string;
  sourceDisplayName: string;
  sourceManifestPath: string;
  sourceCacheKey: string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/source-manifest.test.ts`
Expected: PASS with manifest round-trip and metadata v2 coverage green.

- [ ] **Step 5: Commit**

```bash
git add src/core/skill-description.ts src/core/store/source-manifest.ts src/core/store/source-metadata.ts test/source-manifest.test.ts
git commit -m "feat: add skill-level source metadata"
```

### Task 2: Persist Selected Skills As Independent Store Entries

**Files:**
- Create: `src/core/store/persist-skill.ts`
- Modify: `src/commands/install.ts`
- Modify: `src/core/store/store-path.ts`
- Test: `test/install-command.test.ts`

- [ ] **Step 1: Write failing install tests for skill-level persistence**

```ts
it("persists only the selected skill as a managed store entry", async () => {
  const base = await mkdtemp(join(tmpdir(), "skill-cli-install-single-skill-store-"));
  cleanupDirs.push(base);

  const homeDir = join(base, "home");
  const cwd = join(base, "workspace");
  const sourceRoot = join(cwd, "skills-source");
  const targetDir = join(base, "target", "opencode-project");
  const storeDir = join(base, "store");

  await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
  await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
  await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
  await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n\nAlpha description.\n");
  await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta\n\nBeta description.\n");
  await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({
    storeDir,
    tools: {
      opencode: {
        projectDir: targetDir,
      },
    },
  }, null, 2));

  await runInstallCommand(
    {
      source: "skills-source",
      tool: "opencode",
      target: { type: "dir", dir: targetDir },
      force: false,
      skills: ["alpha-skill"],
    },
    { cwd, homeDir, output: quietOutput() },
  );

  const storeEntries = await readdir(join(storeDir, "store"));
  expect(storeEntries).toHaveLength(1);
  await expect(lstat(join(storeDir, "store", storeEntries[0]!, "SKILL.md"))).resolves.toBeTruthy();
  await expect(lstat(join(storeDir, "store", storeEntries[0]!, "..", "beta-skill"))).rejects.toThrow();
});
```

- [ ] **Step 2: Run install tests to verify they fail**

Run: `pnpm test -- test/install-command.test.ts`
Expected: FAIL because install currently copies the entire fetched source into one store directory and links selected members from that shared root.

- [ ] **Step 3: Implement per-skill persistence in install flow**

```ts
// src/core/store/persist-skill.ts
import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { FilesystemError, SourceError } from "../errors.js";

export async function persistSkillInStore(options: {
  sourceSkillDir: string;
  storeRootDir: string;
  storeEntryKey: string;
}): Promise<{ storedSkillDir: string }> {
  const sourceStats = await stat(options.sourceSkillDir).catch(() => {
    throw new SourceError(`Fetched skill directory does not exist: ${options.sourceSkillDir}`);
  });

  if (!sourceStats.isDirectory()) {
    throw new SourceError(`Fetched skill path is not a directory: ${options.sourceSkillDir}`);
  }

  const storeDir = join(options.storeRootDir, "store");
  const storedSkillDir = join(storeDir, options.storeEntryKey);
  await mkdir(storeDir, { recursive: true });

  await cp(options.sourceSkillDir, storedSkillDir, {
    recursive: true,
    errorOnExist: false,
    force: false,
  }).catch((error) => {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
      throw new FilesystemError(`Failed to persist skill in store: ${storedSkillDir}`, "Check directory permissions and free disk space", error);
    }
  });

  return { storedSkillDir };
}
```

In `src/commands/install.ts`:
- discover skills from `fetched.sourceDir`, not persisted source root
- build source manifest once per install request
- for each desired skill:
  - compute a stable `storeEntryKey` from source identity + revision + relative skill dir + skill name
  - persist only that `skill.skillDir`
  - write metadata v2 on that stored skill dir
  - link from that stored skill dir

- [ ] **Step 4: Run install tests to verify they pass**

Run: `pnpm test -- test/install-command.test.ts`
Expected: PASS with selected-skill-only persistence and existing repeated-install behavior preserved.

- [ ] **Step 5: Commit**

```bash
git add src/core/store/persist-skill.ts src/commands/install.ts src/core/store/store-path.ts test/install-command.test.ts
git commit -m "feat: persist managed skills individually"
```

### Task 3: Refactor Managed Live Grouping From Store Entry To Logical Source Group

**Files:**
- Modify: `src/core/bundle/identity.ts`
- Modify: `src/core/discovery/group-scanned-bundles.ts`
- Modify: `src/core/discovery/scan-live-bundles.ts`
- Create: `test/skill-store-grouping.test.ts`

- [ ] **Step 1: Write failing grouping tests for per-skill store entries**

```ts
import { describe, expect, it } from "vitest";

import { groupScannedSkillsIntoBundles } from "../src/core/discovery/group-scanned-bundles.js";

describe("skill store grouping", () => {
  it("groups multiple managed skill entries from one source into one logical source group", async () => {
    const grouped = await groupScannedSkillsIntoBundles([
      {
        tool: "opencode",
        skillName: "alpha-skill",
        targetType: "project",
        targetRoot: "/repo/.opencode/skills",
        linkPath: "/repo/.opencode/skills/alpha-skill",
        isSymlink: true,
        isBrokenSymlink: false,
        sourceSkillDir: "/home/.skills/store/key-alpha",
      },
      {
        tool: "opencode",
        skillName: "beta-skill",
        targetType: "project",
        targetRoot: "/repo/.opencode/skills",
        linkPath: "/repo/.opencode/skills/beta-skill",
        isSymlink: true,
        isBrokenSymlink: false,
        sourceSkillDir: "/home/.skills/store/key-beta",
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      bundleName: "superpowers",
      members: [
        expect.objectContaining({ skillName: "alpha-skill" }),
        expect.objectContaining({ skillName: "beta-skill" }),
      ],
    });
  });
});
```

- [ ] **Step 2: Run grouping tests to verify they fail**

Run: `pnpm test -- test/skill-store-grouping.test.ts test/list-command.test.ts`
Expected: FAIL because grouping currently assumes one store root corresponds to one bundle.

- [ ] **Step 3: Implement logical source grouping from metadata**

In `src/core/discovery/group-scanned-bundles.ts`:
- read metadata from each managed skill entry
- build:
  - physical store entry identity from store path
  - logical source group identity from `sourceKind + sourceCanonical + sourceRevision + tool + target`
- aggregate members by logical source group identity
- carry descriptions and manifest paths on members or group metadata as needed for remove/list/doctor

In `src/core/bundle/identity.ts`:
- infer bundle/source group identity from metadata v2 rather than relying on stored root shape

- [ ] **Step 4: Run grouping and list tests to verify they pass**

Run: `pnpm test -- test/skill-store-grouping.test.ts test/list-command.test.ts`
Expected: PASS with logical source groups preserved in list output.

- [ ] **Step 5: Commit**

```bash
git add src/core/bundle/identity.ts src/core/discovery/group-scanned-bundles.ts src/core/discovery/scan-live-bundles.ts test/skill-store-grouping.test.ts test/list-command.test.ts
git commit -m "refactor: group managed skills by logical source"
```

### Task 4: Update Lockfile And Doctor To Use Source Manifests

**Files:**
- Modify: `src/core/lockfile/build-project-lockfile.ts`
- Modify: `src/core/lockfile/resolve-locked-source.ts`
- Modify: `src/commands/doctor.ts`
- Test: `test/lock-command.test.ts`
- Test: `test/project-lockfile-sync.test.ts`
- Test: `test/doctor-command.test.ts`

- [ ] **Step 1: Write failing tests for `name: "*"` reconstruction from manifests**

```ts
it("emits name '*' when every skill from a source manifest is installed via individual store entries", async () => {
  await expect(runLockCommand({ tool: "all", force: true }, { cwd, homeDir, output: captureOutput().output })).resolves.toMatchObject({
    bundleCount: 1,
  });

  await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
    version: 2,
    skills: [{ source: "./skills-source", name: "*" }],
  });
});
```

- [ ] **Step 2: Run lock and doctor tests to verify they fail**

Run: `pnpm test -- test/lock-command.test.ts test/project-lockfile-sync.test.ts test/doctor-command.test.ts`
Expected: FAIL because current lock and doctor read full-source skill universes from `bundle.storedSourceDir`, which will now be a single skill entry.

- [ ] **Step 3: Implement manifest-backed source enumeration**

In `src/core/lockfile/build-project-lockfile.ts`:
- read source manifest for each logical source group
- compare installed selected members to manifest `skills[]`
- emit `name: "*"` only when selected set equals manifest skill set

In `src/commands/doctor.ts`:
- derive installed source state from logical source groups plus manifest skill list
- treat missing manifest or invalid provenance as unresolvable bundle/source problems

In `src/core/lockfile/resolve-locked-source.ts`:
- resolve exact locked source from metadata/manifest instead of expecting a full repo/package root under the stored skill directory

- [ ] **Step 4: Run lock, sync, and doctor tests to verify they pass**

Run: `pnpm test -- test/lock-command.test.ts test/project-lockfile-sync.test.ts test/doctor-command.test.ts`
Expected: PASS with manifest-backed lockfile and drift behavior green.

- [ ] **Step 5: Commit**

```bash
git add src/core/lockfile/build-project-lockfile.ts src/core/lockfile/resolve-locked-source.ts src/commands/doctor.ts test/lock-command.test.ts test/project-lockfile-sync.test.ts test/doctor-command.test.ts
git commit -m "feat: rebuild project lockfiles from skill manifests"
```

### Task 5: Add Project-First Remove Input Resolution

**Files:**
- Create: `src/commands/remove-inputs.ts`
- Modify: `src/cli.ts`
- Create: `test/remove-inputs.test.ts`
- Modify: `test/remove-cli.test.ts`

- [ ] **Step 1: Write failing tests for remove defaults and tool inference**

```ts
import { describe, expect, it, vi } from "vitest";

import { resolveRemoveInputs } from "../src/commands/remove-inputs.js";

describe("resolveRemoveInputs", () => {
  it("defaults remove target to project", async () => {
    const resolved = await resolveRemoveInputs({
      bundleName: undefined,
      skillName: "browser",
      tool: undefined,
      target: undefined,
      configuredTools: ["opencode"],
      stdinIsTTY: false,
      stdoutIsTTY: false,
      findMatchingTools: async () => ["opencode"],
    });

    expect(resolved.target).toEqual({ type: "project" });
    expect(resolved.tool).toBe("opencode");
  });

  it("prompts for tool when multiple matching tools are found", async () => {
    const prompt = {
      select: vi.fn().mockResolvedValue("opencode"),
      cancel: vi.fn(),
      isCancel: vi.fn().mockReturnValue(false),
    };

    const resolved = await resolveRemoveInputs({
      bundleName: undefined,
      skillName: "browser",
      tool: undefined,
      target: undefined,
      configuredTools: ["opencode", "codex"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
      findMatchingTools: async () => ["codex", "opencode"],
    });

    expect(prompt.select).toHaveBeenCalledTimes(1);
    expect(resolved.tool).toBe("opencode");
  });
});
```

- [ ] **Step 2: Run remove input tests to verify they fail**

Run: `pnpm test -- test/remove-inputs.test.ts test/remove-cli.test.ts`
Expected: FAIL because remove currently requires explicit `--tool` and explicit target flags.

- [ ] **Step 3: Implement remove input resolver and wire CLI**

In `src/commands/remove-inputs.ts`:
- parse explicit target flags if present
- default target to `{ type: "project" }`
- require exactly one of `bundleName` or `skillName`
- if tool is explicit, validate it
- if tool is missing:
  - scan matching live managed installs within resolved target
  - `0` matches => user-input error
  - `1` match => auto-select
  - multiple matches => prompt for tool if interactive, else error

In `src/cli.ts`:
- make `remove` accept optional `[bundle-name]`
- add `--skill <name>` for skill removal
- stop requiring `--tool`
- use `resolveRemoveInputs()` before `runRemoveCommand()`
- preserve project auto-sync when resolved target is project

- [ ] **Step 4: Run remove CLI tests to verify they pass**

Run: `pnpm test -- test/remove-inputs.test.ts test/remove-cli.test.ts`
Expected: PASS with project-default remove behavior and tool inference covered.

- [ ] **Step 5: Commit**

```bash
git add src/commands/remove-inputs.ts src/cli.ts test/remove-inputs.test.ts test/remove-cli.test.ts
git commit -m "feat: make remove default to project installs"
```

### Task 6: Implement Skill-Level Remove And Duplicate-Skill Interactive Selection

**Files:**
- Modify: `src/commands/remove.ts`
- Modify: `src/commands/remove-inputs.ts`
- Test: `test/remove-command.test.ts`
- Test: `test/remove-cli.test.ts`

- [ ] **Step 1: Write failing tests for `remove --skill` and duplicate selection**

```ts
it("removes a single managed skill by name without removing sibling skills from the same source", async () => {
  await runRemoveCommand(
    {
      mode: "skill",
      skillName: "alpha-skill",
      tool: "opencode",
      target: { type: "project" },
    },
    { cwd, homeDir, output: quietOutput() },
  );

  await expect(lstat(join(projectSkillsDir, "alpha-skill"))).rejects.toThrow();
  expect((await lstat(join(projectSkillsDir, "beta-skill"))).isSymbolicLink()).toBe(true);
});

it("prints duplicate-skill candidates and requires interactive selection in TTY mode", async () => {
  const prompt = {
    select: vi.fn().mockResolvedValue("candidate-2"),
    cancel: vi.fn(),
    isCancel: vi.fn().mockReturnValue(false),
  };

  const output = captureOutput().output;

  const resolved = await resolveRemoveInputs({
    skillName: "browser",
    bundleName: undefined,
    tool: "opencode",
    target: { type: "project" },
    configuredTools: ["opencode"],
    stdinIsTTY: true,
    stdoutIsTTY: true,
    prompt,
    findMatchingTools: async () => ["opencode"],
    findMatchingSkills: async () => [
      {
        selectionValue: "candidate-1",
        skillName: "browser",
        description: "Browser automation for docs.",
        source: "./docs-skills",
        tool: "opencode",
        targetLabel: "project",
      },
      {
        selectionValue: "candidate-2",
        skillName: "browser",
        description: "Browser automation for QA.",
        source: "./qa-skills",
        tool: "opencode",
        targetLabel: "project",
      },
    ],
    output,
  });

  expect(prompt.select).toHaveBeenCalledTimes(1);
  expect(resolved.selectedSkillCandidate?.selectionValue).toBe("candidate-2");
});
```

- [ ] **Step 2: Run remove command tests to verify they fail**

Run: `pnpm test -- test/remove-command.test.ts test/remove-cli.test.ts`
Expected: FAIL because remove currently only supports whole-bundle deletion and has no duplicate-skill selection flow.

- [ ] **Step 3: Implement skill-level remove and duplicate-candidate selection**

In `src/commands/remove.ts`:
- support two modes:
  - `bundle`
  - `skill`
- skill mode removes exactly one chosen managed skill candidate
- bundle mode removes all members of a logical source group
- return counts for removed skills and removed source groups

In `src/commands/remove-inputs.ts`:
- after tool resolution, if mode is `skill`, enumerate matching managed skill candidates
- if `0` => error
- if `1` => auto-select
- if `>1`:
  - print search-style details through `output.info()`
  - if interactive, prompt to choose candidate
  - otherwise throw user-input ambiguity error

- [ ] **Step 4: Run remove tests to verify they pass**

Run: `pnpm test -- test/remove-command.test.ts test/remove-cli.test.ts`
Expected: PASS with partial skill removal, duplicate-name selection, and non-interactive ambiguity handling green.

- [ ] **Step 5: Commit**

```bash
git add src/commands/remove.ts src/commands/remove-inputs.ts test/remove-command.test.ts test/remove-cli.test.ts
git commit -m "feat: add skill-first remove workflow"
```

### Task 7: Adapt Prune To Skill Entries And Source Manifests

**Files:**
- Modify: `src/commands/prune.ts`
- Test: `test/prune-command.test.ts`

- [ ] **Step 1: Write failing prune tests for orphan skill entries and manifest cleanup**

```ts
it("keeps live managed skill store entries and removes orphan ones", async () => {
  const result = await runPruneCommand({ dirs: [] }, { cwd, homeDir, output: captureOutput().output });

  expect(result.keptStoreEntries).toBe(1);
  expect(result.removedStoreEntries).toBe(1);
});

it("removes orphan source manifests once no live skill entries reference them", async () => {
  const result = await runPruneCommand({ dirs: [] }, { cwd, homeDir, output: captureOutput().output });

  expect(result.removedStoreEntries).toBeGreaterThan(0);
  await expect(lstat(orphanManifestPath)).rejects.toThrow();
});
```

- [ ] **Step 2: Run prune tests to verify they fail**

Run: `pnpm test -- test/prune-command.test.ts`
Expected: FAIL because prune currently only tracks live cache-key directories and knows nothing about manifest references.

- [ ] **Step 3: Implement skill-entry and manifest-aware prune**

In `src/commands/prune.ts`:
- gather live managed skill store entry roots from live scan results
- gather manifest paths referenced by live managed skill metadata
- remove orphan store entries
- remove orphan manifests under the manifest directory
- preserve output summary shape

- [ ] **Step 4: Run prune tests to verify they pass**

Run: `pnpm test -- test/prune-command.test.ts`
Expected: PASS with orphan skill-entry and manifest cleanup behavior covered.

- [ ] **Step 5: Commit**

```bash
git add src/commands/prune.ts test/prune-command.test.ts
git commit -m "feat: prune orphan skill entries"
```

### Task 8: Update Docs And Command Help For Skill-Level Store And Project-First Remove

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/PRD.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Write the documentation changes**

Update `README.md` and `README.zh-CN.md` so they explicitly describe:
- `skill install --skill <name>` stores only the selected skill(s), not the whole source in the managed store
- `skill remove --skill <name>` is the preferred skill-level removal flow
- `skill remove` defaults to current-project installs
- `--tool` on remove is optional and inferred from current project installs
- if multiple tools match, remove prompts for tool selection
- if duplicate installed skill names match, remove shows search-style descriptions and prompts the user to choose one
- source-group removal remains available via `skill remove <bundle-name>`
- project remove still auto-syncs `skills-lock.yaml`

Update `docs/PRD.md` sections:
- FR-1 Install: replace “store fetched content” with “persist selected skills as independent managed store entries”
- FR-2 Remove: add `--skill`, default project target, optional tool inference, duplicate-name interaction
- FR-6 Prune: include orphan source manifest cleanup
- FR-7 Lockfile: clarify source manifests are used to reconstruct full-source versus partial-source lock entries

Update `docs/TODO.md` to reflect:
- skill-level managed store
- project-first remove
- duplicate-name interactive resolution

- [ ] **Step 2: Verify docs references are internally consistent**

Run: `pnpm test -- test/remove-cli.test.ts test/lock-command.test.ts`
Expected: PASS so the documented command shapes and lockfile semantics still match the tested behavior.

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-CN.md docs/PRD.md docs/TODO.md
git commit -m "docs: describe skill-level store and remove defaults"
```

### Task 9: Full Verification

**Files:**
- Test: `test/install-command.test.ts`
- Test: `test/remove-command.test.ts`
- Test: `test/remove-cli.test.ts`
- Test: `test/remove-inputs.test.ts`
- Test: `test/list-command.test.ts`
- Test: `test/lock-command.test.ts`
- Test: `test/project-lockfile-sync.test.ts`
- Test: `test/doctor-command.test.ts`
- Test: `test/prune-command.test.ts`
- Test: `test/source-manifest.test.ts`
- Test: `test/skill-store-grouping.test.ts`

- [ ] **Step 1: Run targeted feature tests**

Run: `pnpm test -- test/source-manifest.test.ts test/install-command.test.ts test/remove-inputs.test.ts test/remove-command.test.ts test/remove-cli.test.ts test/list-command.test.ts test/lock-command.test.ts test/project-lockfile-sync.test.ts test/doctor-command.test.ts test/prune-command.test.ts test/skill-store-grouping.test.ts`
Expected: PASS with all skill-level store, remove UX, and manifest-based lockfile flows green.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: PASS with `dist/` generated successfully.

- [ ] **Step 4: Run package dry run**

Run: `npm pack --dry-run`
Expected: PASS with package contents still limited to intended distributable files.

- [ ] **Step 5: Commit final verification-related fixes if needed**

```bash
git add .
git commit -m "test: verify skill-level store and remove flow"
```

## Self-Review

**Spec coverage:**
- Skill-level persistence replacing source-level managed store: Task 2
- Preserve logical source grouping for list/lock/doctor: Task 3 and Task 4
- Skill-level removal: Task 6
- Default `--project` remove and tool inference: Task 5
- Multiple-tool prompt before removal: Task 5
- Duplicate skill names show descriptions and prompt for selection: Task 6
- Keep whole-source removal path: Task 6
- Prune and lockfile compatibility with new storage model: Task 4 and Task 7

**Placeholder scan:**
- No `TODO` or `TBD` action steps remain.
- Each code-changing task names exact files and exact test commands.

**Type consistency:**
- Plan consistently uses:
  - source manifest = lightweight source metadata
  - skill store entry = one persisted managed skill
  - logical source group = aggregation unit for list/lock/remove-by-bundle
