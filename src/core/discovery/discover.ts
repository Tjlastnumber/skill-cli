import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { ConfigError, SourceError } from "../errors.js";

export interface DiscoveredSkill {
  skillName: string;
  entryPath: string;
  skillDir: string;
  relativeSkillDir: string;
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const output: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }

      if (entry.isFile()) {
        output.push(nextPath);
      }
    }
  }

  output.sort((left, right) => left.localeCompare(right));
  return output;
}

function extractFilenameFromPattern(pattern: string): string {
  if (pattern.startsWith("**/")) {
    const filename = pattern.slice(3);
    if (!filename || filename.includes("*") || filename.includes("?")) {
      throw new ConfigError(`Unsupported entryPattern: ${pattern}`);
    }
    return filename;
  }

  if (!pattern.includes("*") && !pattern.includes("?")) {
    return basename(pattern);
  }

  throw new ConfigError(`Unsupported entryPattern: ${pattern}`);
}

function deriveSkillName(skillDir: string, strategy: string): string {
  if (strategy === "parentDir") {
    return basename(skillDir);
  }

  throw new ConfigError(`Unsupported nameStrategy: ${strategy}`);
}

export async function discoverSkills(options: {
  sourceDir: string;
  entryPattern: string;
  nameStrategy: string;
}): Promise<DiscoveredSkill[]> {
  const { sourceDir, entryPattern, nameStrategy } = options;
  const sourceStats = await stat(sourceDir).catch(() => {
    throw new SourceError(`Source directory does not exist: ${sourceDir}`);
  });

  if (!sourceStats.isDirectory()) {
    throw new SourceError(`Source path is not a directory: ${sourceDir}`);
  }

  const targetFileName = extractFilenameFromPattern(entryPattern);
  const files = await walkFiles(sourceDir);

  const matches = files.filter((filePath) => basename(filePath) === targetFileName);

  return matches.map((entryPath) => {
    const skillDir = dirname(entryPath);
    const skillName = deriveSkillName(skillDir, nameStrategy);

    return {
      skillName,
      entryPath,
      skillDir,
      relativeSkillDir: relative(sourceDir, skillDir),
    };
  });
}
