import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import { ConfigError, FilesystemError } from "../errors.js";
import { skillsLockfileSchema, type SkillsLockfile } from "./schema.js";

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}

export async function loadSkillsLockfile(filePath: string): Promise<SkillsLockfile> {
  const raw = await readFile(filePath, "utf8").catch((error) => {
    throw new FilesystemError(`Failed to read lockfile: ${filePath}`, undefined, error);
  });

  let parsed: unknown;

  try {
    parsed = parse(raw);
  } catch (error) {
    throw new ConfigError(`Failed to parse lockfile YAML at ${filePath}`, undefined, error);
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "version" in parsed &&
    (parsed as { version?: unknown }).version === 1
  ) {
    throw new ConfigError(
      `Unsupported skills lockfile version at ${filePath}: expected version 2`,
      "Run 'skill lock --force' to regenerate skills-lock.yaml in v2 format",
    );
  }

  const validated = skillsLockfileSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ConfigError(`Invalid skills lockfile at ${filePath}: ${formatIssues(validated.error)}`);
  }

  return validated.data;
}
