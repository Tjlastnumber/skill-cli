import { ExitCode, SkillCliError } from "../errors.js";
import { parseGitHubRepositoryUrl, type GitHubRepositoryUrl } from "../github/parse-repository-url.js";
import type { SearchSourceDescriptor } from "./types.js";

export function parseSearchSource(input: string): SearchSourceDescriptor {
  const normalizedInput = input.trim();
  if (!normalizedInput || normalizedInput.includes("#") || normalizedInput.startsWith("@") || isLocalPath(normalizedInput)) {
    throw invalidSearchSource(input);
  }

  const shorthand = parseGitHubShorthand(normalizedInput);
  if (shorthand) {
    return {
      raw: input,
      cloneUrl: `https://github.com/${shorthand.owner}/${shorthand.repo}.git`,
      github: shorthand,
    };
  }

  const githubSsh = parseGitHubSshSource(normalizedInput);
  if (githubSsh) {
    return {
      raw: input,
      cloneUrl: normalizedInput,
      github: githubSsh,
    };
  }

  const gitUrl = parseGitUrl(normalizedInput);
  if (gitUrl) {
    return {
      ...gitUrl,
      raw: input,
    };
  }

  throw invalidSearchSource(input);
}

function parseGitHubShorthand(input: string): GitHubRepositoryUrl | undefined {
  if (input.split("/").length !== 2) {
    return undefined;
  }

  return tryParseGitHubRepositoryUrl(`https://github.com/${input}`);
}

function parseGitHubSshSource(input: string): GitHubRepositoryUrl | undefined {
  const match = input.match(/^git@github\.com:(.+)\.git$/);
  if (!match) {
    return undefined;
  }

  return tryParseGitHubRepositoryUrl(`https://github.com/${match[1]}`);
}

function parseGitUrl(input: string): SearchSourceDescriptor | undefined {
  if (input.startsWith("https://") || input.startsWith("http://")) {
    return parseHttpsGitUrl(input);
  }

  if (input.startsWith("git://")) {
    return parseGitProtocolUrl(input);
  }

  if (input.startsWith("ssh://")) {
    return parseSshGitUrl(input);
  }

  if (/^[^@\s]+@[^:\s]+:[^\s]+\.git$/.test(input)) {
    if (input.startsWith("git@github.com:")) {
      return undefined;
    }

    return {
      raw: input,
      cloneUrl: input,
    };
  }

  return undefined;
}

function parseGitProtocolUrl(input: string): SearchSourceDescriptor | undefined {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    return undefined;
  }

  if (parsedUrl.protocol !== "git:" || parsedUrl.search || parsedUrl.hash || !parsedUrl.pathname.endsWith(".git")) {
    return undefined;
  }

  return {
    raw: input,
    cloneUrl: input,
  };
}

function parseHttpsGitUrl(input: string): SearchSourceDescriptor | undefined {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    return undefined;
  }

  if ((parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") || parsedUrl.search || parsedUrl.hash) {
    return undefined;
  }

  if (parsedUrl.protocol === "https:" && parsedUrl.hostname === "github.com") {
    const github = tryParseGitHubRepositoryUrl(input);
    if (!github) {
      return undefined;
    }

    return {
      raw: input,
      cloneUrl: `https://github.com/${github.owner}/${github.repo}.git`,
      github,
    };
  }

  if (!parsedUrl.pathname.endsWith(".git")) {
    return undefined;
  }

  return {
    raw: input,
    cloneUrl: input,
  };
}

function parseSshGitUrl(input: string): SearchSourceDescriptor | undefined {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    return undefined;
  }

  if (parsedUrl.protocol !== "ssh:" || parsedUrl.search || parsedUrl.hash || !parsedUrl.pathname.endsWith(".git")) {
    return undefined;
  }

  return {
    raw: input,
    cloneUrl: input,
  };
}

function tryParseGitHubRepositoryUrl(input: string): GitHubRepositoryUrl | undefined {
  try {
    return parseGitHubRepositoryUrl(input);
  } catch {
    return undefined;
  }
}

function isLocalPath(input: string): boolean {
  return (
    input.startsWith("./") ||
    input.startsWith("../") ||
    input.startsWith("/") ||
    input.startsWith("~/") ||
    input.startsWith("file://") ||
    /^[a-zA-Z]:[\\/]/.test(input)
  );
}

function invalidSearchSource(input: string): SkillCliError {
  return new SkillCliError(
    `Invalid search source: ${input}`,
    ExitCode.USER_INPUT,
    "Use a GitHub repository or a git clone URL without a ref or subpath",
  );
}
