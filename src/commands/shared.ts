import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { InstalledSkillCandidate } from "../core/discovery/scan-installed.js";
import type { RegistryBundleEntry } from "../core/registry/registry.js";
import type { ToolConfig } from "../core/config/schema.js";
import { ExitCode, SkillCliError } from "../core/errors.js";
import { resolvePath } from "../core/path-utils.js";
import { findProjectRoot } from "../core/project-root.js";

import type { InstallTarget } from "./types.js";

export function selectTools(toolArg: string, configuredTools: string[]): string[] {
  if (toolArg === "all") {
    return configuredTools;
  }

  if (configuredTools.includes(toolArg)) {
    return [toolArg];
  }

  throw new SkillCliError(
    `Unknown tool: ${toolArg}`,
    ExitCode.USER_INPUT,
    `Available tools: ${configuredTools.join(", ")}`,
  );
}

export async function resolveTargetRoot(options: {
  target: InstallTarget;
  toolConfig: ToolConfig;
  cwd: string;
  homeDir?: string;
}): Promise<string> {
  const { target, toolConfig, cwd, homeDir = homedir() } = options;

  if (target.type === "global") {
    return resolvePath(toolConfig.globalDir, cwd, homeDir);
  }

  if (target.type === "project") {
    const projectRoot = await findProjectRoot(cwd);
    return resolve(projectRoot, toolConfig.projectDir);
  }

  if (!target.dir) {
    throw new SkillCliError(
      "Custom directory target requires --dir <path>",
      ExitCode.USER_INPUT,
    );
  }

  return resolvePath(target.dir, cwd, homeDir);
}

export function resolveStoreRootDir(configStoreDir: string, cwd: string, homeDir: string): string {
  return resolvePath(configStoreDir, cwd, homeDir);
}

export function resolveLinkPath(targetRoot: string, skillName: string): string {
  return join(targetRoot, skillName);
}

export async function resolveDefaultScanTargets(options: {
  tool: string;
  toolConfig: ToolConfig;
  cwd: string;
  homeDir?: string;
}): Promise<InstalledSkillCandidate[]> {
  const { tool, toolConfig, cwd, homeDir = homedir() } = options;

  const globalRoot = resolvePath(toolConfig.globalDir, cwd, homeDir);
  const projectRoot = await findProjectRoot(cwd);
  const projectTarget = resolve(projectRoot, toolConfig.projectDir);

  const dedup = new Set<string>();
  const output: InstalledSkillCandidate[] = [];

  if (!dedup.has(globalRoot)) {
    dedup.add(globalRoot);
    output.push({
      tool,
      targetType: "global",
      targetRoot: globalRoot,
      entryPattern: toolConfig.entryPattern,
    });
  }

  if (!dedup.has(projectTarget)) {
    dedup.add(projectTarget);
    output.push({
      tool,
      targetType: "project",
      targetRoot: projectTarget,
      entryPattern: toolConfig.entryPattern,
    });
  }

  return output;
}

export async function resolveScanTargets(options: {
  tool: string;
  toolConfig: ToolConfig;
  cwd: string;
  homeDir?: string;
  dir?: string;
  registryBundles?: RegistryBundleEntry[];
}): Promise<InstalledSkillCandidate[]> {
  const { tool, toolConfig, cwd, homeDir = homedir(), dir, registryBundles = [] } = options;
  const dedup = new Set<string>();
  const targets: InstalledSkillCandidate[] = [];

  const addTarget = async (target: InstalledSkillCandidate): Promise<void> => {
    const physicalPath = await realpath(target.targetRoot).catch(() => target.targetRoot);
    const key = `${target.tool}::${physicalPath}`;

    if (dedup.has(key)) {
      return;
    }

    dedup.add(key);
    targets.push(target);
  };

  for (const target of await resolveDefaultScanTargets({ tool, toolConfig, cwd, homeDir })) {
    await addTarget(target);
  }

  for (const bundle of registryBundles) {
    if (bundle.tool !== tool || bundle.targetType !== "dir") {
      continue;
    }

    await addTarget({
      tool,
      targetType: "dir",
      targetRoot: bundle.targetRoot,
      entryPattern: toolConfig.entryPattern,
    });
  }

  if (dir) {
    const targetRoot = resolvePath(dir, cwd, homeDir);
    await addTarget({
      tool,
      targetType: "dir",
      targetRoot,
      entryPattern: toolConfig.entryPattern,
    });
  }

  return targets;
}
