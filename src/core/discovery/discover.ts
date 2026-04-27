import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { ConfigError, SourceError } from "../errors.js";

export interface DiscoveredSkill {
  skillName: string;
  entryPath: string;
  relativeEntryPath: string;
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

function deriveSkillName(options: {
  sourceDir: string;
  skillDir: string;
  strategy: string;
  rootSkillName?: string;
}): string {
  const { sourceDir, skillDir, strategy, rootSkillName } = options;

  if (strategy === "parentDir") {
    if (skillDir === sourceDir && rootSkillName) {
      return rootSkillName;
    }
    return basename(skillDir);
  }

  throw new ConfigError(`Unsupported nameStrategy: ${strategy}`);
}

export async function discoverSkills(options: {
  sourceDir: string;
  entryPattern: string;
  nameStrategy: string;
  rootSkillName?: string;
}): Promise<DiscoveredSkill[]> {
  const { sourceDir, entryPattern, nameStrategy, rootSkillName } = options;
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
    const skillName = deriveSkillName({
      sourceDir,
      skillDir,
      strategy: nameStrategy,
      rootSkillName,
    });

    return {
      skillName,
      entryPath,
      relativeEntryPath: relative(sourceDir, entryPath).replace(/\\/g, "/"),
      skillDir,
      relativeSkillDir: relative(sourceDir, skillDir),
    };
  });
}
