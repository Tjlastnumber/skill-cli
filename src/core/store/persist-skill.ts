import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { FilesystemError, SourceError } from "../errors.js";

export interface PersistSkillResult {
  storedSkillDir: string;
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function persistSkillInStore(options: {
  sourceSkillDir: string;
  storeRootDir: string;
  storeEntryKey: string;
}): Promise<PersistSkillResult> {
  const { sourceSkillDir, storeRootDir, storeEntryKey } = options;

  const sourceStats = await stat(sourceSkillDir).catch(() => {
    throw new SourceError(`Fetched skill directory does not exist: ${sourceSkillDir}`);
  });

  if (!sourceStats.isDirectory()) {
    throw new SourceError(`Fetched skill path is not a directory: ${sourceSkillDir}`);
  }

  const storeDir = join(storeRootDir, "store");
  const storedSkillDir = join(storeDir, storeEntryKey);
  const requiredEntryPath = join(sourceSkillDir, "SKILL.md");
  const requiredStoredPath = join(storedSkillDir, "SKILL.md");

  await mkdir(storeDir, { recursive: true });

  if (!(await pathExists(requiredEntryPath))) {
    throw new SourceError(`Fetched skill entry file does not exist: ${requiredEntryPath}`);
  }

  const alreadyExists = await stat(storedSkillDir)
    .then(() => true)
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return false;
      }
      throw error;
    });

  if (!alreadyExists) {
    await cp(sourceSkillDir, storedSkillDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    }).catch((error) => {
      throw new FilesystemError(
        `Failed to persist skill in store: ${storedSkillDir}`,
        "Check directory permissions and free disk space",
        error,
      );
    });
  } else if (!(await pathExists(requiredStoredPath))) {
    await rm(storedSkillDir, { recursive: true, force: true });
    await cp(sourceSkillDir, storedSkillDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    }).catch((error) => {
      throw new FilesystemError(
        `Failed to repair persisted skill in store: ${storedSkillDir}`,
        "Check directory permissions and free disk space",
        error,
      );
    });
  }

  return { storedSkillDir };
}
