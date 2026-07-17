import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

import { FilesystemError } from "../errors.js";

export interface SourceMetadataV1 {
  version: 1;
  bundleName: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceRaw: string;
  sourceCanonical: string;
  cacheKey: string;
}

export interface SourceMetadataV3 {
  version: 3;
  storeEntryKind: "source";
  bundleName: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceRaw: string;
  sourceCanonical: string;
  sourceRevision: string;
  sourceDisplayName: string;
  sourceManifestPath: string;
  sourceCacheKey: string;
  sourceCommitSha?: string;
  sourceRepoKey?: string;
}

export interface SourceMetadataV2 {
  version: 2;
  storeEntryKind: "skill";
  bundleName: string;
  skillName: string;
  description: string;
  relativeSkillDir: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceRaw: string;
  sourceCanonical: string;
  sourceRevision: string;
  sourceDisplayName: string;
  sourceManifestPath: string;
  sourceCacheKey: string;
  sourceCommitSha?: string;
  sourceRepoKey?: string;
}

export type SourceMetadata = SourceMetadataV1 | SourceMetadataV2 | SourceMetadataV3;

const FILE_NAME = ".skill-cli-source.json";

function isKnownSourceKind(value: unknown): value is SourceMetadataV1["sourceKind"] {
  return value === "local" || value === "git" || value === "npm" || value === "unknown";
}

function isSafeRelativePath(value: string): boolean {
  if (value === "") {
    return true;
  }

  return (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value !== "." &&
    value !== ".." &&
    normalize(value) === value &&
    !normalize(value).startsWith("../")
  );
}

function isSafeManifestPath(value: string): boolean {
  return Boolean(value) && !value.includes("\0") && isAbsolute(value) && normalize(value) === value;
}

function getMetadataPath(storedSourceDir: string): string {
  return join(storedSourceDir, FILE_NAME);
}

export async function writeSourceMetadata(
  storedSourceDir: string,
  metadata: SourceMetadata,
): Promise<void> {
  const path = getMetadataPath(storedSourceDir);

  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8").catch((error) => {
    throw new FilesystemError(
      `Failed to write source metadata file: ${path}`,
      "Check filesystem permissions and retry",
      error,
    );
  });
}

export async function readSourceMetadata(storedSourceDir: string): Promise<SourceMetadata | undefined> {
  const path = getMetadataPath(storedSourceDir);

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SourceMetadata>;

    if (
      parsed.version === 1 &&
      typeof parsed.bundleName === "string" &&
      isKnownSourceKind(parsed.sourceKind) &&
      typeof parsed.sourceRaw === "string" &&
      typeof parsed.sourceCanonical === "string" &&
      typeof parsed.cacheKey === "string"
    ) {
      return {
        version: 1,
        bundleName: parsed.bundleName,
        sourceKind: parsed.sourceKind,
        sourceRaw: parsed.sourceRaw,
        sourceCanonical: parsed.sourceCanonical,
        cacheKey: parsed.cacheKey,
      };
    }

    if (
      parsed.version === 2 &&
      parsed.storeEntryKind === "skill" &&
      typeof parsed.bundleName === "string" &&
      typeof parsed.skillName === "string" &&
      typeof parsed.description === "string" &&
      typeof parsed.relativeSkillDir === "string" &&
      isSafeRelativePath(parsed.relativeSkillDir) &&
      isKnownSourceKind(parsed.sourceKind) &&
      typeof parsed.sourceRaw === "string" &&
      typeof parsed.sourceCanonical === "string" &&
      typeof parsed.sourceRevision === "string" &&
      typeof parsed.sourceDisplayName === "string" &&
      typeof parsed.sourceManifestPath === "string" &&
      isSafeManifestPath(parsed.sourceManifestPath) &&
      typeof parsed.sourceCacheKey === "string"
    ) {
      return {
        version: 2,
        storeEntryKind: "skill",
        bundleName: parsed.bundleName,
        skillName: parsed.skillName,
        description: parsed.description,
        relativeSkillDir: parsed.relativeSkillDir,
        sourceKind: parsed.sourceKind,
        sourceRaw: parsed.sourceRaw,
        sourceCanonical: parsed.sourceCanonical,
        sourceRevision: parsed.sourceRevision,
        sourceDisplayName: parsed.sourceDisplayName,
        sourceManifestPath: parsed.sourceManifestPath,
        sourceCacheKey: parsed.sourceCacheKey,
        ...(typeof parsed.sourceCommitSha === "string"
          ? { sourceCommitSha: parsed.sourceCommitSha }
          : {}),
        ...(typeof parsed.sourceRepoKey === "string" ? { sourceRepoKey: parsed.sourceRepoKey } : {}),
      };
    }

    if (
      parsed.version === 3 &&
      parsed.storeEntryKind === "source" &&
      typeof parsed.bundleName === "string" &&
      isKnownSourceKind(parsed.sourceKind) &&
      typeof parsed.sourceRaw === "string" &&
      typeof parsed.sourceCanonical === "string" &&
      typeof parsed.sourceRevision === "string" &&
      typeof parsed.sourceDisplayName === "string" &&
      typeof parsed.sourceManifestPath === "string" &&
      isSafeManifestPath(parsed.sourceManifestPath) &&
      typeof parsed.sourceCacheKey === "string"
    ) {
      return {
        version: 3,
        storeEntryKind: "source",
        bundleName: parsed.bundleName,
        sourceKind: parsed.sourceKind,
        sourceRaw: parsed.sourceRaw,
        sourceCanonical: parsed.sourceCanonical,
        sourceRevision: parsed.sourceRevision,
        sourceDisplayName: parsed.sourceDisplayName,
        sourceManifestPath: parsed.sourceManifestPath,
        sourceCacheKey: parsed.sourceCacheKey,
        ...(typeof parsed.sourceCommitSha === "string"
          ? { sourceCommitSha: parsed.sourceCommitSha }
          : {}),
        ...(typeof parsed.sourceRepoKey === "string" ? { sourceRepoKey: parsed.sourceRepoKey } : {}),
      };
    }

    return undefined;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}
