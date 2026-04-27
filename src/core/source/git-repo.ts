function normalizeGitRepositoryPath(pathValue: string): string {
  return pathValue.replace(/\/+$/, "").replace(/\.git$/, "").replace(/^\//, "");
}

export function canonicalizeGitRepository(url: string): string {
  const trimmed = url.trim().replace(/#.*$/, "");

  const gitSshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (gitSshMatch) {
    const host = gitSshMatch[1];
    const repoPath = gitSshMatch[2] ? normalizeGitRepositoryPath(gitSshMatch[2]) : undefined;
    if (host && repoPath) {
      return `${host}/${repoPath}`;
    }
  }

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return `github.com/${normalizeGitRepositoryPath(trimmed)}`;
  }

  const parsedUrl = new URL(trimmed);
  const repoPath = normalizeGitRepositoryPath(parsedUrl.pathname);
  return `${parsedUrl.host}/${repoPath}`;
}

export function describeGitRepository(url: string): { canonical: string; bundleName: string } {
  const canonical = canonicalizeGitRepository(url);
  const bundleName = canonical.split("/").at(-1) || "git-bundle";

  return {
    canonical,
    bundleName,
  };
}
