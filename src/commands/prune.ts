import { lstat, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { deriveBundleIdentityFromSourceDescriptor } from "../core/bundle/identity.js";
import { loadConfig } from "../core/config/load.js";
import { scanLiveBundles } from "../core/discovery/scan-live-bundles.js";
import { ExitCode, FilesystemError, SkillCliError } from "../core/errors.js";
import { resolveProjectSkillsLockfilePath } from "../core/lockfile/path.js";
import { loadSkillsLockfile } from "../core/lockfile/load.js";
import { syncProjectLockfile } from "../core/lockfile/sync-project-lockfile.js";
import { createOutput, type Output } from "../core/output.js";
import { resolvePath } from "../core/path-utils.js";
import { findProjectRoot } from "../core/project-root.js";
import { parseSource } from "../core/source/parse.js";
import { isCommitSha } from "../core/source/git-ref.js";
import type { CommandRunner } from "../core/source/fetch.js";
import { parseStoredSourceFromPath } from "../core/store/store-path.js";
import { readSourceMetadata } from "../core/store/source-metadata.js";

import { runInstallCommand } from "./install.js";
import { resolveScanTargets, resolveStoreRootDir } from "./shared.js";

export interface PruneCommandArgs {
  dirs?: string[];
  rebuild?: boolean;
}

export interface PruneRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
  runCommand?: CommandRunner;
}

export interface PruneCommandResult {
  removedStoreEntries: number;
  keptStoreEntries: number;
  reclaimedBytes: number;
  removedRepos: number;
  rebuiltStoreEntries?: number;
}

async function collectLiveManagedStoreState(
  live: Awaited<ReturnType<typeof scanLiveBundles>>,
): Promise<{
  liveStoreEntryKeys: Set<string>;
  liveManifestPaths: Set<string>;
  liveRepoKeys: Set<string>;
}> {
  const liveStoreEntryKeys = new Set<string>();
  const liveManifestPaths = new Set<string>();
  const liveRepoKeys = new Set<string>();

  for (const bundle of live.managedBundles) {
    for (const member of bundle.members) {
      const storeInfo = member.sourceSkillDir ? parseStoredSourceFromPath(member.sourceSkillDir) : undefined;
      if (!storeInfo) {
        continue;
      }

      liveStoreEntryKeys.add(storeInfo.cacheKey);

      const metadata = await readSourceMetadata(storeInfo.storedSourceDir);
      if (metadata?.version === 2) {
        liveManifestPaths.add(metadata.sourceManifestPath);
        if (metadata.sourceRepoKey) {
          liveRepoKeys.add(metadata.sourceRepoKey);
        }
      }
      if (metadata?.version === 3) {
        liveManifestPaths.add(metadata.sourceManifestPath);
        if (metadata.sourceRepoKey) {
          liveRepoKeys.add(metadata.sourceRepoKey);
        }
      }
    }
  }

  return { liveStoreEntryKeys, liveManifestPaths, liveRepoKeys };
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await lstat(pathValue);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function directorySize(pathValue: string): Promise<number> {
  const stats = await lstat(pathValue);

  if (!stats.isDirectory()) {
    return stats.size;
  }

  const entries = await readdir(pathValue, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const nextPath = join(pathValue, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(nextPath);
      continue;
    }

    const nextStat = await lstat(nextPath);
    total += nextStat.size;
  }

  return total;
}

export async function runPruneCommand(
  args: PruneCommandArgs = {},
  runtime: PruneRuntimeOptions = {},
): Promise<PruneCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const homeDir = runtime.homeDir ?? homedir();
  const env = runtime.env ?? process.env;
  const output = runtime.output ?? createOutput();

  if (args.rebuild) {
    return runRebuild({ cwd, homeDir, env, output, runCommand: runtime.runCommand });
  }

  const config = await loadConfig({ cwd, homeDir, env });
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const scanTargets = (
    await Promise.all(
      Object.entries(config.tools).map(async ([toolName, toolConfig]) => {
        const baseTargets = await resolveScanTargets({ tool: toolName, toolConfig, cwd, homeDir });
        const extraTargets = (args.dirs ?? []).map((dir) => ({
          tool: toolName,
          targetType: "dir" as const,
          targetRoot: resolvePath(dir, cwd, homeDir),
          entryPattern: toolConfig.entryPattern,
        }));

        return [...baseTargets, ...extraTargets];
      }),
    )
  ).flat();
  const live = await scanLiveBundles(scanTargets);
  const { liveStoreEntryKeys, liveManifestPaths, liveRepoKeys } = await collectLiveManagedStoreState(live);

  const storeEntriesDir = join(storeRootDir, "store");
  const manifestsDir = join(storeRootDir, "manifests");
  const sourcesDir = join(storeRootDir, "sources");
  const reposDir = join(storeRootDir, "repos");

  if (
    !(await pathExists(storeEntriesDir)) &&
    !(await pathExists(manifestsDir)) &&
    !(await pathExists(sourcesDir)) &&
    !(await pathExists(reposDir))
  ) {
    output.info("Prune summary: removed=0 kept=0 reclaimed=0B");
    return {
      removedStoreEntries: 0,
      keptStoreEntries: 0,
      reclaimedBytes: 0,
      removedRepos: 0,
    };
  }

  let removedStoreEntries = 0;
  let keptStoreEntries = 0;
  let reclaimedBytes = 0;
  let removedRepos = 0;

  if (await pathExists(storeEntriesDir)) {
    const entries = await readdir(storeEntriesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (liveStoreEntryKeys.has(entry.name)) {
        keptStoreEntries += 1;
        continue;
      }

      const entryPath = join(storeEntriesDir, entry.name);
      reclaimedBytes += await directorySize(entryPath);
      await rm(entryPath, { recursive: true, force: true });
      removedStoreEntries += 1;
    }
  }

  if (await pathExists(manifestsDir)) {
    const manifestEntries = await readdir(manifestsDir, { withFileTypes: true });

    for (const entry of manifestEntries) {
      if (!entry.isFile()) {
        continue;
      }

      const manifestPath = join(manifestsDir, entry.name);
      if (liveManifestPaths.has(manifestPath)) {
        continue;
      }

      reclaimedBytes += await directorySize(manifestPath);
      await rm(manifestPath, { force: true });
    }
  }

  if (await pathExists(sourcesDir)) {
    const sourceEntries = await readdir(sourcesDir, { withFileTypes: true });

    for (const entry of sourceEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourceEntryPath = join(sourcesDir, entry.name);
      reclaimedBytes += await directorySize(sourceEntryPath);
      await rm(sourceEntryPath, { recursive: true, force: true });
    }
  }

  if (await pathExists(reposDir)) {
    const repoEntries = await readdir(reposDir, { withFileTypes: true });

    for (const entry of repoEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (liveRepoKeys.has(entry.name)) {
        continue;
      }

      const repoEntryPath = join(reposDir, entry.name);
      reclaimedBytes += await directorySize(repoEntryPath);
      await rm(repoEntryPath, { recursive: true, force: true });
      removedRepos += 1;
    }
  }

  output.info(
    `Prune summary: removed=${removedStoreEntries} kept=${keptStoreEntries} reclaimed=${reclaimedBytes}B`,
  );

  return {
    removedStoreEntries,
    keptStoreEntries,
    reclaimedBytes,
    removedRepos,
  };
}

function isMissingLockfileError(error: unknown): boolean {
  if (!(error instanceof FilesystemError)) {
    return false;
  }
  const cause = error.cause;
  return Boolean(
    cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "ENOENT",
  );
}

async function normalizeSourceForReinstall(rawSource: string, cwd: string, homeDir: string): Promise<string> {
  const descriptor = await parseSource(rawSource, { cwd, homeDir });
  if (descriptor.kind === "local") {
    return descriptor.path;
  }
  if (descriptor.kind === "git" && descriptor.ref && !isCommitSha(descriptor.ref)) {
    return descriptor.url;
  }
  return rawSource;
}

async function runRebuild(options: {
  cwd: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  output: Output;
  runCommand?: CommandRunner;
}): Promise<PruneCommandResult> {
  const { cwd, homeDir, env, output, runCommand } = options;
  const config = await loadConfig({ cwd, homeDir, env });
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const projectRoot = await findProjectRoot(cwd);

  const lockfilePath = await resolveProjectSkillsLockfilePath(cwd);
  const lockfileRoot = dirname(lockfilePath);
  const lockfile = await loadSkillsLockfile(lockfilePath).catch((error) => {
    if (isMissingLockfileError(error)) {
      throw new SkillCliError(
        `Missing lockfile: ${lockfilePath}`,
        ExitCode.USER_INPUT,
        "Run 'skill lock' in this project, or install a source with --project first",
      );
    }
    throw error;
  });

  const normalizedEntries = await Promise.all(
    lockfile.skills.map(async (entry) => ({
      source: await normalizeSourceForReinstall(entry.source, lockfileRoot, homeDir),
      name: entry.name,
    })),
  );

  const sourceGroups = new Map<string, string[]>();
  const projectSourceCanonicals = new Set<string>();
  for (const entry of normalizedEntries) {
    const descriptor = await parseSource(entry.source, { cwd: lockfileRoot, homeDir });
    const identity = deriveBundleIdentityFromSourceDescriptor(descriptor);
    projectSourceCanonicals.add(identity.sourceCanonical);

    const names = sourceGroups.get(entry.source) ?? [];
    if (entry.name === "*") {
      sourceGroups.set(entry.source, ["*"]);
      continue;
    }
    if (!names.includes("*") && !names.includes(entry.name)) {
      names.push(entry.name);
      sourceGroups.set(entry.source, names);
    }
  }

  const projectScanTargets = Object.entries(config.tools).map(([toolName, toolConfig]) => ({
    tool: toolName,
    targetType: "project" as const,
    targetRoot: resolve(projectRoot, toolConfig.projectDir),
    entryPattern: toolConfig.entryPattern,
  }));
  const live = await scanLiveBundles(projectScanTargets);
  const rebuildBundles = live.managedBundles.filter(
    (bundle) =>
      bundle.targetType === "project" &&
      projectSourceCanonicals.has(bundle.sourceCanonical),
  );
  const projectTools = [
    ...new Set(
      [
        ...rebuildBundles.map((bundle) => bundle.tool),
        ...live.brokenEntries
          .filter(
            (entry) =>
              entry.targetType === "project" &&
              entry.sourceSkillDir !== undefined &&
              parseStoredSourceFromPath(entry.sourceSkillDir) !== undefined,
          )
          .map((entry) => entry.tool),
      ],
    ),
  ];

  if (projectTools.length === 0) {
    throw new SkillCliError(
      "No managed project installs found to rebuild",
      ExitCode.USER_INPUT,
      "Run 'skill install <source> --project' first",
    );
  }

  const rebuildStoreEntries = new Set(
    rebuildBundles.map((bundle) => bundle.storedSourceDir),
  );
  let rebuiltStoreEntries = 0;
  for (const entryPath of rebuildStoreEntries) {
    await rm(entryPath, { recursive: true, force: true });
    rebuiltStoreEntries += 1;
  }

  for (const tool of projectTools) {
    for (const [source, names] of sourceGroups) {
      await runInstallCommand(
        { source, tool, target: { type: "project" }, force: true, skills: names },
        { cwd, homeDir, env, output, runCommand },
      );
    }
  }

  await syncProjectLockfile(
    { tool: "all", mode: "manual", force: true },
    { cwd, homeDir, env, output },
  );

  output.info(
    `Rebuild summary: rebuilt=${rebuiltStoreEntries} tools=${projectTools.join(",")}`,
  );

  return {
    removedStoreEntries: 0,
    keptStoreEntries: 0,
    reclaimedBytes: 0,
    removedRepos: 0,
    rebuiltStoreEntries,
  };
}
