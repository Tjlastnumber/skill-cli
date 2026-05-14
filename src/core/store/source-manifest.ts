import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, normalize } from "node:path";

import { FilesystemError } from "../errors.js";

export interface SourceManifestSkill {
  skillName: string;
  description: string;
  relativeSkillDir: string;
}

export interface SourceManifest {
  version: 1;
  sourceKind: "local" | "git" | "npm";
  sourceRaw: string;
  sourceCanonical: string;
  sourceRevision: string;
  sourceDisplayName: string;
  sourceCacheKey: string;
  skills: SourceManifestSkill[];
}

function isDefinedSkill(skill: SourceManifestSkill | undefined): skill is SourceManifestSkill {
  return skill !== undefined;
}

function isKnownSourceKind(value: unknown): value is SourceManifest["sourceKind"] {
  return value === "local" || value === "git" || value === "npm";
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

export async function writeSourceManifest(path: string, manifest: SourceManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8").catch((error) => {
    throw new FilesystemError(
      `Failed to write source manifest: ${path}`,
      "Check filesystem permissions and retry",
      error,
    );
  });
}

export async function readSourceManifest(path: string): Promise<SourceManifest | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SourceManifest>;

    if (
      parsed.version !== 1 ||
      !isKnownSourceKind(parsed.sourceKind) ||
      typeof parsed.sourceRaw !== "string" ||
      typeof parsed.sourceCanonical !== "string" ||
      typeof parsed.sourceRevision !== "string" ||
      typeof parsed.sourceDisplayName !== "string" ||
      typeof parsed.sourceCacheKey !== "string" ||
      !Array.isArray(parsed.skills)
    ) {
      return undefined;
    }

    const skills = parsed.skills.map((skill) => {
      const entry = skill as Partial<SourceManifestSkill>;
      if (
        typeof entry.skillName !== "string" ||
        entry.skillName.length === 0 ||
        typeof entry.description !== "string" ||
        typeof entry.relativeSkillDir !== "string" ||
        !isSafeRelativePath(entry.relativeSkillDir)
      ) {
        return undefined;
      }

      return {
        skillName: entry.skillName,
        description: entry.description,
        relativeSkillDir: entry.relativeSkillDir,
      };
    });

    if (skills.some((skill) => !skill)) {
      return undefined;
    }

    const definedSkills = skills.filter(isDefinedSkill);

    const seenSkillNames = new Set<string>();
    const seenRelativeDirs = new Set<string>();
    for (const skill of definedSkills) {
      if (seenSkillNames.has(skill.skillName) || seenRelativeDirs.has(skill.relativeSkillDir)) {
        return undefined;
      }

      seenSkillNames.add(skill.skillName);
      seenRelativeDirs.add(skill.relativeSkillDir);
    }

    return {
      version: 1,
      sourceKind: parsed.sourceKind,
      sourceRaw: parsed.sourceRaw,
      sourceCanonical: parsed.sourceCanonical,
      sourceRevision: parsed.sourceRevision,
      sourceDisplayName: parsed.sourceDisplayName,
      sourceCacheKey: parsed.sourceCacheKey,
      skills: definedSkills,
    };
  } catch {
    return undefined;
  }
}
