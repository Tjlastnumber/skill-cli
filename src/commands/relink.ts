import { lstat, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../core/config/load.js";
import { FilesystemError } from "../core/errors.js";
import { linkSkillDirectory } from "../core/linker/link-skill.js";
import { createOutput, type Output } from "../core/output.js";
import { loadRegistry, type RegistryBundleEntry, type RegistryBundleMember } from "../core/registry/registry.js";

import { resolveLinkPath, resolveStoreRootDir, selectTools } from "./shared.js";

export interface RelinkCommandArgs {
  tool: string;
}

export interface RelinkRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface RelinkCommandResult {
  processedBundles: number;
  relinkedMembers: number;
  skippedMembers: number;
  failedMembers: number;
  cacheKeys: string[];
}

async function isDirectory(pathValue: string): Promise<boolean> {
  try {
    const stats = await stat(pathValue);
    return stats.isDirectory();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function buildCandidateSourceDirs(bundle: RegistryBundleEntry, member: RegistryBundleMember): string[] {
  const candidates: string[] = [];

  if (member.sourceSkillDir) {
    candidates.push(member.sourceSkillDir);
  }

  if (bundle.storedSourceDir && bundle.storedSourceDir !== "unknown") {
    candidates.push(join(bundle.storedSourceDir, member.skillName));
    candidates.push(join(bundle.storedSourceDir, "skills", member.skillName));
  }

  const dedup = new Set<string>();
  const output: string[] = [];

  for (const candidate of candidates) {
    if (!candidate || dedup.has(candidate)) {
      continue;
    }
    dedup.add(candidate);
    output.push(candidate);
  }

  return output;
}

async function resolveMemberSourceDir(
  bundle: RegistryBundleEntry,
  member: RegistryBundleMember,
): Promise<string | undefined> {
  const candidates = buildCandidateSourceDirs(bundle, member);

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function safeReplaceIfWrongSymlink(linkPath: string): Promise<boolean> {
  try {
    const stats = await lstat(linkPath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function runRelinkCommand(
  args: RelinkCommandArgs,
  runtime: RelinkRuntimeOptions = {},
): Promise<RelinkCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const homeDir = runtime.homeDir ?? homedir();
  const env = runtime.env ?? process.env;
  const output = runtime.output ?? createOutput();

  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const registry = await loadRegistry(storeRootDir);

  const bundles = registry.bundles.filter((bundle) => selectedTools.includes(bundle.tool));
  let relinkedMembers = 0;
  let skippedMembers = 0;
  let failedMembers = 0;

  for (const bundle of bundles) {
    for (const member of bundle.members) {
      const linkPath = member.linkPath || resolveLinkPath(bundle.targetRoot, member.skillName);
      const sourceSkillDir = await resolveMemberSourceDir(bundle, member);

      if (!sourceSkillDir) {
        failedMembers += 1;
        output.warn(
          `Cannot resolve source dir for ${bundle.tool}/${bundle.bundleName}/${member.skillName}`,
        );
        continue;
      }

      try {
        await linkSkillDirectory({
          sourceSkillDir,
          targetLinkPath: linkPath,
          force: false,
        });
        relinkedMembers += 1;
      } catch (error) {
        if (error instanceof FilesystemError && /Target already exists/.test(error.message)) {
          const canReplace = await safeReplaceIfWrongSymlink(linkPath);
          if (!canReplace) {
            skippedMembers += 1;
            output.warn(`Skipped existing non-symlink target: ${linkPath}`);
            continue;
          }

          await linkSkillDirectory({
            sourceSkillDir,
            targetLinkPath: linkPath,
            force: true,
          });
          relinkedMembers += 1;
          continue;
        }

        failedMembers += 1;
        output.warn(
          `Failed to relink ${bundle.tool}/${bundle.bundleName}/${member.skillName}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  }

  output.info(
    `Relink summary: bundles=${bundles.length} relinked=${relinkedMembers} skipped=${skippedMembers} failed=${failedMembers}`,
  );

  const cacheKeys = Array.from(
    new Set(
      bundles
        .map((bundle) => bundle.cacheKey)
        .filter((cacheKey) => Boolean(cacheKey) && cacheKey !== "unknown"),
    ),
  );

  return {
    processedBundles: bundles.length,
    relinkedMembers,
    skippedMembers,
    failedMembers,
    cacheKeys,
  };
}
