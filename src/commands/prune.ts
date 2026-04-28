import { lstat, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../core/config/load.js";
import { scanLiveBundles } from "../core/discovery/scan-live-bundles.js";
import { createOutput, type Output } from "../core/output.js";
import { resolvePath } from "../core/path-utils.js";

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
  const liveCacheKeys = new Set(
    live.managedBundles.map((bundle) => bundle.cacheKey).filter((cacheKey) => cacheKey !== "unknown"),
  );

  const storeEntriesDir = join(storeRootDir, "store");
  if (!(await pathExists(storeEntriesDir))) {
    output.info("Prune summary: removed=0 kept=0 reclaimed=0B");
    return {
      removedStoreEntries: 0,
      keptStoreEntries: 0,
      reclaimedBytes: 0,
    };
  }

  const entries = await readdir(storeEntriesDir, { withFileTypes: true });

  let removedStoreEntries = 0;
  let keptStoreEntries = 0;
  let reclaimedBytes = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (liveCacheKeys.has(entry.name)) {
      keptStoreEntries += 1;
      continue;
    }

    const entryPath = join(storeEntriesDir, entry.name);
    reclaimedBytes += await directorySize(entryPath);
    await rm(entryPath, { recursive: true, force: true });
    removedStoreEntries += 1;
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
