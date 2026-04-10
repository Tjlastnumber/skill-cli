import { lstat, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { deriveBundleIdentityFromSourceDescriptor } from "../core/bundle/identity.js";
import { loadConfig } from "../core/config/load.js";
import { discoverSkills } from "../core/discovery/discover.js";
import { ExitCode, FilesystemError, SkillCliError, SourceError } from "../core/errors.js";
import { isSameSkillDirectoryLink, linkSkillDirectory } from "../core/linker/link-skill.js";
import { createOutput, type Output } from "../core/output.js";
import { loadRegistry, upsertRegistryBundles } from "../core/registry/registry.js";
import { fetchSource, type CommandRunner } from "../core/source/fetch.js";
import { parseSource } from "../core/source/parse.js";
import { persistSourceInStore } from "../core/store/persist-source.js";
import { writeSourceMetadata } from "../core/store/source-metadata.js";

import type { InstallTarget } from "./types.js";
import {
  resolveLinkPath,
  resolveStoreRootDir,
  resolveTargetRoot,
  selectTools,
} from "./shared.js";

export interface InstallCommandArgs {
  source: string;
  tool: string;
  target: InstallTarget;
  force: boolean;
}

export interface InstallRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
  runCommand?: CommandRunner;
}

export interface InstallCommandResult {
  storedSourceDir: string;
  installedByTool: Record<string, string[]>;
}

function createBundleId(parts: { sourceKind: string; sourceCanonical: string; cacheKey: string }): string {
  return createHash("sha256")
    .update(`${parts.sourceKind}::${parts.sourceCanonical}::${parts.cacheKey}`)
    .digest("hex");
}

function ensureUniqueSkillNames(skillNames: string[], toolName: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const name of skillNames) {
    if (seen.has(name)) {
      duplicates.add(name);
      continue;
    }
    seen.add(name);
  }

  if (duplicates.size > 0) {
    throw new SourceError(
      `Duplicate skill names discovered for tool '${toolName}': ${Array.from(duplicates).join(", ")}`,
      "Use unique parent directory names for SKILL.md files",
    );
  }
}

function createToolFailureMessage(toolName: string, error: unknown): string {
  if (error instanceof Error) {
    return `${toolName}: ${error.message}`;
  }
  return `${toolName}: Unknown error`;
}

function logicalBundleKey(parts: {
  tool: string;
  targetType: InstallTarget["type"];
  targetRoot: string;
  sourceKind: string;
  sourceCanonical: string;
  bundleName: string;
}): string {
  return `${parts.tool}::${parts.targetType}::${parts.targetRoot}::${parts.sourceKind}::${parts.sourceCanonical}::${parts.bundleName}`;
}

function resolveManagedSourceCandidates(options: {
  storedSourceDir: string;
  member: { skillName: string; sourceSkillDir?: string };
}): string[] {
  const candidates: string[] = [];

  if (options.member.sourceSkillDir) {
    candidates.push(options.member.sourceSkillDir);
  }

  if (options.storedSourceDir && options.storedSourceDir !== "unknown") {
    candidates.push(join(options.storedSourceDir, options.member.skillName));
    candidates.push(join(options.storedSourceDir, "skills", options.member.skillName));
  }

  return Array.from(new Set(candidates));
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

function createBackupPath(linkPath: string): string {
  return `${linkPath}.skill-cli-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface LinkMutation {
  linkPath: string;
  backupPath?: string;
  created: boolean;
}

async function replaceManagedLink(options: {
  sourceSkillDir: string;
  targetLinkPath: string;
  force: boolean;
}): Promise<LinkMutation | undefined> {
  const { sourceSkillDir, targetLinkPath, force } = options;
  const exists = await pathExists(targetLinkPath);

  if (exists && (await isSameSkillDirectoryLink(targetLinkPath, sourceSkillDir))) {
    return undefined;
  }

  if (!exists) {
    await linkSkillDirectory({
      sourceSkillDir,
      targetLinkPath,
      force: false,
    });
    return { linkPath: targetLinkPath, created: true };
  }

  if (!force) {
    await linkSkillDirectory({
      sourceSkillDir,
      targetLinkPath,
      force,
    });
    return undefined;
  }

  const backupPath = createBackupPath(targetLinkPath);
  await rename(targetLinkPath, backupPath);

  try {
    await linkSkillDirectory({
      sourceSkillDir,
      targetLinkPath,
      force: false,
    });
    return {
      linkPath: targetLinkPath,
      backupPath,
      created: false,
    };
  } catch (error) {
    if (await pathExists(targetLinkPath)) {
      await rm(targetLinkPath, { recursive: true, force: true });
    }
    await rename(backupPath, targetLinkPath);
    throw error;
  }
}

async function removeManagedLink(options: {
  targetLinkPath: string;
  force: boolean;
  sourceCandidates: string[];
}): Promise<LinkMutation | undefined> {
  const { targetLinkPath, force, sourceCandidates } = options;

  if (!(await pathExists(targetLinkPath))) {
    return undefined;
  }

  let canRemove = force;
  if (!canRemove) {
    for (const candidate of sourceCandidates) {
      if (await isSameSkillDirectoryLink(targetLinkPath, candidate)) {
        canRemove = true;
        break;
      }
    }
  }

  if (!canRemove) {
    throw new FilesystemError(
      `Target already exists: ${targetLinkPath}`,
      "Re-run with --force to replace existing targets",
    );
  }

  const backupPath = createBackupPath(targetLinkPath);
  await rename(targetLinkPath, backupPath);

  return {
    linkPath: targetLinkPath,
    backupPath,
    created: false,
  };
}

async function rollbackLinkMutations(mutations: LinkMutation[]): Promise<void> {
  for (const mutation of mutations.slice().reverse()) {
    if (await pathExists(mutation.linkPath)) {
      await rm(mutation.linkPath, { recursive: true, force: true });
    }

    if (mutation.backupPath && (await pathExists(mutation.backupPath))) {
      await rename(mutation.backupPath, mutation.linkPath);
    }
  }
}

async function cleanupLinkMutations(mutations: LinkMutation[]): Promise<void> {
  for (const mutation of mutations) {
    if (mutation.backupPath && (await pathExists(mutation.backupPath))) {
      await rm(mutation.backupPath, { recursive: true, force: true });
    }
  }
}


export async function runInstallCommand(
  args: InstallCommandArgs,
  runtime: InstallRuntimeOptions = {},
): Promise<InstallCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const homeDir = runtime.homeDir ?? homedir();
  const env = runtime.env ?? process.env;
  const output = runtime.output ?? createOutput();

  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));

  const sourceDescriptor = await parseSource(args.source, {
    cwd,
    homeDir,
  });
  const bundleIdentity = deriveBundleIdentityFromSourceDescriptor(sourceDescriptor);

  const tempRoot = await mkdtemp(join(tmpdir(), "skill-cli-install-"));

  try {
    const fetched = await fetchSource(sourceDescriptor, {
      tempDir: tempRoot,
      runCommand: runtime.runCommand,
    });

    const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
    const registry = await loadRegistry(storeRootDir);
    const persisted = await persistSourceInStore({
      sourceDir: fetched.sourceDir,
      storeRootDir,
      cacheKey: fetched.cacheKey,
    });

    await writeSourceMetadata(persisted.storedSourceDir, {
      version: 1,
      bundleName: bundleIdentity.bundleName,
      sourceKind: bundleIdentity.sourceKind,
      sourceRaw: bundleIdentity.sourceRaw,
      sourceCanonical: bundleIdentity.sourceCanonical,
      cacheKey: fetched.cacheKey,
    });

    const installedByTool: Record<string, string[]> = {};
    const failures: string[] = [];
    const nowIso = new Date().toISOString();
    const registryEntries: Parameters<typeof upsertRegistryBundles>[1] = [];

    for (const toolName of selectedTools) {
      const toolConfig = config.tools[toolName];
      if (!toolConfig) {
        failures.push(`${toolName}: missing tool config`);
        continue;
      }

      try {
        const targetRoot = await resolveTargetRoot({
          target: args.target,
          toolConfig,
          cwd,
          homeDir,
        });

        const discoveredSkills = await discoverSkills({
          sourceDir: persisted.storedSourceDir,
          entryPattern: toolConfig.entryPattern,
          nameStrategy: toolConfig.nameStrategy,
        });

        if (discoveredSkills.length === 0) {
          throw new SourceError(
            `No skills found for tool '${toolName}' using pattern '${toolConfig.entryPattern}'`,
          );
        }

        const skillNames = discoveredSkills.map((skill) => skill.skillName);
        ensureUniqueSkillNames(skillNames, toolName);

        installedByTool[toolName] = [];
        const members: Array<{ skillName: string; linkPath: string; sourceSkillDir: string }> = [];
        const currentBundleKey = logicalBundleKey({
          tool: toolName,
          targetType: args.target.type,
          targetRoot,
          sourceKind: bundleIdentity.sourceKind,
          sourceCanonical: bundleIdentity.sourceCanonical,
          bundleName: bundleIdentity.bundleName,
        });
        const existingManagedBundle = registry.bundles.find((entry) => {
          return (
            logicalBundleKey({
              tool: entry.tool,
              targetType: entry.targetType,
              targetRoot: entry.targetRoot,
              sourceKind: entry.sourceKind,
              sourceCanonical: entry.sourceCanonical,
              bundleName: entry.bundleName,
            }) === currentBundleKey
          );
        });
        const managedMembers = new Map(
          (existingManagedBundle?.members ?? []).map((member) => [
            `${member.skillName}::${member.linkPath}`,
            member,
          ]),
        );
        const mutations: LinkMutation[] = [];
        const currentSkillNames = new Set(discoveredSkills.map((skill) => skill.skillName));
        const removedManagedMembers = (existingManagedBundle?.members ?? []).filter(
          (member) => !currentSkillNames.has(member.skillName),
        );

        for (const removedMember of removedManagedMembers) {
          try {
            const mutation = await removeManagedLink({
              targetLinkPath: removedMember.linkPath || resolveLinkPath(targetRoot, removedMember.skillName),
              force: args.force,
              sourceCandidates: resolveManagedSourceCandidates({
                storedSourceDir: existingManagedBundle?.storedSourceDir ?? "unknown",
                member: removedMember,
              }),
            });

            if (mutation) {
              mutations.push(mutation);
            }
          } catch (error) {
            await rollbackLinkMutations(mutations);
            throw error;
          }
        }

        for (const skill of discoveredSkills) {
          const linkPath = resolveLinkPath(targetRoot, skill.skillName);
          const existingManagedMember = managedMembers.get(`${skill.skillName}::${linkPath}`);
          let allowManagedRefresh = false;

          if (existingManagedMember) {
            if (!(await pathExists(linkPath))) {
              allowManagedRefresh = true;
            } else {
              for (const candidate of resolveManagedSourceCandidates({
                storedSourceDir: existingManagedBundle?.storedSourceDir ?? "unknown",
                member: existingManagedMember,
              })) {
                if (await isSameSkillDirectoryLink(linkPath, candidate)) {
                  allowManagedRefresh = true;
                  break;
                }
              }
            }
          }

          try {
            const mutation = await replaceManagedLink({
              sourceSkillDir: skill.skillDir,
              targetLinkPath: linkPath,
              force: args.force || allowManagedRefresh,
            });
            if (mutation) {
              mutations.push(mutation);
            }

            installedByTool[toolName].push(linkPath);
            members.push({
              skillName: skill.skillName,
              linkPath,
              sourceSkillDir: skill.skillDir,
            });
          } catch (error) {
            await rollbackLinkMutations(mutations);
            throw error;
          }
        }

        await cleanupLinkMutations(mutations);

        const existingInstalledAt = existingManagedBundle?.installedAt ?? nowIso;
        registryEntries.push({
          bundleId: createBundleId({
            sourceKind: bundleIdentity.sourceKind,
            sourceCanonical: bundleIdentity.sourceCanonical,
            cacheKey: fetched.cacheKey,
          }),
          bundleName: bundleIdentity.bundleName,
          tool: toolName,
          targetType: args.target.type,
          targetRoot,
          sourceRaw: bundleIdentity.sourceRaw,
          sourceKind: bundleIdentity.sourceKind,
          sourceCanonical: bundleIdentity.sourceCanonical,
          cacheKey: fetched.cacheKey,
          storedSourceDir: persisted.storedSourceDir,
          installedAt: existingInstalledAt,
          updatedAt: nowIso,
          members,
        });
      } catch (error) {
        failures.push(createToolFailureMessage(toolName, error));
      }
    }

    if (registryEntries.length > 0) {
      await upsertRegistryBundles(storeRootDir, registryEntries);
    }

    if (failures.length > 0) {
      for (const failureMessage of failures) {
        output.warn(failureMessage);
      }

      throw new SkillCliError(
        `Install failed for ${failures.length} tool(s): ${failures.join("; ")}`,
        ExitCode.SOURCE,
        "Review warnings above and rerun with corrected configuration or source",
      );
    }

    for (const [toolName, linkPaths] of Object.entries(installedByTool)) {
      output.info(
        `Installed bundle '${bundleIdentity.bundleName}' (${linkPaths.length} skill member(s)) for ${toolName}`,
      );
      for (const linkPath of linkPaths) {
        output.info(`  - ${linkPath}`);
      }
    }

    return {
      storedSourceDir: persisted.storedSourceDir,
      installedByTool,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
