import { SourceError } from "../errors.js";
import { isCommitSha } from "./git-ref.js";
import { canonicalizeGitRepository } from "./git-repo.js";

import type { CommandRunner } from "./fetch.js";
import type { GitSourceDescriptor } from "./types.js";

export interface ResolvedGitSourceRef {
  repoCanonical: string;
  resolvedCommitSha: string;
  cloneBranchName?: string;
}

function parseLsRemoteLine(stdout: string, refName: string): string | undefined {
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith(`\t${refName}`));

  if (!line) {
    return undefined;
  }

  const [commitSha] = line.split(/\s+/);
  return commitSha || undefined;
}

function parseLsRemoteHead(stdout: string): { branchName?: string; commitSha?: string } {
  const lines = stdout.split("\n").map((entry) => entry.trim());
  const symrefLine = lines.find((entry) => entry.startsWith("ref:"));
  const headLine = lines.find((entry) => !entry.startsWith("ref:") && entry.endsWith("\tHEAD"));

  const branchName = symrefLine?.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/)?.[1];
  const commitSha = headLine?.split(/\s+/)[0];

  return { branchName, commitSha };
}

export async function resolveGitSourceRef(
  descriptor: GitSourceDescriptor,
  runCommand: CommandRunner,
): Promise<ResolvedGitSourceRef> {
  const repoCanonical = canonicalizeGitRepository(descriptor.url);

  if (isCommitSha(descriptor.ref)) {
    return {
      repoCanonical,
      resolvedCommitSha: descriptor.ref,
    };
  }

  if (descriptor.ref) {
    const lsRemoteResult = await runCommand("git", [
      "ls-remote",
      descriptor.url,
      `refs/heads/${descriptor.ref}`,
      `refs/tags/${descriptor.ref}`,
      `refs/tags/${descriptor.ref}^{}`,
    ]);
    const branchCommitSha = parseLsRemoteLine(lsRemoteResult.stdout, `refs/heads/${descriptor.ref}`);
    const peeledTagCommitSha = parseLsRemoteLine(lsRemoteResult.stdout, `refs/tags/${descriptor.ref}^{}`);
    const rawTagCommitSha = parseLsRemoteLine(lsRemoteResult.stdout, `refs/tags/${descriptor.ref}`);

    if (branchCommitSha && (peeledTagCommitSha || rawTagCommitSha)) {
      throw new SourceError(
        `Ambiguous git ref '${descriptor.ref}': matches both a branch and a tag`,
      );
    }

    const resolvedCommitSha = branchCommitSha ?? peeledTagCommitSha ?? rawTagCommitSha;
    if (!resolvedCommitSha) {
      throw new SourceError(`Unable to resolve git ref '${descriptor.ref}' from ${descriptor.url}`);
    }

    return {
      repoCanonical,
      resolvedCommitSha,
      cloneBranchName: descriptor.ref,
    };
  }

  const lsRemoteHeadResult = await runCommand("git", ["ls-remote", "--symref", descriptor.url, "HEAD"]);
  const parsedHead = parseLsRemoteHead(lsRemoteHeadResult.stdout);
  if (!parsedHead.commitSha) {
    throw new SourceError(`Unable to resolve remote HEAD for ${descriptor.url}`);
  }

  return {
    repoCanonical,
    resolvedCommitSha: parsedHead.commitSha,
    cloneBranchName: parsedHead.branchName,
  };
}
