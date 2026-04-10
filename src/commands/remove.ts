import { rm } from "node:fs/promises";
import { homedir } from "node:os";

import { loadConfig } from "../core/config/load.js";
import { createOutput, type Output } from "../core/output.js";
import { loadRegistry, removeRegistryBundles } from "../core/registry/registry.js";

import type { InstallTarget } from "./types.js";
import { resolveLinkPath, resolveStoreRootDir, resolveTargetRoot, selectTools } from "./shared.js";

export interface RemoveCommandArgs {
  bundleName: string;
  tool: string;
  target: InstallTarget;
}

export interface RemoveRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface RemoveCommandResult {
  removedBundles: number;
  removedLinkPaths: string[];
  removedRegistryEntries: number;
}

export async function runRemoveCommand(
  args: RemoveCommandArgs,
  runtime: RemoveRuntimeOptions = {},
): Promise<RemoveCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const homeDir = runtime.homeDir ?? homedir();
  const env = runtime.env ?? process.env;
  const output = runtime.output ?? createOutput();

  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const registry = await loadRegistry(storeRootDir);

  const removedLinkPaths: string[] = [];
  const removedBundleKeys = new Set<string>();

  for (const toolName of selectedTools) {
    const toolConfig = config.tools[toolName];
    if (!toolConfig) {
      output.warn(`Skipping unknown tool config: ${toolName}`);
      continue;
    }

    const targetRoot = await resolveTargetRoot({
      target: args.target,
      toolConfig,
      cwd,
      homeDir,
    });

    const matchedBundles = registry.bundles.filter(
      (bundle) =>
        bundle.tool === toolName &&
        bundle.targetRoot === targetRoot &&
        bundle.targetType === args.target.type &&
        bundle.bundleName === args.bundleName,
    );

    for (const bundle of matchedBundles) {
      removedBundleKeys.add(`${bundle.tool}::${bundle.targetRoot}::${bundle.bundleId}`);

      for (const member of bundle.members) {
        const linkPath = member.linkPath || resolveLinkPath(targetRoot, member.skillName);
        await rm(linkPath, { recursive: true, force: true });
        removedLinkPaths.push(linkPath);
      }
    }
  }

  const removedFromRegistry = await removeRegistryBundles(
    storeRootDir,
    (entry) => removedBundleKeys.has(`${entry.tool}::${entry.targetRoot}::${entry.bundleId}`),
  );

  output.info(
    `Removed ${removedBundleKeys.size} bundle(s), ${removedLinkPaths.length} link target(s), ${removedFromRegistry.removedCount} registry entr${
      removedFromRegistry.removedCount === 1 ? "y" : "ies"
    }`,
  );

  return {
    removedBundles: removedBundleKeys.size,
    removedLinkPaths,
    removedRegistryEntries: removedFromRegistry.removedCount,
  };
}
