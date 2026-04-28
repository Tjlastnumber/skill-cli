import { lstat, rm } from "node:fs/promises";
import { homedir } from "node:os";

import { loadConfig, type LoadConfigOptions } from "../config/load.js";
import { discoverSkills } from "../discovery/discover.js";
import { groupScannedSkillsIntoBundles } from "../discovery/group-scanned-bundles.js";
import { scanInstalledSkills } from "../discovery/scan-installed.js";
import { ExitCode, SkillCliError } from "../errors.js";
import { createOutput, type Output } from "../output.js";
import { resolvePath } from "../path-utils.js";
import { loadRegistry, type RegistryBundleEntry } from "../registry/registry.js";
import { resolveStoreRootDir, resolveTargetRoot, selectTools } from "../../commands/shared.js";
import { resolveProjectSkillsLockfilePath } from "./path.js";
import { resolveLockedSourceForBundle } from "./resolve-locked-source.js";
import { writeSkillsLockfile } from "./write.js";

export interface SyncProjectLockfileArgs {
  tool: string;
  mode: "manual" | "auto";
  outputPath?: string;
  force: boolean;
}

export interface SyncProjectLockfileRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface SyncProjectLockfileResult {
  outputPath: string;
  bundleCount: number;
}

interface LockedSkillEntry {
  source: string;
  name: string;
}

interface EligibleProjectLockfileContext {
  config: Awaited<ReturnType<typeof loadConfig>>;
  eligibleBundles: RegistryBundleEntry[];
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

function ensureUniqueSkillNames(skillNames: string[], bundleName: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const skillName of skillNames) {
    if (seen.has(skillName)) {
      duplicates.add(skillName);
      continue;
    }

    seen.add(skillName);
  }

  if (duplicates.size > 0) {
    throw new SkillCliError(
      `Duplicate skill names discovered while locking bundle '${bundleName}': ${Array.from(duplicates).join(", ")}`,
      ExitCode.SOURCE,
      "Use unique skill directory names or remove the conflicting SKILL.md files",
    );
  }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

async function resolveEligibleBundles(
  args: SyncProjectLockfileArgs,
  runtime: Required<SyncProjectLockfileRuntimeOptions>,
): Promise<EligibleProjectLockfileContext> {
  const config = await loadConfig({
    cwd: runtime.cwd,
    homeDir: runtime.homeDir,
    env: runtime.env,
  } satisfies LoadConfigOptions);
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const storeRootDir = resolveStoreRootDir(config.storeDir, runtime.cwd, runtime.homeDir);
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
          cwd: runtime.cwd,
          homeDir: runtime.homeDir,
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

  return {
    config,
    eligibleBundles,
  };
}

export async function syncProjectLockfile(
  args: SyncProjectLockfileArgs,
  runtime: SyncProjectLockfileRuntimeOptions = {},
): Promise<SyncProjectLockfileResult> {
  const resolvedRuntime: Required<SyncProjectLockfileRuntimeOptions> = {
    cwd: runtime.cwd ?? process.cwd(),
    homeDir: runtime.homeDir ?? homedir(),
    env: runtime.env ?? process.env,
    output: runtime.output ?? createOutput(),
  };

  const outputPath =
    args.mode === "manual" && args.outputPath
      ? resolvePath(args.outputPath, resolvedRuntime.cwd, resolvedRuntime.homeDir)
      : await resolveProjectSkillsLockfilePath(resolvedRuntime.cwd);

  const { config, eligibleBundles } = await resolveEligibleBundles(args, resolvedRuntime);
  if (eligibleBundles.length === 0) {
    if (args.mode === "manual") {
      throw new SkillCliError(
        "No eligible managed project bundles found for lockfile generation",
        ExitCode.USER_INPUT,
      );
    }

    if (await pathExists(outputPath)) {
      await rm(outputPath, { force: true });
      resolvedRuntime.output.info(`Removed ${outputPath} because no eligible managed project bundles remain`);
    }

    return {
      outputPath,
      bundleCount: 0,
    };
  }

  if (args.mode === "manual" && !args.force && (await pathExists(outputPath))) {
    throw new SkillCliError(
      `Lockfile already exists: ${outputPath}`,
      ExitCode.USER_INPUT,
      "Re-run with --force to overwrite the existing lockfile",
    );
  }

  const lockedSkillGroups = new Map<
    string,
    {
      source: string;
      allSkillNames: Set<string>;
      selectedSkillNames: Set<string>;
    }
  >();

  for (const bundle of eligibleBundles) {
    const toolConfig = config.tools[bundle.tool];
    if (!toolConfig) {
      continue;
    }

    const lockedSource = await resolveLockedSourceForBundle({ cwd: resolvedRuntime.cwd, bundle });
    const discoveredSkillNames = (
      await discoverSkills({
        sourceDir: bundle.storedSourceDir,
        entryPattern: toolConfig.entryPattern,
        nameStrategy: toolConfig.nameStrategy,
        rootSkillName: bundle.bundleName,
      })
    ).map((skill) => skill.skillName);
    ensureUniqueSkillNames(discoveredSkillNames, bundle.bundleName);

    const bundleAllSkillNames = new Set(discoveredSkillNames);
    const bundleSelectedSkillNames = new Set(bundle.members.map((member) => member.skillName));

    const existingGroup = lockedSkillGroups.get(lockedSource);
    if (
      existingGroup &&
      (!setsEqual(existingGroup.allSkillNames, bundleAllSkillNames) ||
        !setsEqual(existingGroup.selectedSkillNames, bundleSelectedSkillNames))
    ) {
      throw new SkillCliError(
        `Cannot generate a shared lockfile for source '${lockedSource}': conflicting skill selections across tools`,
        ExitCode.USER_INPUT,
        "Run 'skill lock --tool <tool>' for one tool at a time, or align the installed skill names across tools",
      );
    }

    const group =
      existingGroup ??
      {
        source: lockedSource,
        allSkillNames: new Set<string>(),
        selectedSkillNames: new Set<string>(),
      };

    for (const skillName of bundleAllSkillNames) {
      group.allSkillNames.add(skillName);
    }

    for (const skillName of bundleSelectedSkillNames) {
      group.selectedSkillNames.add(skillName);
    }

    lockedSkillGroups.set(lockedSource, group);
  }

  const lockedSkills: LockedSkillEntry[] = Array.from(lockedSkillGroups.values())
    .flatMap((group) => {
      const allSkillNames = Array.from(group.allSkillNames).sort((left, right) => left.localeCompare(right));
      const selectedSkillNames = Array.from(group.selectedSkillNames).sort((left, right) =>
        left.localeCompare(right),
      );

      if (
        selectedSkillNames.length === allSkillNames.length &&
        selectedSkillNames.every((skillName, index) => skillName === allSkillNames[index])
      ) {
        return [{ source: group.source, name: "*" }];
      }

      return selectedSkillNames.map((skillName) => ({
        source: group.source,
        name: skillName,
      }));
    })
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        (left.name === "*" ? -1 : right.name === "*" ? 1 : left.name.localeCompare(right.name)),
    );

  await writeSkillsLockfile(outputPath, {
    version: 2,
    skills: lockedSkills,
  });

  resolvedRuntime.output.info(
    `Wrote ${lockedSkills.length} locked skill entr${lockedSkills.length === 1 ? "y" : "ies"} to ${outputPath}`,
  );

  return {
    outputPath,
    bundleCount: lockedSkills.length,
  };
}
