import { homedir } from "node:os";

import { loadConfig } from "../core/config/load.js";
import { groupScannedSkillsIntoBundles } from "../core/discovery/group-scanned-bundles.js";
import { scanInstalledSkills } from "../core/discovery/scan-installed.js";
import { createOutput, type Output } from "../core/output.js";
import { loadRegistry, upsertRegistryBundles } from "../core/registry/registry.js";

import { resolveScanTargets, resolveStoreRootDir, selectTools } from "./shared.js";

export interface RegisterCommandArgs {
  tool: string;
  dir?: string;
}

export interface RegisterRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface RegisterCommandResult {
  scannedMembers: number;
  addedBundles: number;
  touchedBundles: number;
}

function logicalBundleKey(bundle: {
  tool: string;
  targetType: string;
  targetRoot: string;
  sourceKind: string;
  sourceCanonical: string;
  bundleName: string;
}): string {
  return `${bundle.tool}::${bundle.targetType}::${bundle.targetRoot}::${bundle.sourceKind}::${bundle.sourceCanonical}::${bundle.bundleName}`;
}

export async function runRegisterCommand(
  args: RegisterCommandArgs,
  runtime: RegisterRuntimeOptions = {},
): Promise<RegisterCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const homeDir = runtime.homeDir ?? homedir();
  const env = runtime.env ?? process.env;
  const output = runtime.output ?? createOutput();

  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const beforeRegistry = await loadRegistry(storeRootDir);

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
          registryBundles: beforeRegistry.bundles,
        });
      }),
    )
  ).flat();

  const scanned = await scanInstalledSkills(scanTargets);
  const validScanned = scanned.filter((entry) => !entry.isBrokenSymlink);
  const grouped = await groupScannedSkillsIntoBundles(validScanned);
  const nowIso = new Date().toISOString();

  const existingLogicalKeys = new Set(beforeRegistry.bundles.map((bundle) => logicalBundleKey(bundle)));

  const entries = grouped.map((bundle) => {
    return {
      bundleId: bundle.bundleId,
      bundleName: bundle.bundleName,
      tool: bundle.tool,
      targetType: bundle.targetType,
      targetRoot: bundle.targetRoot,
      sourceRaw: bundle.sourceRaw,
      sourceKind: bundle.sourceKind,
      sourceCanonical: bundle.sourceCanonical,
      cacheKey: bundle.cacheKey,
      storedSourceDir: bundle.storedSourceDir,
      installedAt: nowIso,
      updatedAt: nowIso,
      members: bundle.members,
    };
  });

  await upsertRegistryBundles(storeRootDir, entries);

  const addedBundles = entries.filter(
    (bundle) => !existingLogicalKeys.has(logicalBundleKey(bundle)),
  ).length;

  output.info(`Scanned ${validScanned.length} installed skill member(s)`);
  output.info(`Registered ${entries.length} bundle entr${entries.length === 1 ? "y" : "ies"}`);
  output.info(`Added ${addedBundles} new bundle entr${addedBundles === 1 ? "y" : "ies"}`);

  return {
    scannedMembers: validScanned.length,
    addedBundles,
    touchedBundles: entries.length,
  };
}
