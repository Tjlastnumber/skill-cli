import { lstat, rm, writeFile } from "node:fs/promises";

import { stringify } from "yaml";

import { ConfigError, FilesystemError } from "../errors.js";
import { skillsLockfileSchema, type SkillsLockfile } from "./schema.js";

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}

export async function writeSkillsLockfile(filePath: string, lockfile: SkillsLockfile): Promise<void> {
  const validated = skillsLockfileSchema.safeParse(lockfile);
  if (!validated.success) {
    throw new ConfigError(`Invalid skills lockfile: ${formatIssues(validated.error)}`);
  }

  const yaml = stringify(validated.data, {
    indent: 2,
    lineWidth: 0,
  });

  const existingStats = await lstat(filePath).catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new FilesystemError(`Failed to inspect lockfile path: ${filePath}`, undefined, error);
  });

  if (existingStats?.isSymbolicLink()) {
    await rm(filePath, { force: true }).catch((error) => {
      throw new FilesystemError(`Failed to replace symlink lockfile path: ${filePath}`, undefined, error);
    });
  }

  await writeFile(filePath, yaml, "utf8").catch((error) => {
    throw new FilesystemError(`Failed to write lockfile: ${filePath}`, undefined, error);
  });
}
