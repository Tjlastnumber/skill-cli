import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { FilesystemError } from "../errors.js";

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await lstat(pathToCheck);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function isSameSkillDirectoryLink(
  linkPath: string,
  expectedTargetPath: string,
): Promise<boolean> {
  const stats = await lstat(linkPath).catch(() => undefined);
  if (!stats || !stats.isSymbolicLink()) {
    return false;
  }

  const linkedPath = await readlink(linkPath);
  const absoluteLinkedPath = resolve(dirname(linkPath), linkedPath);

  return absoluteLinkedPath === resolve(expectedTargetPath);
}

export async function linkSkillDirectory(options: {
  sourceSkillDir: string;
  targetLinkPath: string;
  force: boolean;
}): Promise<void> {
  const { sourceSkillDir, targetLinkPath, force } = options;

  await mkdir(dirname(targetLinkPath), { recursive: true });

  const exists = await pathExists(targetLinkPath);
  if (exists) {
    if (await isSameSkillDirectoryLink(targetLinkPath, sourceSkillDir)) {
      return;
    }

    if (!force) {
      throw new FilesystemError(
        `Target already exists: ${targetLinkPath}`,
        "Re-run with --force to replace existing targets",
      );
    }

    await rm(targetLinkPath, { recursive: true, force: true }).catch((error) => {
      throw new FilesystemError(
        `Failed to remove existing target: ${targetLinkPath}`,
        "Check file permissions and retry",
        error,
      );
    });
  }

  await symlink(sourceSkillDir, targetLinkPath, "dir").catch((error) => {
    throw new FilesystemError(
      `Failed to create symlink: ${targetLinkPath}`,
      "Check directory permissions and retry",
      error,
    );
  });
}
