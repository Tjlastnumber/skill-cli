import { ExitCode, SkillCliError } from "../errors.js";

export interface GitHubRepositoryUrl {
  owner: string;
  repo: string;
  displayName: string;
  webUrl: string;
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubRepositoryUrl(input: string): GitHubRepositoryUrl {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    throw invalidRepositoryUrl(input);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedInput);
  } catch {
    throw invalidRepositoryUrl(input);
  }

  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") {
    throw invalidRepositoryUrl(input);
  }

  if (parsedUrl.search || parsedUrl.hash) {
    throw invalidRepositoryUrl(input);
  }

  if (parsedUrl.pathname.includes("//")) {
    throw invalidRepositoryUrl(input);
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw invalidRepositoryUrl(input);
  }

  const owner = segments[0];
  const rawRepo = segments[1];

  if (!owner || !isValidOwner(owner)) {
    throw invalidRepositoryUrl(input);
  }

  const repo = normalizeRepoName(rawRepo);
  if (!repo) {
    throw invalidRepositoryUrl(input);
  }

  return {
    owner,
    repo,
    displayName: `${owner}/${repo}`,
    webUrl: `https://github.com/${owner}/${repo}`,
  };
}

function invalidRepositoryUrl(input: string): SkillCliError {
  return new SkillCliError(
    `Invalid GitHub repository URL: ${input}`,
    ExitCode.USER_INPUT,
    "Use a public repository root URL like https://github.com/owner/repo",
  );
}

function isValidOwner(owner: string): boolean {
  return OWNER_PATTERN.test(owner);
}

function normalizeRepoName(rawRepo: string): string | undefined {
  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
  if (!repo || repo === "." || repo === "..") {
    return undefined;
  }

  if (!REPO_PATTERN.test(repo)) {
    return undefined;
  }

  return repo;
}
