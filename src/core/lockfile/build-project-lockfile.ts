import { loadConfig } from "../config/load.js";
import { discoverSkills } from "../discovery/discover.js";
import { scanLiveBundles } from "../discovery/scan-live-bundles.js";
import type { InstalledSkillCandidate } from "../discovery/scan-installed.js";
import { ExitCode, SkillCliError } from "../errors.js";
import { resolveTargetRoot, selectTools } from "../../commands/shared.js";
import { resolveLockedSourceForBundle } from "./resolve-locked-source.js";

export interface BuildProjectLockfileArgs {
  cwd: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  tool: string;
}

export interface BuiltProjectLockfile {
  lockedSkills: Array<{ source: string; name: string }>;
  bundleCount: number;
  eligibleBundleCount: number;
  unresolvableBundleCount: number;
}

export interface ProjectLockedSkillGroup {
  source: string;
  allSkillNames: Set<string>;
  selectedSkillNames: Set<string>;
}

interface CollectedProjectLockedSkillGroups {
  lockedSkillGroups: Map<string, ProjectLockedSkillGroup>;
  eligibleBundleCount: number;
  unresolvableBundleCount: number;
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

export async function buildProjectLockfile(
  args: BuildProjectLockfileArgs,
): Promise<BuiltProjectLockfile> {
  const { lockedSkillGroups, eligibleBundleCount, unresolvableBundleCount } = await collectProjectLockedSkillGroups(args);

  const lockedSkills = Array.from(lockedSkillGroups.values())
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

  return {
    lockedSkills,
    bundleCount: lockedSkills.length,
    eligibleBundleCount,
    unresolvableBundleCount,
  };
}

export async function collectProjectLockedSkillGroups(
  args: BuildProjectLockfileArgs,
): Promise<CollectedProjectLockedSkillGroups> {
  const config = await loadConfig({ cwd: args.cwd, homeDir: args.homeDir, env: args.env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const scanTargets = (
    await Promise.all(
      selectedTools.map(async (toolName) => {
        const toolConfig = config.tools[toolName];
        if (!toolConfig) {
          return undefined;
        }

        return {
          tool: toolName,
          targetType: "project" as const,
          targetRoot: await resolveTargetRoot({
            target: { type: "project" },
            toolConfig,
            cwd: args.cwd,
            homeDir: args.homeDir,
          }),
          entryPattern: toolConfig.entryPattern,
        } satisfies InstalledSkillCandidate;
      }),
    )
  ).flatMap((target) => (target ? [target] : []));

  const { managedBundles } = await scanLiveBundles(scanTargets);
  const eligibleBundles = managedBundles.filter((bundle) => bundle.targetType === "project");
  const lockedSkillGroups = new Map<string, ProjectLockedSkillGroup>();
  let unresolvableBundleCount = 0;

  for (const bundle of eligibleBundles) {
    const toolConfig = config.tools[bundle.tool];
    if (!toolConfig) {
      continue;
    }

    if (bundle.sourceKind === "unknown") {
      unresolvableBundleCount += 1;
      continue;
    }

    const lockedSource = await resolveLockedSourceForBundle({ cwd: args.cwd, bundle });
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

  return {
    lockedSkillGroups,
    eligibleBundleCount: eligibleBundles.length,
    unresolvableBundleCount,
  };
}
