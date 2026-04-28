import { access } from "node:fs/promises";
import { homedir } from "node:os";

import type { InstalledSkillCandidate } from "../core/discovery/scan-installed.js";
import { loadConfig } from "../core/config/load.js";
import { discoverSkills } from "../core/discovery/discover.js";
import { scanLiveBundles } from "../core/discovery/scan-live-bundles.js";
import { createOutput, type Output } from "../core/output.js";
import { loadSkillsLockfile } from "../core/lockfile/load.js";
import { resolveProjectSkillsLockfilePath } from "../core/lockfile/path.js";
import { resolveLockedSourceForBundle } from "../core/lockfile/resolve-locked-source.js";

import { resolveScanTargets, resolveTargetRoot, selectTools } from "./shared.js";

export interface DoctorCommandArgs {
  tool: string;
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
  brokenCount: number;
  projectDriftCount: number;
}

interface ProjectDriftSummary {
  desiredOnlyCount: number;
  installedOnlyCount: number;
  conflictingSelectionCount: number;
  unresolvableBundleCount: number;
  totalCount: number;
}

interface ProjectInstalledSourceState {
  source: string;
  allSkillNames: Set<string>;
  selectedSkillNames: Set<string>;
  selectedSkillNamesByTool: Map<string, Set<string>>;
}

function countEntries(entries: Array<{ source: string; name: string }>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const key = `${entry.source}::${entry.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function subtractCounts(left: Map<string, number>, right: Map<string, number>): number {
  let count = 0;

  for (const [key, leftCount] of left.entries()) {
    count += Math.max(0, leftCount - (right.get(key) ?? 0));
  }

  return count;
}

async function fileExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

interface CollectedProjectInstalledSources {
  sourceStates: Map<string, ProjectInstalledSourceState>;
  unresolvableBundleCount: number;
}

async function countProjectLockfileDrift(options: {
  cwd: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  tool: string;
}): Promise<ProjectDriftSummary> {
  const lockfilePath = await resolveProjectSkillsLockfilePath(options.cwd);
  const { sourceStates: installedSources, unresolvableBundleCount } = await collectProjectInstalledSources(options);

  if (!(await fileExists(lockfilePath))) {
    return {
      desiredOnlyCount: 0,
      installedOnlyCount: 0,
      conflictingSelectionCount: 0,
      unresolvableBundleCount,
      totalCount: unresolvableBundleCount,
    };
  }

  const lockfile = await loadSkillsLockfile(lockfilePath);
  const desiredCounts = countEntries(
    lockfile.skills.flatMap((entry) => {
      if (entry.name !== "*") {
        return [entry];
      }

      const sourceState = installedSources.get(entry.source);
      return sourceState
        ? Array.from(sourceState.allSkillNames, (skillName) => ({ source: entry.source, name: skillName }))
        : [entry];
    }),
  );
  const installedCounts = countEntries(
    Array.from(installedSources.values()).flatMap((sourceState) =>
      Array.from(sourceState.selectedSkillNames, (skillName) => ({ source: sourceState.source, name: skillName })),
    ),
  );
  const desiredOnlyCount = subtractCounts(desiredCounts, installedCounts);
  const installedOnlyCount = subtractCounts(installedCounts, desiredCounts);
  const conflictingSelectionCount = Array.from(installedSources.values()).reduce(
    (count, sourceState) => count + countSelectionConflictEntries(sourceState.selectedSkillNamesByTool),
    0,
  );

  return {
    desiredOnlyCount,
    installedOnlyCount,
    conflictingSelectionCount,
    unresolvableBundleCount,
    totalCount: desiredOnlyCount + installedOnlyCount + conflictingSelectionCount + unresolvableBundleCount,
  };
}

async function collectProjectInstalledSources(options: {
  cwd: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  tool: string;
}): Promise<CollectedProjectInstalledSources> {
  const config = await loadConfig({ cwd: options.cwd, homeDir: options.homeDir, env: options.env });
  const selectedTools = selectTools(options.tool, Object.keys(config.tools));
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
            cwd: options.cwd,
            homeDir: options.homeDir,
          }),
          entryPattern: toolConfig.entryPattern,
        } satisfies InstalledSkillCandidate;
      }),
    )
  ).flatMap((target) => (target ? [target] : []));
  const { managedBundles } = await scanLiveBundles(scanTargets);
  const sourceStates = new Map<string, ProjectInstalledSourceState>();
  let unresolvableBundleCount = 0;

  for (const bundle of managedBundles.filter((candidate) => candidate.targetType === "project")) {
    const toolConfig = config.tools[bundle.tool];
    if (!toolConfig) {
      continue;
    }

    if (bundle.sourceKind === "unknown") {
      unresolvableBundleCount += 1;
      continue;
    }

    const source = await resolveLockedSourceForBundle({ cwd: options.cwd, bundle });
    const discoveredSkillNames = (
      await discoverSkills({
        sourceDir: bundle.storedSourceDir,
        entryPattern: toolConfig.entryPattern,
        nameStrategy: toolConfig.nameStrategy,
        rootSkillName: bundle.bundleName,
      })
    ).map((skill) => skill.skillName);
    const state =
      sourceStates.get(source) ??
      {
        source,
        allSkillNames: new Set<string>(),
        selectedSkillNames: new Set<string>(),
        selectedSkillNamesByTool: new Map<string, Set<string>>(),
      };

    for (const skillName of discoveredSkillNames) {
      state.allSkillNames.add(skillName);
    }

    const selectedForTool = state.selectedSkillNamesByTool.get(bundle.tool) ?? new Set<string>();
    for (const member of bundle.members) {
      state.selectedSkillNames.add(member.skillName);
      selectedForTool.add(member.skillName);
    }
    state.selectedSkillNamesByTool.set(bundle.tool, selectedForTool);
    sourceStates.set(source, state);
  }

  return {
    sourceStates,
    unresolvableBundleCount,
  };
}

function countSelectionConflictEntries(selectedSkillNamesByTool: Map<string, Set<string>>): number {
  const selectedSets = Array.from(selectedSkillNamesByTool.values());
  if (selectedSets.length <= 1) {
    return 0;
  }

  const union = new Set<string>();
  for (const selectedSet of selectedSets) {
    for (const skillName of selectedSet) {
      union.add(skillName);
    }
  }

  const intersection = new Set<string>(selectedSets[0]);
  for (const skillName of Array.from(intersection)) {
    if (selectedSets.some((selectedSet) => !selectedSet.has(skillName))) {
      intersection.delete(skillName);
    }
  }

  return union.size - intersection.size;
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
        });
      }),
    )
  ).flat();

  const live = await scanLiveBundles(scanTargets);
  const managedCount = live.managedBundles.length;
  const discoveredCount = live.discoveredBundles.length;
  const brokenCount = live.brokenEntries.length;
  const projectDrift = await countProjectLockfileDrift({ cwd, homeDir, env, tool: args.tool });

  output.info(
    `Doctor summary: managed=${managedCount} discovered=${discoveredCount} broken=${brokenCount} projectDrift=${projectDrift.totalCount}`,
  );

  if (discoveredCount > 0) {
    output.warn(`Detected ${discoveredCount} discovered live bundle${discoveredCount === 1 ? "" : "s"}`);
  }

  if (brokenCount > 0) {
    output.warn(`Detected ${brokenCount} broken symlink entr${brokenCount === 1 ? "y" : "ies"}`);
  }

  if (projectDrift.unresolvableBundleCount > 0) {
    output.warn(
      `Detected ${projectDrift.unresolvableBundleCount} managed project bundle provenance problem${projectDrift.unresolvableBundleCount === 1 ? "" : "s"}`,
    );
  }

  if (projectDrift.totalCount > 0) {
    output.warn(`Detected ${projectDrift.totalCount} project drift entr${projectDrift.totalCount === 1 ? "y" : "ies"}`);
    output.info(
      projectDrift.unresolvableBundleCount > 0
        ? projectDrift.installedOnlyCount === 0 && projectDrift.conflictingSelectionCount === 0
          ? "Run: skill install --project"
          : "Run: skill install --project or skill lock"
        : projectDrift.desiredOnlyCount > 0 &&
            projectDrift.installedOnlyCount === 0 &&
            projectDrift.conflictingSelectionCount === 0
        ? "Run: skill install --project"
        : projectDrift.installedOnlyCount > 0 &&
            projectDrift.desiredOnlyCount === 0 &&
            projectDrift.conflictingSelectionCount === 0
          ? "Run: skill lock"
          : "Run: skill install --project or skill lock",
    );
  }

  return {
    managedCount,
    discoveredCount,
    brokenCount,
    projectDriftCount: projectDrift.totalCount,
  };
}
