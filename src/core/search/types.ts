import type { GitHubRepositoryUrl } from "../github/parse-repository-url.js";

export interface SearchRepositorySummary {
  displayName: string;
  sourceLabel: string;
  webUrl?: string;
  resolvedBy: "github-api" | "git-clone";
  defaultBranch?: string;
}

export interface SearchSourceDescriptor {
  raw: string;
  cloneUrl: string;
  github?: GitHubRepositoryUrl;
}

export interface SearchSkillRecord {
  skillName: string;
  description: string;
  path: string;
}

export interface SearchProviderResult {
  repository: SearchRepositorySummary;
  skills: SearchSkillRecord[];
}

export class SearchProviderFallbackError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = "SearchProviderFallbackError";
  }
}
