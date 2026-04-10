import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { inferBundleIdentityFromStoredSource } from "../bundle/identity.js";
import { FilesystemError } from "../errors.js";

export interface RegistryBundleMember {
  skillName: string;
  linkPath: string;
  sourceSkillDir?: string;
}

export interface RegistryBundleEntry {
  bundleId: string;
  bundleName: string;
  tool: string;
  targetType: "global" | "project" | "dir";
  targetRoot: string;
  sourceRaw: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceCanonical: string;
  cacheKey: string;
  storedSourceDir: string;
  installedAt: string;
  updatedAt: string;
  members: RegistryBundleMember[];
}

export interface RegistryData {
  version: 2;
  bundles: RegistryBundleEntry[];
}

interface LegacyRegistryInstallEntry {
  skillName: string;
  tool: string;
  targetType: "global" | "project" | "dir";
  targetRoot: string;
  linkPath: string;
  sourceRaw: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  cacheKey: string;
  storedSourceDir: string;
  installedAt: string;
  updatedAt: string;
}

interface LegacyRegistryData {
  version: 1;
  installs: LegacyRegistryInstallEntry[];
}

function getRegistryPath(storeRootDir: string): string {
  return join(storeRootDir, "registry.json");
}

function defaultRegistry(): RegistryData {
  return {
    version: 2,
    bundles: [],
  };
}

function createBundleId(parts: { sourceKind: string; sourceCanonical: string; cacheKey: string }): string {
  return createHash("sha256")
    .update(`${parts.sourceKind}::${parts.sourceCanonical}::${parts.cacheKey}`)
    .digest("hex");
}

function isRegistryV2(value: unknown): value is RegistryData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const v = value as Partial<RegistryData>;
  return v.version === 2 && Array.isArray(v.bundles);
}

function isRegistryV1(value: unknown): value is LegacyRegistryData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const v = value as Partial<LegacyRegistryData>;
  return v.version === 1 && Array.isArray(v.installs);
}

function firstNonUnknown(values: string[]): string | undefined {
  for (const value of values) {
    if (value && value !== "unknown") {
      return value;
    }
  }

  return undefined;
}

function getEarliestIso(values: string[]): string {
  return values.slice().sort()[0] ?? new Date().toISOString();
}

function getLatestIso(values: string[]): string {
  const sorted = values.slice().sort();
  return sorted[sorted.length - 1] ?? new Date().toISOString();
}

async function migrateLegacyRegistry(legacy: LegacyRegistryData): Promise<RegistryData> {
  const groups = new Map<string, LegacyRegistryInstallEntry[]>();

  for (const entry of legacy.installs) {
    const groupingSource =
      entry.cacheKey && entry.cacheKey !== "unknown"
        ? `cache:${entry.cacheKey}`
        : entry.storedSourceDir && entry.storedSourceDir !== "unknown"
          ? `store:${entry.storedSourceDir}`
          : `raw:${entry.sourceRaw}`;

    const key = `${entry.tool}::${entry.targetType}::${entry.targetRoot}::${groupingSource}`;
    const current = groups.get(key) ?? [];
    current.push(entry);
    groups.set(key, current);
  }

  const bundles: RegistryBundleEntry[] = [];

  for (const items of groups.values()) {
    if (items.length === 0) {
      continue;
    }

    const first = items[0];
    if (!first) {
      continue;
    }

    const cacheKey = firstNonUnknown(items.map((item) => item.cacheKey)) ?? "unknown";
    const storedSourceDir =
      firstNonUnknown(items.map((item) => item.storedSourceDir)) ?? first.storedSourceDir;

    const fallback = {
      bundleName: basename(first.sourceRaw) || "bundle",
      sourceKind: (first.sourceKind ?? "unknown") as "local" | "git" | "npm" | "unknown",
      sourceRaw: first.sourceRaw,
      sourceCanonical: first.sourceRaw,
    };

    const identity = await inferBundleIdentityFromStoredSource({
      storedSourceDir,
      fallback,
    });

    const members = items
      .map((item) => ({
        skillName: item.skillName,
        linkPath: item.linkPath,
      }))
      .sort((left, right) => left.skillName.localeCompare(right.skillName));

    bundles.push({
      bundleId: createBundleId({
        sourceKind: identity.sourceKind,
        sourceCanonical: identity.sourceCanonical,
        cacheKey,
      }),
      bundleName: identity.bundleName,
      tool: first.tool,
      targetType: first.targetType,
      targetRoot: first.targetRoot,
      sourceRaw: identity.sourceRaw,
      sourceKind: identity.sourceKind,
      sourceCanonical: identity.sourceCanonical,
      cacheKey,
      storedSourceDir,
      installedAt: getEarliestIso(items.map((item) => item.installedAt)),
      updatedAt: getLatestIso(items.map((item) => item.updatedAt)),
      members,
    });
  }

  bundles.sort(
    (left, right) =>
      left.tool.localeCompare(right.tool) ||
      left.bundleName.localeCompare(right.bundleName) ||
      left.targetRoot.localeCompare(right.targetRoot),
  );

  return {
    version: 2,
    bundles,
  };
}

export async function loadRegistry(storeRootDir: string): Promise<RegistryData> {
  const path = getRegistryPath(storeRootDir);

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (isRegistryV2(parsed)) {
      return parsed;
    }

    if (isRegistryV1(parsed)) {
      const migrated = await migrateLegacyRegistry(parsed);
      await saveRegistry(storeRootDir, migrated);
      return migrated;
    }

    throw new FilesystemError(
      `Invalid registry format at ${path}`,
      "Delete registry file and reinstall skills to regenerate",
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return defaultRegistry();
    }

    if (error instanceof SyntaxError) {
      throw new FilesystemError(
        `Failed to parse registry JSON at ${path}`,
        "Fix or delete the registry file",
        error,
      );
    }

    throw error;
  }
}

export async function saveRegistry(storeRootDir: string, registry: RegistryData): Promise<void> {
  await mkdir(storeRootDir, { recursive: true });
  const path = getRegistryPath(storeRootDir);

  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8").catch((error) => {
    throw new FilesystemError(
      `Failed to write registry file: ${path}`,
      "Check filesystem permissions and retry",
      error,
    );
  });
}

function bundleEntryKey(entry: RegistryBundleEntry): string {
  return `${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.bundleId}`;
}

function bundleLogicalKey(entry: RegistryBundleEntry): string {
  return `${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.sourceKind}::${entry.sourceCanonical}::${entry.bundleName}`;
}

export async function upsertRegistryBundles(
  storeRootDir: string,
  entries: RegistryBundleEntry[],
): Promise<RegistryData> {
  const registry = await loadRegistry(storeRootDir);

  for (const entry of entries) {
    const key = bundleEntryKey(entry);
    const logicalKey = bundleLogicalKey(entry);
    const index = registry.bundles.findIndex((candidate) => {
      return bundleEntryKey(candidate) === key || bundleLogicalKey(candidate) === logicalKey;
    });

    if (index === -1) {
      registry.bundles.push(entry);
      continue;
    }

    const existing = registry.bundles[index];
    if (!existing) {
      continue;
    }

    registry.bundles[index] = {
      ...entry,
      installedAt: existing.installedAt || entry.installedAt,
      updatedAt: entry.updatedAt,
    };
  }

  await saveRegistry(storeRootDir, registry);
  return registry;
}

export async function removeRegistryBundles(
  storeRootDir: string,
  matcher: (entry: RegistryBundleEntry) => boolean,
): Promise<{ registry: RegistryData; removedCount: number }> {
  const registry = await loadRegistry(storeRootDir);
  const before = registry.bundles.length;
  registry.bundles = registry.bundles.filter((entry) => !matcher(entry));
  const removedCount = before - registry.bundles.length;

  await saveRegistry(storeRootDir, registry);

  return { registry, removedCount };
}
