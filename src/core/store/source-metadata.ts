import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FilesystemError } from "../errors.js";

export interface SourceMetadata {
  version: 1;
  bundleName: string;
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceRaw: string;
  sourceCanonical: string;
  cacheKey: string;
}

const FILE_NAME = ".skill-cli-source.json";

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
      parsed.version !== 1 ||
      typeof parsed.bundleName !== "string" ||
      typeof parsed.sourceKind !== "string" ||
      typeof parsed.sourceRaw !== "string" ||
      typeof parsed.sourceCanonical !== "string" ||
      typeof parsed.cacheKey !== "string"
    ) {
      return undefined;
    }

    return {
      version: 1,
      bundleName: parsed.bundleName,
      sourceKind: parsed.sourceKind,
      sourceRaw: parsed.sourceRaw,
      sourceCanonical: parsed.sourceCanonical,
      cacheKey: parsed.cacheKey,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}
