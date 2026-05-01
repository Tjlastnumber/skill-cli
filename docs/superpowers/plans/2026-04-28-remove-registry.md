# Registryless Install State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `registry.json` and all register/relink workflows, then derive install state from live symlink scans, store metadata, and current-project `skills-lock.yaml` where project intent matters.

**Architecture:** Add one shared live-bundle scan helper and one shared project-lockfile builder, then migrate `install`, `remove`, `list`, `doctor`, `prune`, and project lockfile sync off registry-backed state. Keep global and custom-directory behavior live-scan only, and use `skills-lock.yaml` only as current-project desired state and recovery input.

**Tech Stack:** TypeScript, commander, vitest, yaml, Node.js built-ins

---

## File Structure

- Create: `src/core/discovery/scan-live-bundles.ts` — wrap `scanInstalledSkills()` + `groupScannedSkillsIntoBundles()` and split live bundles into managed/discovered/broken sets
- Create: `src/core/lockfile/build-project-lockfile.ts` — derive normalized project lockfile entries from live managed project bundles
- Create: `test/cli-command-removal.test.ts` — assert removed `register`, `relink`, and `doctor --repair-registry` surfaces fail at the CLI layer
- Delete: `src/core/registry/registry.ts` — remove central registry persistence
- Delete: `src/commands/register.ts` — remove register implementation
- Delete: `src/commands/relink.ts` — remove relink implementation
- Delete: `test/register-command.test.ts` — obsolete register coverage
- Delete: `test/registry-migration.test.ts` — obsolete registry migration coverage
- Delete: `test/relink-command.test.ts` — obsolete relink coverage
- Modify: `src/cli.ts` — remove register/relink/repair-registry wiring and add repeatable `prune --dir`
- Modify: `src/commands/shared.ts` — remove registry-backed custom-dir scan-root reuse
- Modify: `src/commands/install.ts` — find existing managed bundle from live scans instead of registry
- Modify: `src/commands/remove.ts` — remove live matched bundles without registry cleanup
- Modify: `src/commands/list.ts` — return scan-based managed/discovered entries instead of `RegistryBundleEntry`
- Modify: `src/commands/doctor.ts` — validate live state and optional project lockfile drift without repair mode
- Modify: `src/commands/prune.ts` — compute live cache keys from current scans and honor explicit custom dirs
- Modify: `src/core/lockfile/sync-project-lockfile.ts` — build lockfiles from live project bundles instead of registry bundles
- Modify: `test/install-command.test.ts` — remove registry assertions and keep live refresh behavior coverage
- Modify: `test/remove-command.test.ts` — assert live bundle removal result shape
- Modify: `test/list-command.test.ts` — assert live managed/discovered classification
- Modify: `test/doctor-command.test.ts` — replace register/repair expectations with live + project-lock drift expectations
- Modify: `test/prune-command.test.ts` — add explicit custom-dir protection coverage
- Modify: `test/project-lockfile-sync.test.ts` — assert sync works without `registry.json`
- Modify: `test/lock-command.test.ts` — assert manual lockfile export works from live managed project bundles
- Modify: `test/install-cli.test.ts` — keep auto-sync expectations, add removed `--repair-registry` rejection if needed
- Modify: `test/remove-cli.test.ts` — keep project auto-sync coverage after registry removal
- Modify: `README.md` — remove register/relink docs, describe live scan + project lockfile behavior
- Modify: `README.zh-CN.md` — same documentation updates in Chinese
- Modify: `docs/TODO.md` — remove completed registry/register/relink items that no longer describe current scope

## Constraints

- Do not create a replacement central registry file
- Keep `.skill-cli-source.json` as the only persisted source metadata file
- Treat `skills-lock.yaml` as current-project desired state only
- Do not use `skills-lock.yaml` as the liveness source for `prune`
- Do not reintroduce implicit remembered custom scan roots
- Remove `DoctorCommandArgs.repairRegistry` and `DoctorCommandResult.repairedCount`
- Remove `RemoveCommandResult.removedRegistryEntries`
- Replace `ListCommandResult.entries` with a scan-based entry type instead of `RegistryBundleEntry`

### Task 1: Add Live Bundle Scan + Registryless Project Lockfile Builder

**Files:**
- Create: `src/core/discovery/scan-live-bundles.ts`
- Create: `src/core/lockfile/build-project-lockfile.ts`
- Modify: `src/core/lockfile/sync-project-lockfile.ts`
- Modify: `test/project-lockfile-sync.test.ts`
- Modify: `test/lock-command.test.ts`

- [ ] **Step 1: Write the failing lockfile tests for registryless project sync**

Update `test/project-lockfile-sync.test.ts` and `test/lock-command.test.ts` so they prove project lockfile export no longer depends on `registry.json`.

Add or update tests like:

```ts
it("writes skills-lock.yaml from live managed project bundles without registry.json", async () => {
  const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-live-"));
  const homeDir = join(base, "home");
  const projectRoot = join(base, "repo");
  const storeDir = join(base, "store");

  await mkdir(join(projectRoot, ".git"), { recursive: true });
  await mkdir(join(projectRoot, "skills-source", "alpha-skill"), { recursive: true });
  await writeFile(join(projectRoot, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");
  await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir: join(base, "global") });

  await runInstallCommand(
    { source: "./skills-source", tool: "opencode", target: { type: "project" }, force: false },
    { cwd: projectRoot, homeDir, output: captureOutput().output },
  );

  await expect(lstat(join(storeDir, "registry.json"))).rejects.toThrow();

  await syncProjectLockfile(
    { tool: "all", mode: "manual", force: true },
    { cwd: projectRoot, homeDir, output: captureOutput().output },
  );

  await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
    version: 2,
    skills: [{ source: "./skills-source", name: "*" }],
  });
});
```

- [ ] **Step 2: Run the project-lockfile tests and verify RED**

Run: `pnpm vitest run test/project-lockfile-sync.test.ts test/lock-command.test.ts`
Expected: FAIL because `syncProjectLockfile()` still imports `loadRegistry()` and filters eligible bundles from registry entries.

- [ ] **Step 3: Implement shared live-bundle scanning**

Create `src/core/discovery/scan-live-bundles.ts` with a single wrapper for scan, grouping, and managed/discovered classification.

```ts
import {
  groupScannedSkillsIntoBundles,
  type ScannedBundleGroup,
} from "./group-scanned-bundles.js";
import {
  scanInstalledSkills,
  type InstalledSkillCandidate,
  type ScannedInstalledSkill,
} from "./scan-installed.js";

export interface LiveBundleScanResult {
  scannedEntries: ScannedInstalledSkill[];
  brokenEntries: ScannedInstalledSkill[];
  bundles: ScannedBundleGroup[];
  managedBundles: ScannedBundleGroup[];
  discoveredBundles: ScannedBundleGroup[];
}

export function isManagedScannedBundle(bundle: ScannedBundleGroup): boolean {
  return bundle.cacheKey !== "unknown" && bundle.storedSourceDir !== "unknown";
}

export async function scanLiveBundles(
  candidates: InstalledSkillCandidate[],
): Promise<LiveBundleScanResult> {
  const scannedEntries = await scanInstalledSkills(candidates);
  const brokenEntries = scannedEntries.filter((entry) => entry.isBrokenSymlink);
  const bundles = await groupScannedSkillsIntoBundles(
    scannedEntries.filter((entry) => !entry.isBrokenSymlink),
  );

  return {
    scannedEntries,
    brokenEntries,
    bundles,
    managedBundles: bundles.filter(isManagedScannedBundle),
    discoveredBundles: bundles.filter((bundle) => !isManagedScannedBundle(bundle)),
  };
}
```

- [ ] **Step 4: Extract a registryless project-lockfile builder and rewire sync**

Create `src/core/lockfile/build-project-lockfile.ts` so `syncProjectLockfile()` and later `doctor` can share one live project export path.

```ts
export interface BuildProjectLockfileArgs {
  cwd: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  tool: string;
}

export interface BuiltProjectLockfile {
  lockedSkills: Array<{ source: string; name: string }>;
  bundleCount: number;
}

export async function buildProjectLockfile(
  args: BuildProjectLockfileArgs,
): Promise<BuiltProjectLockfile> {
  const config = await loadConfig({ cwd: args.cwd, homeDir: args.homeDir, env: args.env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const scanTargets = await Promise.all(
    selectedTools.map(async (toolName) => {
      const toolConfig = config.tools[toolName];
      if (!toolConfig) {
        return undefined;
      }

      return {
        tool: toolName,
        targetType: "project" as const,
        targetRoot: await resolveTargetRoot({
          target: { type: "project" },
          toolConfig,
          cwd: args.cwd,
          homeDir: args.homeDir,
        }),
        entryPattern: toolConfig.entryPattern,
      };
    }),
  );

  const { managedBundles } = await scanLiveBundles(scanTargets.filter(Boolean) as InstalledSkillCandidate[]);
  const eligibleBundles = managedBundles.filter((bundle) => bundle.targetType === "project");
  // Reuse the existing locked-source and skill-selection logic here.
  return { lockedSkills, bundleCount: eligibleBundles.length };
}
```

Then simplify `src/core/lockfile/sync-project-lockfile.ts` so it only:

```ts
const built = await buildProjectLockfile({
  cwd: resolvedRuntime.cwd,
  homeDir: resolvedRuntime.homeDir,
  env: resolvedRuntime.env,
  tool: args.tool,
});

if (built.lockedSkills.length === 0) {
  // keep the existing manual error vs auto delete behavior
}

await writeSkillsLockfile(outputPath, {
  version: 2,
  skills: built.lockedSkills,
});
```

- [ ] **Step 5: Run the project-lockfile tests and verify GREEN**

Run: `pnpm vitest run test/project-lockfile-sync.test.ts test/lock-command.test.ts`
Expected: PASS with no code path touching `registry.json`.

- [ ] **Step 6: Commit the lockfile-builder refactor**

```bash
git add src/core/discovery/scan-live-bundles.ts src/core/lockfile/build-project-lockfile.ts src/core/lockfile/sync-project-lockfile.ts test/project-lockfile-sync.test.ts test/lock-command.test.ts
git commit -m "refactor: build project lockfiles from live bundles"
```

### Task 2: Migrate `doctor` and `prune` to Live-State Semantics

**Files:**
- Modify: `src/commands/doctor.ts`
- Modify: `src/commands/prune.ts`
- Modify: `src/cli.ts`
- Modify: `test/doctor-command.test.ts`
- Modify: `test/prune-command.test.ts`

- [ ] **Step 1: Write the failing doctor and prune tests**

Update `test/doctor-command.test.ts` to remove register/repair expectations and add project-lockfile drift coverage.

Add tests like:

```ts
it("warns when skills-lock.yaml declares project skills that are not currently installed", async () => {
  const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-project-drift-"));
  const homeDir = join(base, "home");
  const projectRoot = join(base, "repo");
  const storeDir = join(base, "store");

  await mkdir(join(projectRoot, ".git"), { recursive: true });
  await mkdir(join(projectRoot, "skills-source", "alpha-skill"), { recursive: true });
  await writeFile(join(projectRoot, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");
  await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir: join(base, "global") });
  await writeFile(
    join(projectRoot, "skills-lock.yaml"),
    "version: 2\nskills:\n  - source: ./skills-source\n    name: alpha-skill\n  - source: ./skills-source\n    name: beta-skill\n",
  );

  await runInstallCommand(
    { source: "./skills-source", tool: "opencode", target: { type: "project" }, force: false },
    { cwd: projectRoot, homeDir, output: captureOutput().output },
  );

  const capture = captureOutput();
  const result = await runDoctorCommand({ tool: "opencode" }, { cwd: projectRoot, homeDir, output: capture.output });

  expect(result.projectDriftCount).toBe(1);
  expect(capture.logs.some((line) => line.includes("project drift"))).toBe(true);
});
```

Update `test/prune-command.test.ts` with explicit custom-dir protection:

```ts
it("keeps store entries referenced by explicit custom directories", async () => {
  const customDir = join(base, "custom-skills");
  const installResult = await runInstallCommand(
    { source: "skills-source", tool: "codex", target: { type: "dir", dir: customDir }, force: false },
    { cwd, homeDir, output: quietOutput() },
  );

  const orphanStoreDir = join(storeDir, "store", "orphan-cache-key");
  await mkdir(orphanStoreDir, { recursive: true });

  const result = await runPruneCommand({ dirs: [customDir] }, { cwd, homeDir, output: quietOutput() });

  expect(result.removedStoreEntries).toBe(1);
  expect((await lstat(installResult.storedSourceDir)).isDirectory()).toBe(true);
});
```

- [ ] **Step 2: Run the doctor and prune tests and verify RED**

Run: `pnpm vitest run test/doctor-command.test.ts test/prune-command.test.ts`
Expected: FAIL because `runDoctorCommand()` still expects `repairRegistry`, still suggests `skill register`, and `runPruneCommand()` has no command args for explicit directories.

- [ ] **Step 3: Implement registryless doctor behavior**

In `src/commands/doctor.ts`, replace registry lookups with `scanLiveBundles()` and add project-lockfile drift comparison.

Use interfaces like:

```ts
export interface DoctorCommandArgs {
  tool: string;
  dir?: string;
}

export interface DoctorCommandResult {
  managedCount: number;
  discoveredCount: number;
  brokenCount: number;
  projectDriftCount: number;
}
```

Use logic like:

```ts
const scanTargets = (
  await Promise.all(
    selectedTools.map(async (toolName) => {
      const toolConfig = config.tools[toolName];
      if (!toolConfig) {
        return [];
      }

      return await resolveScanTargets({
        tool: toolName,
        toolConfig,
        cwd,
        homeDir,
        dir: args.dir,
      });
    }),
  )
).flat();

const live = await scanLiveBundles(scanTargets);
const managedCount = live.managedBundles.length;
const discoveredCount = live.discoveredBundles.length;
const brokenCount = live.brokenEntries.length;
const projectDriftCount = await countProjectLockfileDrift({ cwd, homeDir, tool: args.tool });
```

When drift exists, log one warning line plus a suggestion line pointing users to `skill install --project` or `skill lock` depending on which side is out of sync.

- [ ] **Step 4: Implement registryless prune with repeatable custom dirs**

Change `src/commands/prune.ts` to accept command args and collect live cache keys from default scan roots plus explicit `dirs`.

```ts
export interface PruneCommandArgs {
  dirs?: string[];
}

export async function runPruneCommand(
  args: PruneCommandArgs = {},
  runtime: PruneRuntimeOptions = {},
): Promise<PruneCommandResult> {
  const scanTargets = (
    await Promise.all(
      Object.entries(config.tools).map(async ([toolName, toolConfig]) => {
        const baseTargets = await resolveScanTargets({ tool: toolName, toolConfig, cwd, homeDir });
        const extraTargets = await Promise.all(
          (args.dirs ?? []).map(async (dir) => ({
            tool: toolName,
            targetType: "dir" as const,
            targetRoot: resolvePath(dir, cwd, homeDir),
            entryPattern: toolConfig.entryPattern,
          })),
        );
        return [...baseTargets, ...extraTargets];
      }),
    )
  ).flat();

  const live = await scanLiveBundles(scanTargets);
  const liveCacheKeys = new Set(live.managedBundles.map((bundle) => bundle.cacheKey).filter((key) => key !== "unknown"));
  // keep/remove store dirs based on liveCacheKeys
}
```

Update `src/cli.ts` prune wiring to:

```ts
program
  .command("prune")
  .option("--dir <path>", "Also protect custom directory", collectRepeatedOption, [])
  .action(async (options: { dir?: string[] }) => {
    await runPruneCommand({ dirs: options.dir ?? [] });
  });
```

- [ ] **Step 5: Run the doctor and prune tests and verify GREEN**

Run: `pnpm vitest run test/doctor-command.test.ts test/prune-command.test.ts`
Expected: PASS with no `register` suggestion text and with explicit custom-dir prune protection.

- [ ] **Step 6: Commit the doctor/prune migration**

```bash
git add src/commands/doctor.ts src/commands/prune.ts src/cli.ts test/doctor-command.test.ts test/prune-command.test.ts
git commit -m "feat: derive doctor and prune from live install state"
```

### Task 3: Migrate `install`, `remove`, and `list` Off Registry State

**Files:**
- Modify: `src/commands/install.ts`
- Modify: `src/commands/remove.ts`
- Modify: `src/commands/list.ts`
- Modify: `src/commands/shared.ts`
- Modify: `test/install-command.test.ts`
- Modify: `test/remove-command.test.ts`
- Modify: `test/list-command.test.ts`

- [ ] **Step 1: Write the failing install/remove/list tests**

Update `test/install-command.test.ts` so install behavior is asserted through links and store metadata instead of `registry.json`.

Use tests like:

```ts
it("does not create registry.json during install", async () => {
  await runInstallCommand(
    { source: "skills-source", tool: "codex", target: { type: "global" }, force: false },
    { cwd, homeDir, output: quietOutput() },
  );

  await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
  await expect(readFile(join(storeDir, "store", cacheKey, ".skill-cli-source.json"), "utf8")).resolves.toContain("skills-source");
});
```

Update `test/remove-command.test.ts` to remove live bundles without registry fixtures:

```ts
it("removes a live managed bundle without registry lookups", async () => {
  await runInstallCommand(
    { source: "skills-source", tool: "codex", target: { type: "global" }, force: false },
    { cwd, homeDir, output: quietOutput() },
  );

  const result = await runRemoveCommand(
    { bundleName: "skills-source", tool: "codex", target: { type: "global" } },
    { cwd, homeDir, output: quietOutput() },
  );

  expect(result.removedBundles).toBe(1);
  expect(result.removedLinkPaths).toHaveLength(1);
});
```

Update `test/list-command.test.ts` so it asserts live classification:

```ts
it("shows managed bundles when live symlinks point into the store", async () => {
  const result = await runListCommand({ tool: "codex" }, { cwd, homeDir, output: capture.output });
  expect(result.entries[0]).toMatchObject({ status: "managed", bundleName: "skills-source" });
});
```

- [ ] **Step 2: Run the install/remove/list tests and verify RED**

Run: `pnpm vitest run test/install-command.test.ts test/remove-command.test.ts test/list-command.test.ts`
Expected: FAIL because `install.ts`, `remove.ts`, and `list.ts` still import registry helpers and still shape results around `RegistryBundleEntry`.

- [ ] **Step 3: Implement registryless shared target resolution**

Remove the registry-backed `registryBundles` parameter from `resolveScanTargets()` in `src/commands/shared.ts`.

```ts
export async function resolveScanTargets(options: {
  tool: string;
  toolConfig: ToolConfig;
  cwd: string;
  homeDir?: string;
  dir?: string;
}): Promise<InstalledSkillCandidate[]> {
  const { tool, toolConfig, cwd, homeDir = homedir(), dir } = options;
  const dedup = new Set<string>();
  const targets: InstalledSkillCandidate[] = [];
  // keep default global + project roots
  // add explicit dir only when provided
}
```

- [ ] **Step 4: Implement registryless install, remove, and list**

In `src/commands/install.ts`, replace `loadRegistry()` / `upsertRegistryBundles()` with a target-local live scan before mutations.

```ts
const live = await scanLiveBundles([
  {
    tool: toolName,
    targetType: args.target.type,
    targetRoot,
    entryPattern: toolConfig.entryPattern,
  },
]);

const existingManagedBundle = live.managedBundles.find((entry) => {
  return logicalBundleKey({
    tool: entry.tool,
    targetType: entry.targetType,
    targetRoot: entry.targetRoot,
    sourceKind: entry.sourceKind,
    sourceCanonical: entry.sourceCanonical,
    bundleName: entry.bundleName,
  }) === currentBundleKey;
});
```

Then remove the `registryEntries` array and end-of-command `upsertRegistryBundles()` call entirely.

In `src/commands/remove.ts`, scan the specific target root and match live bundles:

```ts
const live = await scanLiveBundles([
  {
    tool: toolName,
    targetType: args.target.type,
    targetRoot,
    entryPattern: toolConfig.entryPattern,
  },
]);

const matchedBundles = live.bundles.filter(
  (bundle) =>
    bundle.tool === toolName &&
    bundle.targetType === args.target.type &&
    bundle.targetRoot === targetRoot &&
    bundle.bundleName === args.bundleName,
);
```

In `src/commands/list.ts`, replace `RegistryBundleEntry`-based output with a local `ListCommandEntry` type:

```ts
export interface ListCommandEntry {
  bundleId: string;
  bundleName: string;
  tool: string;
  targetType: "global" | "project" | "dir";
  targetRoot: string;
  sourceRaw: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceCanonical: string;
  cacheKey: string;
  storedSourceDir: string;
  members: Array<{ skillName: string; linkPath: string; sourceSkillDir?: string }>;
  status: "managed" | "discovered";
}
```

Build `entries` from `live.managedBundles` and `live.discoveredBundles` directly.

- [ ] **Step 5: Run the install/remove/list tests and verify GREEN**

Run: `pnpm vitest run test/install-command.test.ts test/remove-command.test.ts test/list-command.test.ts`
Expected: PASS with no `registry.json` reads/writes and with managed/discovered derived from live scans.

- [ ] **Step 6: Commit the command migration**

```bash
git add src/commands/install.ts src/commands/remove.ts src/commands/list.ts src/commands/shared.ts test/install-command.test.ts test/remove-command.test.ts test/list-command.test.ts
git commit -m "refactor: remove registry from install state commands"
```

### Task 4: Remove Dead CLI Surfaces and Obsolete Files

**Files:**
- Delete: `src/core/registry/registry.ts`
- Delete: `src/commands/register.ts`
- Delete: `src/commands/relink.ts`
- Delete: `test/register-command.test.ts`
- Delete: `test/registry-migration.test.ts`
- Delete: `test/relink-command.test.ts`
- Create: `test/cli-command-removal.test.ts`
- Modify: `src/cli.ts`
- Modify: `test/install-cli.test.ts`
- Modify: `test/remove-cli.test.ts`

- [ ] **Step 1: Write the failing CLI-removal tests**

Create `test/cli-command-removal.test.ts` with explicit checks that removed surfaces now fail.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("removed CLI surfaces", () => {
  it("does not register the register command", async () => {
    await runCli(["node", "skill", "register"]);
    expect(process.exitCode).not.toBe(0);
  });

  it("does not register the relink command", async () => {
    await runCli(["node", "skill", "relink"]);
    expect(process.exitCode).not.toBe(0);
  });

  it("does not accept doctor --repair-registry", async () => {
    await runCli(["node", "skill", "doctor", "--repair-registry"]);
    expect(process.exitCode).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run the CLI-removal tests and verify RED**

Run: `pnpm vitest run test/cli-command-removal.test.ts test/install-cli.test.ts test/remove-cli.test.ts`
Expected: FAIL because `src/cli.ts` still imports `runRegisterCommand`, still registers `relink`, and still exposes `--repair-registry`.

- [ ] **Step 3: Remove the dead command surfaces and files**

In `src/cli.ts`, remove the `register` and `relink` imports and command declarations, and simplify `doctor` args.

```ts
import { runDoctorCommand } from "./commands/doctor.js";
import { runPruneCommand } from "./commands/prune.js";

program
  .command("doctor")
  .option("--tool <tool>", "Target tool id or 'all'", "all")
  .option("--dir <path>", "Also scan custom directory")
  .action(async (options: { tool: string; dir?: string }) => {
    await runDoctorCommand({ tool: options.tool, dir: options.dir });
  });
```

Then delete the dead files listed above so TypeScript and Vitest no longer compile or execute obsolete registry code.

- [ ] **Step 4: Re-run the CLI-removal tests and verify GREEN**

Run: `pnpm vitest run test/cli-command-removal.test.ts test/install-cli.test.ts test/remove-cli.test.ts`
Expected: PASS with removed command surfaces failing and project auto-sync coverage unchanged.

- [ ] **Step 5: Commit the command-surface cleanup**

```bash
git add src/cli.ts test/cli-command-removal.test.ts test/install-cli.test.ts test/remove-cli.test.ts
git rm src/core/registry/registry.ts src/commands/register.ts src/commands/relink.ts test/register-command.test.ts test/registry-migration.test.ts test/relink-command.test.ts
git commit -m "refactor: remove registry and relink command surfaces"
```

### Task 5: Update Documentation and Run Full Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Update the English README**

Remove command table rows and workflow examples for `register`, `doctor --repair-registry`, and `relink`. Replace registry language with live-state language.

Use replacements like:

```md
- `managed` vs `discovered` visibility in `list`, derived from live installed bundles
- Project recovery and desired state via `skills-lock.yaml`
```

And update the command table to omit:

```md
| `skill register ...` | Backfill registry from discovered installs |
| `skill doctor ... --repair-registry` | Validate install state and optionally repair registry |
| `skill relink ...` | Recreate missing symlinks from registry state |
```

- [ ] **Step 2: Update the Chinese README and TODO doc**

Apply the same removals in `README.zh-CN.md` and replace TODO lines that describe registry/register/relink work as current project scope.

Use wording like:

```md
- `list` 中的 `managed` / `discovered` 来源于当前 live 扫描结果
- 项目级期望状态与恢复路径来自 `skills-lock.yaml`
```

- [ ] **Step 3: Run the focused regression suite**

Run: `pnpm vitest run test/project-lockfile-sync.test.ts test/lock-command.test.ts test/doctor-command.test.ts test/prune-command.test.ts test/install-command.test.ts test/remove-command.test.ts test/list-command.test.ts test/install-cli.test.ts test/remove-cli.test.ts test/cli-command-removal.test.ts`
Expected: PASS with no tests importing registry/register/relink code.

- [ ] **Step 4: Run the full test suite and build**

Run: `pnpm test && pnpm build`
Expected: all Vitest suites PASS and TypeScript build emits `dist/` successfully.

- [ ] **Step 5: Commit the docs and final verification state**

```bash
git add README.md README.zh-CN.md docs/TODO.md
git commit -m "docs: describe registryless install state"
```
