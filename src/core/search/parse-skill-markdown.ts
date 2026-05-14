import { parse as parseYaml } from "yaml";

export interface ParsedSearchSkillMarkdown {
  skillName: string;
  description: string;
}

export function parseSearchSkillMarkdown(markdown: string): ParsedSearchSkillMarkdown | undefined {
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatterMatch) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatterMatch[1]);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const data = parsed as {
    name?: unknown;
    description?: unknown;
    metadata?: { internal?: unknown };
  };

  if (typeof data.name !== "string" || typeof data.description !== "string") {
    return undefined;
  }

  if (data.metadata?.internal === true) {
    return undefined;
  }

  const skillName = data.name.trim();
  const description = data.description.trim();

  if (!skillName || !description) {
    return undefined;
  }

  return {
    skillName,
    description,
  };
}
