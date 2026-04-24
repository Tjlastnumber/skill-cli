import { basename, dirname } from "node:path/posix";

import { createGitHubClient } from "./client.js";
import { parseGitHubRepositoryUrl } from "./parse-repository-url.js";
import { extractSkillDescription } from "./skill-markdown.js";

export interface BrowsedRepositorySkill {
  skillName: string;
  description: string;
  path: string;
}

export interface BrowsedRepository {
  displayName: string;
  webUrl: string;
  summary: string;
  defaultBranch: string;
}

export interface BrowseRepositorySkillsResult {
  repository: BrowsedRepository;
  skills: BrowsedRepositorySkill[];
}

export interface BrowseRepositorySkillsOptions {
  fetch?: typeof fetch;
  concurrency?: number;
}

function isSkillMarkdownPath(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md");
}

function deriveSkillName(path: string, repositoryName: string): string {
  return path === "SKILL.md" ? repositoryName : basename(dirname(path));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex] as T);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

export async function browseRepositorySkills(
  repositoryUrl: string,
  options: BrowseRepositorySkillsOptions = {},
): Promise<BrowseRepositorySkillsResult> {
  const repository = parseGitHubRepositoryUrl(repositoryUrl);
  const client = createGitHubClient({ fetch: options.fetch });
  const metadata = await client.readRepositoryMetadata(repository.owner, repository.repo);
  const tree = await client.readTree(repository.owner, repository.repo, metadata.defaultBranch);
  const skillEntries = tree.filter((entry) => entry.type === "blob" && isSkillMarkdownPath(entry.path));

  const concurrency = options.concurrency ?? 4;
  const skills = await mapWithConcurrency(skillEntries, concurrency, async (entry) => {
    const markdown = await client.readBlob(repository.owner, repository.repo, entry.sha, entry.path);

    return {
      skillName: deriveSkillName(entry.path, repository.repo),
      description: extractSkillDescription(markdown),
      path: entry.path,
    };
  });

  return {
    repository: {
      displayName: repository.displayName,
      webUrl: repository.webUrl,
      summary: metadata.description,
      defaultBranch: metadata.defaultBranch,
    },
    skills: skills.sort(
      (left, right) => left.path.localeCompare(right.path) || left.skillName.localeCompare(right.skillName),
    ),
  };
}
