# Automatic Project Lockfile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically keep `skills-lock.yaml` in sync after successful project-scoped source installs and project-scoped removals, while preserving the existing manual `skill lock` command.

**Architecture:** Extract the current `skill lock` export behavior into a reusable core that can run in two modes: manual rebuild and automatic sync. Keep install/remove command modules focused on install/remove semantics, then trigger automatic sync from the CLI workflow after successful `--project` mutations only.

**Tech Stack:** TypeScript, commander, yaml, vitest, Node.js built-ins

---

## File Structure

- Create: `src/core/lockfile/sync-project-lockfile.ts`
- Create: `src/commands/auto-sync-project-lockfile.ts`
- Create: `test/project-lockfile-sync.test.ts`
- Create: `test/auto-sync-project-lockfile.test.ts`
- Create: `test/remove-cli.test.ts`
- Modify: `src/commands/lock.ts:1-165`
- Modify: `src/cli.ts:67-148`
- Modify: `test/lock-command.test.ts:1-178`
- Modify: `test/install-cli.test.ts:1-295`
- Modify: `README.md:48-142`
- Modify: `README.zh-CN.md:43-142`
- Modify: `docs/PRD.md:113-222`

## Constraints

- Automatic lockfile sync runs only after successful `skill install <source> --project ...`
- Automatic lockfile sync runs only after successful `skill remove <bundle-name> --project ...`
- No automatic sync for `--global`
- No automatic sync for `--dir <path>`
- No automatic sync after lockfile install mode (`skill install` with no source)
- Automatic sync and manual `skill lock` must share the same bundle-selection and source-resolution rules
- Automatic sync deletes `skills-lock.yaml` when the project has no eligible managed project bundles left
- Sync failure after a successful install/remove must not roll back the primary action

### Task 1: Extract Reusable Project Lockfile Sync Core

**Files:**
- Create: `src/core/lockfile/sync-project-lockfile.ts`
- Modify: `src/commands/lock.ts:1-165`
- Create: `test/project-lockfile-sync.test.ts`
- Modify: `test/lock-command.test.ts:1-178`

- [ ] **Step 1: Write the failing core sync tests**

Add `test/project-lockfile-sync.test.ts` covering:

```ts
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { syncProjectLockfile } from "../src/core/lockfile/sync-project-lockfile.js";
import { ExitCode } from "../src/core/errors.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("syncProjectLockfile", () => {
  it("writes the default project lockfile in manual mode from managed healthy project bundles", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-sync-lockfile-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const storeDir = join(base, "store");
    const targetRoot = join(projectRoot, ".opencode", "skills");
    const storedSourceDir = join(storeDir, "store", "cache-1");
    const alphaDir = join(storedSourceDir, "alpha-skill");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(alphaDir, { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await writeFile(join(alphaDir, "SKILL.md"), "# alpha\n");
    await writeFile(join(storedSourceDir, ".skill-cli-source.json"), JSON.stringify({
      version: 1,
      bundleName: "alpha-bundle",
      sourceKind: "local",
      sourceRaw: "./skills-source",
      sourceCanonical: join(projectRoot, "skills-source"),
      cacheKey: "cache-1",
    }));
    await symlink(alphaDir, join(targetRoot, "alpha-skill"));
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({
      storeDir,
      tools: {
        opencode: {
          globalDir: join(base, "global"),
          projectDir: ".opencode/skills",
          entryPattern: "**/SKILL.md",
          nameStrategy: "parentDir",
        },
      },
    }));
    await writeFile(join(storeDir, "registry.json"), JSON.stringify({
      version: 2,
      bundles: [{
        bundleId: "bundle-1",
        bundleName: "alpha-bundle",
        tool: "opencode",
        targetType: "project",
        targetRoot,
        sourceRaw: "./skills-source",
        sourceKind: "local",
        sourceCanonical: join(projectRoot, "skills-source"),
        cacheKey: "cache-1",
        storedSourceDir,
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        members: [{
          skillName: "alpha-skill",
          linkPath: join(targetRoot, "alpha-skill"),
          sourceSkillDir: alphaDir,
        }],
      }],
    }, null, 2));

    const result = await syncProjectLockfile({
      cwd: projectRoot,
      homeDir,
      tool: "all",
      mode: "manual",
      force: true,
    });

    expect(result.action).toBe("written");
    await expect(readFile(join(projectRoot, "skills-lock.yaml"), "utf8")).resolves.toContain("./skills-source");
  });

  it("deletes the default project lockfile in auto mode when no eligible bundles remain", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-sync-delete-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({ storeDir: join(base, "store") }));
    await writeFile(join(projectRoot, "skills-lock.yaml"), "version: 1\nbundles:\n  - source: ./stale\n");

    const result = await syncProjectLockfile({
      cwd: projectRoot,
      homeDir,
      tool: "all",
      mode: "auto",
    });

    expect(result.action).toBe("deleted");
    await expect(lstat(join(projectRoot, "skills-lock.yaml"))).rejects.toThrow();
  });

  it("fails in manual mode when no eligible bundles exist", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-sync-empty-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({ storeDir: join(base, "store") }));

    await expect(syncProjectLockfile({
      cwd: projectRoot,
      homeDir,
      tool: "all",
      mode: "manual",
      force: false,
    })).rejects.toMatchObject({
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/No eligible managed project bundles/),
    });
  });
});
```

- [ ] **Step 2: Run the new core tests and verify RED**

Run: `pnpm vitest run test/project-lockfile-sync.test.ts test/lock-command.test.ts`
Expected: FAIL because `syncProjectLockfile()` does not exist and `runLockCommand()` still owns the export logic directly.

- [ ] **Step 3: Implement the reusable sync core**

Create `src/core/lockfile/sync-project-lockfile.ts` with two explicit modes and one shared scan/export path:

```ts
import { lstat, rm } from "node:fs/promises";
import { homedir } from "node:os";

import { loadConfig } from "../config/load.js";
import { groupScannedSkillsIntoBundles } from "../discovery/group-scanned-bundles.js";
import { scanInstalledSkills } from "../discovery/scan-installed.js";
import { ExitCode, SkillCliError } from "../errors.js";
import { createOutput, type Output } from "../output.js";
import { loadRegistry } from "../registry/registry.js";
import { resolvePath } from "../path-utils.js";
import { resolveProjectSkillsLockfilePath } from "./path.js";
import { resolveLockedSourceForBundle } from "./resolve-locked-source.js";
import { writeSkillsLockfile } from "./write.js";
import { resolveStoreRootDir, resolveTargetRoot, selectTools } from "../../commands/shared.js";

export interface SyncProjectLockfileArgs {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
  tool: string;
  mode: "manual" | "auto";
  outputPath?: string;
  force?: boolean;
}

export interface SyncProjectLockfileResult {
  action: "written" | "deleted" | "skipped";
  outputPath: string;
  bundleCount: number;
  sources: string[];
}

function memberKey(member: { skillName: string; linkPath: string }): string {
  return `${member.skillName}::${member.linkPath}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function syncProjectLockfile(args: SyncProjectLockfileArgs): Promise<SyncProjectLockfileResult> {
  const cwd = args.cwd ?? process.cwd();
  const homeDir = args.homeDir ?? homedir();
  const env = args.env ?? process.env;
  const output = args.output ?? createOutput();
  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const registry = await loadRegistry(storeRootDir);
  const outputPath = args.outputPath
    ? resolvePath(args.outputPath, cwd, homeDir)
    : await resolveProjectSkillsLockfilePath(cwd);

  if (args.mode === "manual" && !args.force && (await pathExists(outputPath))) {
    throw new SkillCliError(
      `Lockfile already exists: ${outputPath}`,
      ExitCode.USER_INPUT,
      "Re-run with --force to overwrite the existing lockfile",
    );
  }

  const projectTargets = await Promise.all(selectedTools.map(async (toolName) => {
    const toolConfig = config.tools[toolName];
    if (!toolConfig) {
      return undefined;
    }

    return {
      tool: toolName,
      targetRoot: await resolveTargetRoot({ target: { type: "project" }, toolConfig, cwd, homeDir }),
      entryPattern: toolConfig.entryPattern,
    };
  }));

  const scanTargets = projectTargets.flatMap((target) => target ? [{
    tool: target.tool,
    targetType: "project" as const,
    targetRoot: target.targetRoot,
    entryPattern: target.entryPattern,
  }] : []);

  const scannedEntries = await scanInstalledSkills(scanTargets);
  const scannedBundles = await groupScannedSkillsIntoBundles(scannedEntries.filter((entry) => !entry.isBrokenSymlink));
  const scannedBundlesByKey = new Map(scannedBundles.map((bundle) => [`${bundle.tool}::${bundle.targetRoot}::${bundle.bundleId}`, bundle]));
  const currentProjectRoots = new Set(scanTargets.map((target) => `${target.tool}::${target.targetRoot}`));

  const eligibleBundles = registry.bundles.filter((bundle) => {
    if (bundle.targetType !== "project") {
      return false;
    }
    if (!currentProjectRoots.has(`${bundle.tool}::${bundle.targetRoot}`)) {
      return false;
    }

    const scannedBundle = scannedBundlesByKey.get(`${bundle.tool}::${bundle.targetRoot}::${bundle.bundleId}`);
    if (!scannedBundle) {
      return false;
    }

    const scannedMemberKeys = new Set(scannedBundle.members.map((member) => memberKey(member)));
    return bundle.members.every((member) => scannedMemberKeys.has(memberKey(member)));
  });

  if (eligibleBundles.length === 0) {
    if (args.mode === "auto") {
      if (await pathExists(outputPath)) {
        await rm(outputPath, { force: true });
        output.info(`Deleted project lockfile at ${outputPath}`);
        return { action: "deleted", outputPath, bundleCount: 0, sources: [] };
      }

      return { action: "skipped", outputPath, bundleCount: 0, sources: [] };
    }

    throw new SkillCliError("No eligible managed project bundles found for lockfile generation", ExitCode.USER_INPUT);
  }

  const sources = Array.from(new Set(await Promise.all(eligibleBundles.map(async (bundle) => {
    return await resolveLockedSourceForBundle({ cwd, bundle });
  })))).sort((left, right) => left.localeCompare(right));

  await writeSkillsLockfile(outputPath, {
    version: 1,
    bundles: sources.map((source) => ({ source })),
  });

  output.info(`Wrote ${sources.length} locked bundle source(s) to ${outputPath}`);
  return { action: "written", outputPath, bundleCount: sources.length, sources };
}
```

- [ ] **Step 4: Rewire `runLockCommand()` to delegate to the core**

Replace the current body of `src/commands/lock.ts` with a thin wrapper:

```ts
import { syncProjectLockfile } from "../core/lockfile/sync-project-lockfile.js";

export async function runLockCommand(
  args: LockCommandArgs,
  runtime: LockRuntimeOptions = {},
): Promise<LockCommandResult> {
  const result = await syncProjectLockfile({
    ...runtime,
    tool: args.tool,
    mode: "manual",
    outputPath: args.output,
    force: args.force,
  });

  return {
    outputPath: result.outputPath,
    bundleCount: result.bundleCount,
  };
}
```

- [ ] **Step 5: Run the core and lock command tests and verify GREEN**

Run: `pnpm vitest run test/project-lockfile-sync.test.ts test/lock-command.test.ts test/cli-lock-command.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/lockfile/sync-project-lockfile.ts src/commands/lock.ts test/project-lockfile-sync.test.ts test/lock-command.test.ts test/cli-lock-command.test.ts
git commit -m "refactor: extract reusable project lockfile sync"
```

### Task 2: Add Automatic Sync Wrapper for Successful Project Mutations

**Files:**
- Create: `src/commands/auto-sync-project-lockfile.ts`
- Create: `test/auto-sync-project-lockfile.test.ts`

- [ ] **Step 1: Write the failing wrapper tests**

Add `test/auto-sync-project-lockfile.test.ts` covering:

```ts
import { describe, expect, it, vi } from "vitest";

import { runAutoSyncProjectLockfile } from "../src/commands/auto-sync-project-lockfile.js";
import * as syncProjectLockfileModule from "../src/core/lockfile/sync-project-lockfile.js";
import { ExitCode, SkillCliError } from "../src/core/errors.js";

describe("runAutoSyncProjectLockfile", () => {
  it("delegates to auto sync mode", async () => {
    const syncSpy = vi.spyOn(syncProjectLockfileModule, "syncProjectLockfile").mockResolvedValue({
      action: "written",
      outputPath: "/repo/skills-lock.yaml",
      bundleCount: 2,
      sources: ["./alpha", "./beta"],
    });

    await expect(runAutoSyncProjectLockfile({
      action: "install",
      tool: "all",
      cwd: "/repo",
    })).resolves.toEqual({
      action: "written",
      outputPath: "/repo/skills-lock.yaml",
      bundleCount: 2,
      sources: ["./alpha", "./beta"],
    });

    expect(syncSpy).toHaveBeenCalledWith(expect.objectContaining({
      mode: "auto",
      tool: "all",
      cwd: "/repo",
    }));
  });

  it("wraps install sync failures after a successful install", async () => {
    vi.spyOn(syncProjectLockfileModule, "syncProjectLockfile").mockRejectedValue(
      new SkillCliError("No eligible managed project bundles found for lockfile generation", ExitCode.USER_INPUT),
    );

    await expect(runAutoSyncProjectLockfile({
      action: "install",
      tool: "opencode",
      cwd: "/repo",
    })).rejects.toMatchObject({
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/Install succeeded but automatic lockfile sync failed/),
      suggestion: expect.stringMatching(/skill lock/),
    });
  });

  it("wraps remove sync failures after a successful remove", async () => {
    vi.spyOn(syncProjectLockfileModule, "syncProjectLockfile").mockRejectedValue(
      new SkillCliError("Lockfile already exists", ExitCode.USER_INPUT),
    );

    await expect(runAutoSyncProjectLockfile({
      action: "remove",
      tool: "opencode",
      cwd: "/repo",
    })).rejects.toMatchObject({
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/Remove succeeded but automatic lockfile sync failed/),
      suggestion: expect.stringMatching(/skill lock/),
    });
  });
});
```

- [ ] **Step 2: Run the wrapper tests and verify RED**

Run: `pnpm vitest run test/auto-sync-project-lockfile.test.ts`
Expected: FAIL because the wrapper does not exist.

- [ ] **Step 3: Implement the automatic sync wrapper**

Create `src/commands/auto-sync-project-lockfile.ts`:

```ts
import { ExitCode, SkillCliError } from "../core/errors.js";
import {
  syncProjectLockfile,
  type SyncProjectLockfileResult,
} from "../core/lockfile/sync-project-lockfile.js";

export interface AutoSyncProjectLockfileArgs {
  action: "install" | "remove";
  tool: string;
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export async function runAutoSyncProjectLockfile(
  args: AutoSyncProjectLockfileArgs,
): Promise<SyncProjectLockfileResult> {
  try {
    return await syncProjectLockfile({
      cwd: args.cwd,
      homeDir: args.homeDir,
      env: args.env,
      tool: args.tool,
      mode: "auto",
    });
  } catch (error) {
    if (error instanceof SkillCliError) {
      throw new SkillCliError(
        `${args.action === "install" ? "Install" : "Remove"} succeeded but automatic lockfile sync failed`,
        error.exitCode,
        "Fix the lockfile sync problem and rerun `skill lock` to resync the project lockfile.",
        error,
      );
    }

    throw new SkillCliError(
      `${args.action === "install" ? "Install" : "Remove"} succeeded but automatic lockfile sync failed`,
      ExitCode.INTERNAL,
      "Fix the lockfile sync problem and rerun `skill lock` to resync the project lockfile.",
      error,
    );
  }
}
```

- [ ] **Step 4: Run the wrapper tests and verify GREEN**

Run: `pnpm vitest run test/auto-sync-project-lockfile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/auto-sync-project-lockfile.ts test/auto-sync-project-lockfile.test.ts
git commit -m "feat: add automatic project lockfile sync wrapper"
```

### Task 3: Trigger Automatic Sync After Successful Project Source Install

**Files:**
- Modify: `src/cli.ts:67-105`
- Modify: `test/install-cli.test.ts:1-295`

- [ ] **Step 1: Write the failing install CLI sync tests**

Extend `test/install-cli.test.ts` with cases like:

```ts
import * as autoSyncProjectLockfileModule from "../src/commands/auto-sync-project-lockfile.js";

it("runs automatic project lockfile sync after successful source install into project target", async () => {
  vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
    storeDir: ".skill-store",
    tools: {
      codex: {
        globalDir: ".codex/global",
        projectDir: ".codex/project",
        entryPattern: "**/SKILL.md",
        nameStrategy: "parentDir",
      },
    },
  });
  vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({
    tool: "codex",
    target: { type: "project" },
  });
  const installSpy = vi.spyOn(installCommandModule, "runInstallCommand").mockResolvedValue({
    storedSourceDir: "/tmp/store",
    installedByTool: { codex: ["alpha"] },
  });
  const syncSpy = vi.spyOn(autoSyncProjectLockfileModule, "runAutoSyncProjectLockfile").mockResolvedValue({
    action: "written",
    outputPath: "/repo/skills-lock.yaml",
    bundleCount: 1,
    sources: ["./skills-source"],
  });

  await runCli(["node", "skill", "install", "./skills-source", "--tool", "codex", "--project"]);

  expect(installSpy).toHaveBeenCalledTimes(1);
  expect(syncSpy).toHaveBeenCalledWith({
    action: "install",
    tool: "codex",
    cwd: expect.any(String),
    homeDir: undefined,
    env: undefined,
  });
});

it("does not run automatic project lockfile sync for lockfile install mode", async () => {
  const syncSpy = vi.spyOn(autoSyncProjectLockfileModule, "runAutoSyncProjectLockfile");
  vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
    storeDir: ".skill-store",
    tools: { codex: { globalDir: ".codex/global", projectDir: ".codex/project", entryPattern: "**/SKILL.md", nameStrategy: "parentDir" } },
  });
  vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({ tool: "codex", target: { type: "project" } });
  vi.spyOn(installFromLockfileCommandModule, "runInstallFromLockfileCommand").mockResolvedValue({
    lockfilePath: "/repo/skills-lock.yaml",
    installedSources: ["./alpha"],
  });

  await runCli(["node", "skill", "install"]);

  expect(syncSpy).not.toHaveBeenCalled();
});

it("does not run automatic project lockfile sync for global or custom-dir source installs", async () => {
  const syncSpy = vi.spyOn(autoSyncProjectLockfileModule, "runAutoSyncProjectLockfile");
  vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
    storeDir: ".skill-store",
    tools: { codex: { globalDir: ".codex/global", projectDir: ".codex/project", entryPattern: "**/SKILL.md", nameStrategy: "parentDir" } },
  });
  vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({ tool: "codex", target: { type: "global" } });
  vi.spyOn(installCommandModule, "runInstallCommand").mockResolvedValue({ storedSourceDir: "/tmp/store", installedByTool: { codex: ["alpha"] } });

  await runCli(["node", "skill", "install", "./skills-source", "--tool", "codex", "--global"]);

  expect(syncSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the install CLI tests and verify RED**

Run: `pnpm vitest run test/install-cli.test.ts`
Expected: FAIL because `src/cli.ts` does not trigger automatic sync after successful project source installs.

- [ ] **Step 3: Wire install success to automatic sync**

Modify the install action in `src/cli.ts`:

```ts
import { runAutoSyncProjectLockfile } from "./commands/auto-sync-project-lockfile.js";

if (source) {
  await runInstallCommand({
    source,
    tool: resolved.tool,
    force: Boolean(options.force),
    target: resolved.target,
  });

  if (resolved.target.type === "project") {
    await runAutoSyncProjectLockfile({
      action: "install",
      tool: resolved.tool,
    });
  }

  return;
}
```

- [ ] **Step 4: Run the install CLI tests and verify GREEN**

Run: `pnpm vitest run test/install-cli.test.ts test/auto-sync-project-lockfile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/install-cli.test.ts
git commit -m "feat: auto-sync project lockfile after source installs"
```

### Task 4: Trigger Automatic Sync After Successful Project Removals

**Files:**
- Modify: `src/cli.ts:107-120`
- Create: `test/remove-cli.test.ts`

- [ ] **Step 1: Write the failing remove CLI sync tests**

Add `test/remove-cli.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import * as autoSyncProjectLockfileModule from "../src/commands/auto-sync-project-lockfile.js";
import * as removeCommandModule from "../src/commands/remove.js";
import { runCli } from "../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("runCli remove", () => {
  it("runs automatic project lockfile sync after successful project removal", async () => {
    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue({
      removedBundles: 1,
      removedLinkPaths: ["/repo/.opencode/skills/alpha"],
      removedRegistryEntries: 1,
    });
    const syncSpy = vi.spyOn(autoSyncProjectLockfileModule, "runAutoSyncProjectLockfile").mockResolvedValue({
      action: "deleted",
      outputPath: "/repo/skills-lock.yaml",
      bundleCount: 0,
      sources: [],
    });

    await runCli(["node", "skill", "remove", "alpha-bundle", "--tool", "opencode", "--project"]);

    expect(syncSpy).toHaveBeenCalledWith({
      action: "remove",
      tool: "opencode",
      cwd: expect.any(String),
      homeDir: undefined,
      env: undefined,
    });
  });

  it("does not run automatic project lockfile sync for global removals", async () => {
    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue({
      removedBundles: 1,
      removedLinkPaths: ["/global/alpha"],
      removedRegistryEntries: 1,
    });
    const syncSpy = vi.spyOn(autoSyncProjectLockfileModule, "runAutoSyncProjectLockfile");

    await runCli(["node", "skill", "remove", "alpha-bundle", "--tool", "opencode", "--global"]);

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it("surfaces automatic sync failure after a successful remove", async () => {
    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue({
      removedBundles: 1,
      removedLinkPaths: ["/repo/.opencode/skills/alpha"],
      removedRegistryEntries: 1,
    });
    vi.spyOn(autoSyncProjectLockfileModule, "runAutoSyncProjectLockfile").mockRejectedValue(
      new Error("lockfile write broke"),
    );
    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await runCli(["node", "skill", "remove", "alpha-bundle", "--tool", "opencode", "--project"]);

    expect(stderrWriteSpy).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
```

- [ ] **Step 2: Run the remove CLI tests and verify RED**

Run: `pnpm vitest run test/remove-cli.test.ts`
Expected: FAIL because the remove CLI path does not trigger automatic sync.

- [ ] **Step 3: Wire remove success to automatic sync**

Modify the remove action in `src/cli.ts`:

```ts
await runRemoveCommand({
  bundleName,
  tool: options.tool,
  target: parseTargetOptions(options),
});

const resolvedTarget = parseTargetOptions(options);
if (resolvedTarget.type === "project") {
  await runAutoSyncProjectLockfile({
    action: "remove",
    tool: options.tool,
  });
}
```

Keep the implementation DRY by parsing the target once and reusing that value for both `runRemoveCommand()` and the project-only sync check.

- [ ] **Step 4: Run the remove CLI tests and verify GREEN**

Run: `pnpm vitest run test/remove-cli.test.ts test/auto-sync-project-lockfile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/remove-cli.test.ts
git commit -m "feat: auto-sync project lockfile after removals"
```

### Task 5: Update Docs and Verify the Full Flow

**Files:**
- Modify: `README.md:48-142`
- Modify: `README.zh-CN.md:43-142`
- Modify: `docs/PRD.md:113-222`

- [ ] **Step 1: Update the English README**

Adjust `README.md` so it states that project-scoped source installs and project-scoped removals automatically sync the project lockfile. Update examples and notes like this:

```md
- `skill lock` remains available for manual rebuilds.
- `skill install <source> --project` automatically creates or updates `skills-lock.yaml`.
- `skill remove <bundle-name> --project` automatically updates or deletes `skills-lock.yaml`.
- `skill install` with no source still reads the lockfile but does not rewrite it.
```

- [ ] **Step 2: Update the Chinese README**

Mirror the same behavior notes in `README.zh-CN.md`:

```md
- `skill lock` 仍保留为显式重建命令。
- `skill install <source> --project` 会自动创建或更新 `skills-lock.yaml`。
- `skill remove <bundle-name> --project` 会自动更新或删除 `skills-lock.yaml`。
- 省略 `source` 的 `skill install` 仍然只读取 lockfile，不会自动回写。
```

- [ ] **Step 3: Update the PRD**

Update `docs/PRD.md` so the install/remove requirements reflect automatic project lockfile sync, and add the distinction between manual and automatic lockfile behavior.

```md
- FR-1 Install: successful project-scoped source installs automatically sync the project lockfile
- FR-2 Remove: successful project-scoped removals automatically sync the project lockfile
- FR-7 Lockfile: manual `skill lock` errors on empty eligible state, automatic sync deletes the stale file instead
```

- [ ] **Step 4: Run targeted tests for the new workflow**

Run: `pnpm vitest run test/project-lockfile-sync.test.ts test/auto-sync-project-lockfile.test.ts test/lock-command.test.ts test/install-cli.test.ts test/remove-cli.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`
Expected: PASS with all existing and new tests green

- [ ] **Step 6: Run the build**

Run: `pnpm build`
Expected: PASS with no TypeScript errors

- [ ] **Step 7: Run package verification**

Run: `npm pack --json --dry-run`
Expected: PASS and package contents still include updated `dist/`, `README*`, and `docs/PRD.md`

- [ ] **Step 8: Commit**

```bash
git add README.md README.zh-CN.md docs/PRD.md test/project-lockfile-sync.test.ts test/auto-sync-project-lockfile.test.ts test/remove-cli.test.ts
git commit -m "docs: describe automatic project lockfile sync"
```

## Spec Coverage Check

- Automatic sync after successful `skill install <source> --project`: Task 3
- Automatic sync after successful `skill remove <bundle-name> --project`: Task 4
- Shared manual/automatic export rules: Task 1
- Empty automatic project state deletes lockfile: Task 1 and Task 2
- Global/custom-target commands do not touch project lockfile: Tasks 3 and 4 tests
- Lockfile install mode does not auto-rewrite the lockfile: Task 3 tests
- Sync failure does not roll back the primary action and points users to `skill lock`: Task 2 and Task 4

## Placeholder Scan

- No `TODO` / `TBD` placeholders remain.
- Every task includes the exact files, commands, and code skeleton needed to implement the change.

## Type Consistency Check

- Reusable core uses `mode: "manual" | "auto"` throughout.
- Manual sync continues returning lockfile result data to `runLockCommand()`.
- Automatic sync is wrapped by `runAutoSyncProjectLockfile()` with `action: "install" | "remove"` so CLI error messages stay operation-specific.
