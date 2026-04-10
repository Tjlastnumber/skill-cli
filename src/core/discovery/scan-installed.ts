import { lstat, readdir, readlink, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { FilesystemError } from "../errors.js";
import { discoverSkills } from "./discover.js";

export interface InstalledSkillCandidate {
  tool: string;
  targetType: "global" | "project" | "dir";
  targetRoot: string;
  entryPattern: string;
}

export interface ScannedInstalledSkill {
  tool: string;
  skillName: string;
  targetType: "global" | "project" | "dir";
  targetRoot: string;
  linkPath: string;
  isSymlink: boolean;
  isBrokenSymlink: boolean;
  sourceSkillDir?: string;
}

async function pathIsDirectory(pathToCheck: string): Promise<boolean> {
  try {
    const stats = await stat(pathToCheck);
    return stats.isDirectory();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function scanInstalledSkills(
  candidates: InstalledSkillCandidate[],
): Promise<ScannedInstalledSkill[]> {
  const output: ScannedInstalledSkill[] = [];

  for (const candidate of candidates) {
    const exists = await pathIsDirectory(candidate.targetRoot);
    if (!exists) {
      continue;
    }

    const entries = await readdir(candidate.targetRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const linkPath = join(candidate.targetRoot, entry.name);
      const stats = await lstat(linkPath).catch((error) => {
        throw new FilesystemError(`Failed to stat installed skill path: ${linkPath}`, undefined, error);
      });

      const scanned: ScannedInstalledSkill = {
        tool: candidate.tool,
        skillName: entry.name,
        targetType: candidate.targetType,
        targetRoot: candidate.targetRoot,
        linkPath,
        isSymlink: stats.isSymbolicLink(),
        isBrokenSymlink: false,
      };

      if (!stats.isSymbolicLink()) {
        continue;
      }

      const linkedPath = await readlink(linkPath).catch((error) => {
        throw new FilesystemError(
          `Failed to read symlink target: ${linkPath}`,
          undefined,
          error,
        );
      });

      scanned.sourceSkillDir = resolve(dirname(linkPath), linkedPath);

      if (!(await pathIsDirectory(scanned.sourceSkillDir))) {
        scanned.isBrokenSymlink = true;
        output.push(scanned);
        continue;
      }

      const discovered = await discoverSkills({
        sourceDir: scanned.sourceSkillDir,
        entryPattern: candidate.entryPattern,
        nameStrategy: "parentDir",
      }).catch(() => []);

      if (discovered.length === 0) {
        continue;
      }

      output.push(scanned);
    }
  }

  output.sort(
    (left, right) =>
      left.tool.localeCompare(right.tool) ||
      left.skillName.localeCompare(right.skillName) ||
      left.linkPath.localeCompare(right.linkPath),
  );

  return output;
}
