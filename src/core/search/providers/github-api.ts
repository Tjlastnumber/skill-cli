import { SourceError } from "../../errors.js";
import { createGitHubClient } from "../../github/client.js";
import { assertUniqueSearchSkillNames } from "../discover-local-skills.js";
import { deriveSearchSkillName, selectSearchSkillCandidatePaths } from "../discovery-policy.js";
import { parseSearchSkillMarkdown } from "../parse-skill-markdown.js";
import {
  SearchProviderFallbackError,
  type SearchProviderResult,
  type SearchSkillRecord,
  type SearchSourceDescriptor,
} from "../types.js";

interface GitHubApiSearchProviderOptions {
  fetch?: typeof fetch;
}

export class GitHubApiSearchProvider {
  constructor(private readonly options: GitHubApiSearchProviderOptions = {}) {}

  async search(source: SearchSourceDescriptor): Promise<SearchProviderResult> {
    if (!source.github) {
      throw new SearchProviderFallbackError("GitHub identity missing for API provider");
    }

    const github = source.github;

    const client = createGitHubClient({ fetch: this.options.fetch });
    const metadata = await fallbackOnGitHubReadFailure(() => client.readRepositoryMetadata(github.owner, github.repo));
    const tree = await fallbackOnGitHubReadFailure(() => client.readTree(github.owner, github.repo, metadata.defaultBranch));
    const blobEntriesByPath = new Map(
      tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry] as const),
    );
    const skills: SearchSkillRecord[] = [];

    for (const candidatePath of selectSearchSkillCandidatePaths([...blobEntriesByPath.keys()])) {
      const entry = blobEntriesByPath.get(candidatePath);
      if (!entry) {
        continue;
      }

      const markdown = await fallbackOnGitHubReadFailure(() =>
        client.readBlob(github.owner, github.repo, entry.sha, entry.path),
      );
      const parsed = parseSearchSkillMarkdown(markdown);
      if (!parsed) {
        continue;
      }

      const skillName = deriveSearchSkillName(entry.path, github.repo);
      const nextRecord = {
        skillName,
        description: parsed.description,
        path: entry.path,
      };
      skills.push(nextRecord);
    }

    assertUniqueSearchSkillNames(skills);

    return {
      repository: {
        displayName: github.displayName,
        sourceLabel: source.raw,
        webUrl: github.webUrl,
        resolvedBy: "github-api",
        defaultBranch: metadata.defaultBranch,
      },
      skills: skills.sort((left, right) => left.path.localeCompare(right.path)),
    };
  }
}

async function fallbackOnGitHubReadFailure<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SourceError) {
      throw new SearchProviderFallbackError("GitHub API provider failed", error);
    }

    throw error;
  }
}
