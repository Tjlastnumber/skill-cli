import { rm } from "node:fs/promises";
import { homedir } from "node:os";

import { loadConfig } from "../core/config/load.js";
import { scanLiveBundles } from "../core/discovery/scan-live-bundles.js";
import { ExitCode, SkillCliError } from "../core/errors.js";
import { createOutput, type Output } from "../core/output.js";

import type { RemoveSkillCandidate } from "./remove-inputs.js";
import type { InstallTarget } from "./types.js";
import { resolveLinkPath, resolveTargetRoot, selectTools } from "./shared.js";

export interface RemoveCommandArgs {
  bundleName?: string;
  skillName?: string;
  selectedSkill?: RemoveSkillCandidate;
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

    const live = await scanLiveBundles([
      {
        tool: toolName,
        targetType: args.target.type,
        targetRoot,
        entryPattern: toolConfig.entryPattern,
      },
      ]);

    if (args.bundleName) {
      const matchedBundles = live.managedBundles.filter(
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

      continue;
    }

    if (!args.skillName) {
      throw new SkillCliError(
        "Exactly one of bundle-name or --skill must be provided",
        ExitCode.USER_INPUT,
      );
    }

    const selectedSkill = args.selectedSkill;
    const matchingMembers = live.managedBundles.flatMap((bundle) => {
      if (
        bundle.tool !== toolName ||
        bundle.targetRoot !== targetRoot ||
        bundle.targetType !== args.target.type
      ) {
        return [];
      }

      return bundle.members.filter((member) => {
        if (member.skillName !== args.skillName) {
          return false;
        }

        if (!selectedSkill) {
          return true;
        }

        return (
          selectedSkill.tool === toolName &&
          selectedSkill.targetRoot === targetRoot &&
          selectedSkill.bundleName === bundle.bundleName &&
          selectedSkill.linkPath === member.linkPath
        );
      });
    });

    for (const member of matchingMembers) {
      const linkPath = member.linkPath || resolveLinkPath(targetRoot, member.skillName);
      await rm(linkPath, { recursive: true, force: true });
      removedLinkPaths.push(linkPath);
    }
  }

  output.info(
    `Removed ${removedBundleKeys.size} bundle(s), ${removedLinkPaths.length} link target(s), 0 registry entries`,
  );

  return {
    removedBundles: removedBundleKeys.size,
    removedLinkPaths,
    removedRegistryEntries: 0,
  };
}
