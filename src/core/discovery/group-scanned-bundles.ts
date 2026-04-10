import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";

import {
  inferBundleIdentityFromStoredSource,
  type BundleIdentity,
} from "../bundle/identity.js";
import { parseStoredSourceFromPath } from "../store/store-path.js";
import type { ScannedInstalledSkill } from "./scan-installed.js";

export interface ScannedBundleMember {
  skillName: string;
  linkPath: string;
  sourceSkillDir?: string;
}

export interface ScannedBundleGroup {
  bundleId: string;
  bundleName: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceRaw: string;
  sourceCanonical: string;
  cacheKey: string;
  storedSourceDir: string;
  tool: string;
  targetType: "global" | "project" | "dir";
  targetRoot: string;
  members: ScannedBundleMember[];
}

function createBundleId(parts: { sourceKind: string; sourceCanonical: string; cacheKey: string }): string {
  return createHash("sha256")
    .update(`${parts.sourceKind}::${parts.sourceCanonical}::${parts.cacheKey}`)
    .digest("hex");
}

function defaultIdentityForScanned(
  skill: ScannedInstalledSkill,
  externalBundleRoot?: string,
): BundleIdentity {
  if (externalBundleRoot) {
    return {
      bundleName: basename(externalBundleRoot),
      sourceKind: "unknown",
      sourceRaw: externalBundleRoot,
      sourceCanonical: externalBundleRoot,
    };
  }

  return {
    bundleName: skill.skillName,
    sourceKind: "unknown",
    sourceRaw: skill.sourceSkillDir ?? skill.linkPath,
    sourceCanonical: skill.sourceSkillDir ?? skill.linkPath,
  };
}

function getExternalBundleRoot(skill: ScannedInstalledSkill): string | undefined {
  if (!skill.sourceSkillDir) {
    return undefined;
  }

  if (parseStoredSourceFromPath(skill.sourceSkillDir)) {
    return undefined;
  }

  return dirname(skill.sourceSkillDir);
}

export async function groupScannedSkillsIntoBundles(
  scannedSkills: ScannedInstalledSkill[],
): Promise<ScannedBundleGroup[]> {
  const externalRootCounts = new Map<string, number>();
  for (const skill of scannedSkills) {
    const externalBundleRoot = getExternalBundleRoot(skill);
    if (!externalBundleRoot) {
      continue;
    }

    externalRootCounts.set(
      externalBundleRoot,
      (externalRootCounts.get(externalBundleRoot) ?? 0) + 1,
    );
  }

  const identityCache = new Map<string, BundleIdentity>();
  const groups = new Map<string, ScannedBundleGroup>();

  for (const skill of scannedSkills) {
    const externalBundleRoot = getExternalBundleRoot(skill);
    const shouldGroupByExternalRoot =
      externalBundleRoot !== undefined && (externalRootCounts.get(externalBundleRoot) ?? 0) > 1;
    const sourcePath = shouldGroupByExternalRoot
      ? externalBundleRoot
      : skill.sourceSkillDir ?? skill.linkPath;
    const storeInfo = parseStoredSourceFromPath(skill.sourceSkillDir ?? skill.linkPath);

    const fallbackIdentity = defaultIdentityForScanned(
      skill,
      shouldGroupByExternalRoot ? externalBundleRoot : undefined,
    );

    let identity = fallbackIdentity;
    let cacheKey = "unknown";
    let storedSourceDir = sourcePath;

    if (storeInfo) {
      cacheKey = storeInfo.cacheKey;
      storedSourceDir = storeInfo.storedSourceDir;

      const cached = identityCache.get(storedSourceDir);
      if (cached) {
        identity = cached;
      } else {
        identity = await inferBundleIdentityFromStoredSource({
          storedSourceDir,
          fallback: fallbackIdentity,
        });
        identityCache.set(storedSourceDir, identity);
      }
    }

    const bundleId = createBundleId({
      sourceKind: identity.sourceKind,
      sourceCanonical: identity.sourceCanonical,
      cacheKey,
    });

    const groupKey = `${skill.tool}::${skill.targetType}::${skill.targetRoot}::${bundleId}`;
    let group = groups.get(groupKey);

    if (!group) {
      group = {
        bundleId,
        bundleName: identity.bundleName,
        sourceKind: identity.sourceKind,
        sourceRaw: identity.sourceRaw,
        sourceCanonical: identity.sourceCanonical,
        cacheKey,
        storedSourceDir,
        tool: skill.tool,
        targetType: skill.targetType,
        targetRoot: skill.targetRoot,
        members: [],
      };

      groups.set(groupKey, group);
    }

    group.members.push({
      skillName: skill.skillName,
      linkPath: skill.linkPath,
      sourceSkillDir: skill.sourceSkillDir,
    });
  }

  const output = Array.from(groups.values());
  output.sort(
    (left, right) =>
      left.tool.localeCompare(right.tool) ||
      left.bundleName.localeCompare(right.bundleName) ||
      left.targetRoot.localeCompare(right.targetRoot),
  );

  for (const group of output) {
    group.members.sort(
      (left, right) =>
        left.skillName.localeCompare(right.skillName) ||
        left.linkPath.localeCompare(right.linkPath),
    );
  }

  return output;
}
