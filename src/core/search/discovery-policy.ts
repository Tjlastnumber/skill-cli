export const SEARCH_PRIORITY_ROOTS = ["", "skills", ".claude/skills", ".codex/skills", ".opencode/skills"] as const;

export const DEFAULT_SEARCH_DISCOVERY_MAX_DEPTH = 5;

export function selectSearchSkillCandidatePaths(
  paths: string[],
  maxDepth = DEFAULT_SEARCH_DISCOVERY_MAX_DEPTH,
): string[] {
  const normalizedPaths = [...new Set(paths)]
    .filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md"))
    .sort();
  const priorityMatches: string[] = [];

  for (const root of SEARCH_PRIORITY_ROOTS) {
    const prefix = root ? `${root}/` : "";
    const matches = normalizedPaths.filter((path) => isPriorityRootMatch(path, prefix));
    priorityMatches.push(...matches);
  }

  if (priorityMatches.length > 0) {
    return priorityMatches;
  }

  return normalizedPaths.filter((path) => path.split("/").length - 1 <= maxDepth);
}

export function deriveSearchSkillName(path: string, rootSkillName: string): string {
  if (path === "SKILL.md") {
    return rootSkillName;
  }

  const segments = path.split("/");
  return segments.at(-2) || rootSkillName;
}

function isPriorityRootMatch(path: string, prefix: string): boolean {
  if (prefix) {
    if (!path.startsWith(prefix)) {
      return false;
    }

    const remainder = path.slice(prefix.length);
    return remainder === "SKILL.md" || /^[^/]+\/SKILL\.md$/.test(remainder);
  }

  return path === "SKILL.md" || /^[^/]+\/SKILL\.md$/.test(path);
}
