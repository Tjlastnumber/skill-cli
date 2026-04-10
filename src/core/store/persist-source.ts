import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { FilesystemError, SourceError } from "../errors.js";

export interface PersistSourceResult {
  storedSourceDir: string;
}

export async function persistSourceInStore(options: {
  sourceDir: string;
  storeRootDir: string;
  cacheKey: string;
}): Promise<PersistSourceResult> {
  const { sourceDir, storeRootDir, cacheKey } = options;

  const sourceStats = await stat(sourceDir).catch(() => {
    throw new SourceError(`Fetched source directory does not exist: ${sourceDir}`);
  });

  if (!sourceStats.isDirectory()) {
    throw new SourceError(`Fetched source path is not a directory: ${sourceDir}`);
  }

  const storeDir = join(storeRootDir, "store");
  const storedSourceDir = join(storeDir, cacheKey);

  await mkdir(storeDir, { recursive: true });

  const alreadyExists = await stat(storedSourceDir)
    .then(() => true)
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return false;
      }
      throw error;
    });

  if (!alreadyExists) {
    await cp(sourceDir, storedSourceDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    }).catch((error) => {
      throw new FilesystemError(
        `Failed to persist source in store: ${storedSourceDir}`,
        "Check directory permissions and free disk space",
        error,
      );
    });
  }

  return {
    storedSourceDir,
  };
}
