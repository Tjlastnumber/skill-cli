import { writeFile } from "node:fs/promises";

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

  await writeFile(filePath, yaml, "utf8").catch((error) => {
    throw new FilesystemError(`Failed to write lockfile: ${filePath}`, undefined, error);
  });
}
