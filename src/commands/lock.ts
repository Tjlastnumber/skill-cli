import { lstat } from "node:fs/promises";
import { homedir } from "node:os";

import { loadConfig } from "../core/config/load.js";
import { groupScannedSkillsIntoBundles } from "../core/discovery/group-scanned-bundles.js";
import { scanInstalledSkills } from "../core/discovery/scan-installed.js";
import { ExitCode, SkillCliError } from "../core/errors.js";
import { resolveProjectSkillsLockfilePath } from "../core/lockfile/path.js";
import { resolveLockedSourceForBundle } from "../core/lockfile/resolve-locked-source.js";
import { writeSkillsLockfile } from "../core/lockfile/write.js";
import { createOutput, type Output } from "../core/output.js";
import { loadRegistry } from "../core/registry/registry.js";
import { resolvePath } from "../core/path-utils.js";

import { resolveStoreRootDir, resolveTargetRoot, selectTools } from "./shared.js";

export interface LockCommandArgs {
  tool: string;
  output?: string;
  force: boolean;
}

export interface LockRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface LockCommandResult {
  outputPath: string;
  bundleCount: number;
}

function memberKey(member: { skillName: string; linkPath: string }): string {
  return `${member.skillName}::${member.linkPath}`;
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

export async function runLockCommand(
  args: LockCommandArgs,
  runtime: LockRuntimeOptions = {},
): Promise<LockCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const homeDir = runtime.homeDir ?? homedir();
  const env = runtime.env ?? process.env;
  const output = runtime.output ?? createOutput();

  const outputPath = args.output
    ? resolvePath(args.output, cwd, homeDir)
    : await resolveProjectSkillsLockfilePath(cwd);

  if (!args.force && (await pathExists(outputPath))) {
    throw new SkillCliError(
      `Lockfile already exists: ${outputPath}`,
      ExitCode.USER_INPUT,
      "Re-run with --force to overwrite the existing lockfile",
    );
  }

  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const registry = await loadRegistry(storeRootDir);

  const projectTargets = await Promise.all(
    selectedTools.map(async (toolName) => {
      const toolConfig = config.tools[toolName];
      if (!toolConfig) {
        return undefined;
      }

      return {
        tool: toolName,
        targetRoot: await resolveTargetRoot({
          target: { type: "project" },
          toolConfig,
          cwd,
          homeDir,
        }),
        entryPattern: toolConfig.entryPattern,
      };
    }),
  );

  const scanTargets = projectTargets.flatMap((target) =>
    target
      ? [
          {
            tool: target.tool,
            targetType: "project" as const,
            targetRoot: target.targetRoot,
            entryPattern: target.entryPattern,
          },
        ]
      : [],
  );

  const scannedEntries = await scanInstalledSkills(scanTargets);
  const scannedBundles = await groupScannedSkillsIntoBundles(
    scannedEntries.filter((entry) => !entry.isBrokenSymlink),
  );
  const scannedBundlesByKey = new Map(
    scannedBundles.map((bundle) => [`${bundle.tool}::${bundle.targetRoot}::${bundle.bundleId}`, bundle]),
  );
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
    throw new SkillCliError(
      "No eligible managed project bundles found for lockfile generation",
      ExitCode.USER_INPUT,
    );
  }

  const lockedSources = Array.from(
    new Set(
      await Promise.all(
        eligibleBundles.map(async (bundle) => {
          return await resolveLockedSourceForBundle({ cwd, bundle });
        }),
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));

  await writeSkillsLockfile(outputPath, {
    version: 1,
    bundles: lockedSources.map((source) => ({ source })),
  });

  output.info(`Wrote ${lockedSources.length} locked bundle source(s) to ${outputPath}`);

  return {
    outputPath,
    bundleCount: lockedSources.length,
  };
}
