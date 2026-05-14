import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { SourceError } from "../errors.js";
import type { SearchSkillRecord } from "./types.js";
import {
  DEFAULT_SEARCH_DISCOVERY_MAX_DEPTH,
  deriveSearchSkillName,
  selectSearchSkillCandidatePaths,
} from "./discovery-policy.js";
import { parseSearchSkillMarkdown } from "./parse-skill-markdown.js";

export interface DiscoverLocalSearchSkillsOptions {
  rootSkillName?: string;
}

export async function discoverLocalSearchSkills(
  rootDir: string,
  options: DiscoverLocalSearchSkillsOptions = {},
): Promise<SearchSkillRecord[]> {
  const allSkillPaths = await walkSkillMarkdownPaths(rootDir);
  const candidatePaths = selectSearchSkillCandidatePaths(allSkillPaths);
  const records: SearchSkillRecord[] = [];
  const rootSkillName = options.rootSkillName?.trim() || basename(rootDir);

  for (const candidatePath of candidatePaths) {
    const markdown = await readFile(join(rootDir, candidatePath), "utf8");
    const parsed = parseSearchSkillMarkdown(markdown);
    if (!parsed) {
      continue;
    }

    const skillName = deriveSearchSkillName(candidatePath, rootSkillName);
    records.push({
      skillName,
      description: parsed.description,
      path: candidatePath,
    });
  }

  assertUniqueSearchSkillNames(records);
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

async function walkSkillMarkdownPaths(rootDir: string): Promise<string[]> {
  const paths: string[] = [];

  await walkDirectory(rootDir, 0, paths, rootDir);

  return paths.sort();
}

async function walkDirectory(rootDir: string, depth: number, paths: string[], currentDir: string): Promise<void> {
  if (depth > DEFAULT_SEARCH_DISCOVERY_MAX_DEPTH) {
    return;
  }

  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(rootDir, depth + 1, paths, entryPath);
      continue;
    }

    if (entry.isFile() && entry.name === "SKILL.md") {
      paths.push(toRepositoryRelativePath(rootDir, entryPath));
    }
  }
}

function toRepositoryRelativePath(rootDir: string, entryPath: string): string {
  return relative(rootDir, entryPath).split("\\").join("/");
}

export function normalizeSearchSkillName(skillName: string): string {
  return skillName.trim().toLowerCase();
}

export function compareSearchSkillRecordPriority(left: SearchSkillRecord, right: SearchSkillRecord): number {
  return left.path.length - right.path.length || left.path.localeCompare(right.path);
}

export function assertUniqueSearchSkillNames(records: SearchSkillRecord[]): void {
  const duplicates = new Set<string>();
  const seen = new Set<string>();

  for (const record of records) {
    const normalizedSkillName = normalizeSearchSkillName(record.skillName);
    if (seen.has(normalizedSkillName)) {
      duplicates.add(record.skillName);
      continue;
    }
    seen.add(normalizedSkillName);
  }

  if (duplicates.size > 0) {
    throw new SourceError(
      `Duplicate skill names discovered for tool 'search': ${Array.from(duplicates).sort((left, right) => left.localeCompare(right)).join(", ")}`,
      "Use unique parent directory names for SKILL.md files",
    );
  }
}
