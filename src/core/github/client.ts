import { SourceError } from "../errors.js";

export interface GitHubRepositoryMetadata {
  defaultBranch: string;
  description: string;
}

export interface GitHubTreeEntry {
  path: string;
  type: string;
  sha: string;
}

export interface GitHubClient {
  readRepositoryMetadata(owner: string, repo: string): Promise<GitHubRepositoryMetadata>;
  readTree(owner: string, repo: string, branch: string): Promise<GitHubTreeEntry[]>;
  readBlob(owner: string, repo: string, sha: string, path: string): Promise<string>;
}

export interface CreateGitHubClientOptions {
  fetch?: typeof fetch;
}

interface GitHubApiErrorContext {
  notFoundMessage?: string;
  failureMessage: string;
}

function decodeBase64Utf8(content: string): string {
  const normalized = content.replace(/\s+/g, "");

  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error("Invalid base64 content");
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized) {
    throw new Error("Invalid base64 content");
  }

  return decoded.toString("utf8");
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (typeof globalThis.fetch !== "function") {
    throw new SourceError("GitHub API fetch is unavailable in this runtime");
  }

  return globalThis.fetch;
}

async function readJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  context: GitHubApiErrorContext,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/vnd.github+json" },
    });
  } catch (error) {
    throw new SourceError(context.failureMessage, undefined, error);
  }

  if (!response.ok) {
    if (response.status === 404 && context.notFoundMessage) {
      throw new SourceError(context.notFoundMessage);
    }

    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      throw new SourceError("GitHub API rate limit exceeded");
    }

    throw new SourceError(context.failureMessage);
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new SourceError(context.failureMessage, undefined, error);
  }
}

export function createGitHubClient(options: CreateGitHubClientOptions = {}): GitHubClient {
  const fetchImpl = resolveFetch(options.fetch);

  return {
    async readRepositoryMetadata(owner, repo) {
      const payload = await readJson<{ default_branch?: string; description?: string | null }>(
        fetchImpl,
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          notFoundMessage: `GitHub repository not found or not public: ${owner}/${repo}`,
          failureMessage: `Failed to read GitHub repository metadata: ${owner}/${repo}`,
        },
      );

      if (!payload.default_branch) {
        throw new SourceError(`Failed to read GitHub repository metadata: ${owner}/${repo}`);
      }

      return {
        defaultBranch: payload.default_branch,
        description: typeof payload.description === "string" ? payload.description : "",
      };
    },

    async readTree(owner, repo, branch) {
      const payload = await readJson<{ tree?: Array<GitHubTreeEntry>; truncated?: boolean }>(
        fetchImpl,
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        {
          failureMessage: `Failed to read GitHub repository tree: ${owner}/${repo}#${branch}`,
        },
      );

      if (payload.truncated === true) {
        throw new SourceError(`GitHub repository tree response was truncated: ${owner}/${repo}#${branch}`);
      }

      return Array.isArray(payload.tree) ? payload.tree : [];
    },

    async readBlob(owner, repo, sha, path) {
      const payload = await readJson<{ content?: string; encoding?: string }>(
        fetchImpl,
        `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
        {
          failureMessage: `Failed to read GitHub blob: ${owner}/${repo}/${path}`,
        },
      );

      if (payload.encoding !== "base64" || typeof payload.content !== "string") {
        throw new SourceError(`Failed to decode GitHub blob: ${owner}/${repo}/${path}`);
      }

      try {
        return decodeBase64Utf8(payload.content);
      } catch (error) {
        throw new SourceError(`Failed to decode GitHub blob: ${owner}/${repo}/${path}`, undefined, error);
      }
    },
  };
}
