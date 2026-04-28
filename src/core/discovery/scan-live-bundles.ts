import {
  groupScannedSkillsIntoBundles,
  type ScannedBundleGroup,
} from "./group-scanned-bundles.js";
import {
  scanInstalledSkills,
  type InstalledSkillCandidate,
  type ScannedInstalledSkill,
} from "./scan-installed.js";

export interface LiveBundleScanResult {
  scannedEntries: ScannedInstalledSkill[];
  brokenEntries: ScannedInstalledSkill[];
  bundles: ScannedBundleGroup[];
  managedBundles: ScannedBundleGroup[];
  discoveredBundles: ScannedBundleGroup[];
}

export function isManagedScannedBundle(bundle: ScannedBundleGroup): boolean {
  return bundle.cacheKey !== "unknown" && bundle.storedSourceDir !== "unknown";
}

export async function scanLiveBundles(
  candidates: InstalledSkillCandidate[],
): Promise<LiveBundleScanResult> {
  const scannedEntries = await scanInstalledSkills(candidates);
  const brokenEntries = scannedEntries.filter((entry) => entry.isBrokenSymlink);
  const bundles = await groupScannedSkillsIntoBundles(
    scannedEntries.filter((entry) => !entry.isBrokenSymlink),
  );

  return {
    scannedEntries,
    brokenEntries,
    bundles,
    managedBundles: bundles.filter(isManagedScannedBundle),
    discoveredBundles: bundles.filter((bundle) => !isManagedScannedBundle(bundle)),
  };
}
