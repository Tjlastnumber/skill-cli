import { extractSkillDescription } from "./github/skill-markdown.js";

export function extractLocalSkillDescription(markdown: string): string {
  return extractSkillDescription(markdown).trim();
}
