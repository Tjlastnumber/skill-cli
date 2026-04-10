import { homedir } from "node:os";

import { loadConfig } from "../core/config/load.js";
import { groupScannedSkillsIntoBundles } from "../core/discovery/group-scanned-bundles.js";
import { scanInstalledSkills } from "../core/discovery/scan-installed.js";
import { createOutput, type Output } from "../core/output.js";
import { loadRegistry, removeRegistryBundles } from "../core/registry/registry.js";

import { runRegisterCommand } from "./register.js";
import { resolveScanTargets, resolveStoreRootDir, selectTools } from "./shared.js";

export interface DoctorCommandArgs {
  tool: string;
  repairRegistry: boolean;
  dir?: string;
}

export interface DoctorRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface DoctorCommandResult {
  managedCount: number;
  discoveredCount: number;
  staleCount: number;
  brokenCount: number;
  repairedCount: number;
}

export async function runDoctorCommand(
  args: DoctorCommandArgs,
  runtime: DoctorRuntimeOptions = {},
): Promise<DoctorCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const homeDir = runtime.homeDir ?? homedir();
  const env = runtime.env ?? process.env;
  const output = runtime.output ?? createOutput();

  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const registry = await loadRegistry(storeRootDir);

  const managedEntries = registry.bundles.filter((entry) => selectedTools.includes(entry.tool));

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
          registryBundles: managedEntries,
        });
      }),
    )
  ).flat();

  const scannedEntries = await scanInstalledSkills(scanTargets);
  const validScannedEntries = scannedEntries.filter((entry) => !entry.isBrokenSymlink);
  const discoveredBundles = await groupScannedSkillsIntoBundles(validScannedEntries);
  const brokenLinkPaths = new Set(
    scannedEntries.filter((entry) => entry.isBrokenSymlink).map((entry) => entry.linkPath),
  );

  const managedKeys = new Set(
    managedEntries.map(
      (entry) => `${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.bundleId}`,
    ),
  );
  const observedBundleKeysByLinkPath = new Map<string, string>();
  for (const bundle of discoveredBundles) {
    const bundleKey = `${bundle.tool}::${bundle.targetType}::${bundle.targetRoot}::${bundle.bundleId}`;
    for (const member of bundle.members) {
      observedBundleKeysByLinkPath.set(member.linkPath, bundleKey);
    }
  }

  const discoveredCount = discoveredBundles.filter(
    (entry) => !managedKeys.has(`${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.bundleId}`),
  ).length;
  const staleCount = managedEntries.reduce((count, entry) => {
    const expectedBundleKey = `${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.bundleId}`;

    return (
      count +
      entry.members.filter((member) => observedBundleKeysByLinkPath.get(member.linkPath) !== expectedBundleKey)
        .length
    );
  }, 0);
  const brokenCount = brokenLinkPaths.size;
  const registerSuggestion = args.dir
    ? `skill register --tool ${args.tool} --dir ${args.dir}`
    : `skill register --tool ${args.tool}`;
  const fullyStaleBundleKeys = new Set(
    managedEntries
      .filter((entry) => {
        const expectedBundleKey = `${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.bundleId}`;
        return entry.members.every(
          (member) => observedBundleKeysByLinkPath.get(member.linkPath) !== expectedBundleKey,
        );
      })
      .map((entry) => `${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.bundleId}`),
  );

  let repairedCount = 0;
  if (args.repairRegistry) {
    const repaired = await runRegisterCommand(
      { tool: args.tool, dir: args.dir },
      { cwd, homeDir, env, output },
    );
    const removed = await removeRegistryBundles(storeRootDir, (entry) => {
      return fullyStaleBundleKeys.has(`${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.bundleId}`);
    });
    repairedCount = repaired.addedBundles + removed.removedCount;
  }

  output.info(
    `Doctor summary: managed=${managedEntries.length} discovered=${discoveredCount} stale=${staleCount} broken=${brokenCount}`,
  );

  if (discoveredCount > 0 && !args.repairRegistry) {
    output.warn(`Detected ${discoveredCount} discovered skill(s) not in registry`);
    output.info(`Run: ${registerSuggestion}`);
  }

  if (staleCount > 0) {
    output.warn(`Detected ${staleCount} stale registry entr${staleCount === 1 ? "y" : "ies"}`);
  }

  if (brokenCount > 0) {
    output.warn(`Detected ${brokenCount} broken symlink entr${brokenCount === 1 ? "y" : "ies"}`);
  }

  return {
    managedCount: managedEntries.length,
    discoveredCount,
    staleCount,
    brokenCount,
    repairedCount,
  };
}
