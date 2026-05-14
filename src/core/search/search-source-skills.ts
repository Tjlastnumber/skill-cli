import { parseSearchSource } from "./parse-search-source.js";
import { GitCloneSearchProvider } from "./providers/git-clone.js";
import { GitHubApiSearchProvider } from "./providers/github-api.js";
import { SearchProviderFallbackError, type SearchProviderResult } from "./types.js";

interface SearchSourceSkillsOptions {
  githubProvider?: Pick<GitHubApiSearchProvider, "search">;
  cloneProvider?: Pick<GitCloneSearchProvider, "search">;
  onFallback?: (message: string) => void;
}

export async function searchSourceSkills(
  sourceInput: string,
  options: SearchSourceSkillsOptions = {},
): Promise<SearchProviderResult> {
  const source = parseSearchSource(sourceInput);
  const githubProvider = options.githubProvider ?? new GitHubApiSearchProvider();
  const cloneProvider = options.cloneProvider ?? new GitCloneSearchProvider();

  if (!source.github) {
    return await cloneProvider.search(source);
  }

  try {
    return await githubProvider.search(source);
  } catch (error) {
    if (!(error instanceof SearchProviderFallbackError)) {
      throw error;
    }

    options.onFallback?.("GitHub API search unavailable, falling back to git clone");
    return await cloneProvider.search(source);
  }
}
