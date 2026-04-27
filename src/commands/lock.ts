import { lstat } from "node:fs/promises";
import { homedir } from "node:os";

import { loadConfig } from "../core/config/load.js";
import { discoverSkills } from "../core/discovery/discover.js";
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

interface LockedSkillEntry {
  source: string;
  name: string;
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

    const lockedSource = await resolveLockedSourceForBundle({ cwd, bundle });
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

  output.info(`Wrote ${lockedSkills.length} locked skill entr${lockedSkills.length === 1 ? "y" : "ies"} to ${outputPath}`);

  return {
    outputPath,
    bundleCount: lockedSkills.length,
  };
}
