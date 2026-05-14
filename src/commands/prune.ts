import { lstat, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../core/config/load.js";
import { scanLiveBundles } from "../core/discovery/scan-live-bundles.js";
import { createOutput, type Output } from "../core/output.js";
import { resolvePath } from "../core/path-utils.js";
import { parseStoredSourceFromPath } from "../core/store/store-path.js";
import { readSourceMetadata } from "../core/store/source-metadata.js";

import { resolveScanTargets, resolveStoreRootDir } from "./shared.js";

export interface PruneCommandArgs {
  dirs?: string[];
}

export interface PruneRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface PruneCommandResult {
  removedStoreEntries: number;
  keptStoreEntries: number;
  reclaimedBytes: number;
}

async function collectLiveManagedStoreState(
  live: Awaited<ReturnType<typeof scanLiveBundles>>,
): Promise<{ liveStoreEntryKeys: Set<string>; liveManifestPaths: Set<string> }> {
  const liveStoreEntryKeys = new Set<string>();
  const liveManifestPaths = new Set<string>();

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
      }
    }
  }

  return { liveStoreEntryKeys, liveManifestPaths };
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
  const { liveStoreEntryKeys, liveManifestPaths } = await collectLiveManagedStoreState(live);

  const storeEntriesDir = join(storeRootDir, "store");
  const manifestsDir = join(storeRootDir, "manifests");
  const sourcesDir = join(storeRootDir, "sources");

  if (!(await pathExists(storeEntriesDir)) && !(await pathExists(manifestsDir)) && !(await pathExists(sourcesDir))) {
    output.info("Prune summary: removed=0 kept=0 reclaimed=0B");
    return {
      removedStoreEntries: 0,
      keptStoreEntries: 0,
      reclaimedBytes: 0,
    };
  }

  let removedStoreEntries = 0;
  let keptStoreEntries = 0;
  let reclaimedBytes = 0;

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

  output.info(
    `Prune summary: removed=${removedStoreEntries} kept=${keptStoreEntries} reclaimed=${reclaimedBytes}B`,
  );

  return {
    removedStoreEntries,
    keptStoreEntries,
    reclaimedBytes,
  };
}
