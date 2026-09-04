import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  fetchSource,
  type CommandRunner,
  type CommandRunnerResult,
} from "../src/core/source/fetch.js";
import { repoKeyFromCanonical } from "../src/core/source/git-bare-repo.js";
import { SourceError } from "../src/core/errors.js";
import type { SourceDescriptor } from "../src/core/source/types.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

interface RecordedCall {
  command: string;
  args: string[];
  cwd?: string;
}

function summarize(calls: RecordedCall[]): string[] {
  return calls.map((call) => {
    if (call.command === "git") {
      if (call.args[0] === "--git-dir") {
        return call.args[2];
      }
      return call.args[0];
    }
    return call.command;
  });
}

function bareRepoPathFor(storeRootDir: string, repoCanonical: string): string {
  return join(storeRootDir, "repos", repoKeyFromCanonical(repoCanonical));
}

function gitFlowRunner(options: {
  lsRemote?: (args: string[]) => string;
  commitSha: string;
  record: RecordedCall[];
}): CommandRunner {
  return async (command, args, runnerOptions): Promise<CommandRunnerResult> => {
    options.record.push({ command, args, cwd: runnerOptions?.cwd });

    if (command === "git" && args[0] === "ls-remote") {
      return { stdout: options.lsRemote ? options.lsRemote(args) : "", stderr: "", exitCode: 0 };
    }
    if (command === "git" && args[0] === "clone" && args[1] === "--bare") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (command === "git" && args[0] === "remote") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (command === "git" && args[0] === "fetch") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (command === "git" && args[0] === "--git-dir") {
      if (args[2] === "rev-parse") {
        return { stdout: `${options.commitSha}\n`, stderr: "", exitCode: 0 };
      }
      if (args[2] === "archive") {
        const outputIndex = args.indexOf("--output");
        const tarPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
        if (tarPath) {
          await writeFile(tarPath, "FAKE_TAR");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    }
    if (command === "tar") {
      const cIndex = args.indexOf("-C");
      const target = cIndex >= 0 ? args[cIndex + 1] : undefined;
      if (target) {
        await mkdir(target, { recursive: true });
        await writeFile(join(target, "SKILL.md"), "# git skill\n");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };
}

describe("fetchSource", () => {
  it("resolves local source without running shell commands", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-local-"));
    cleanupDirs.push(base);

    const cwd = join(base, "workspace");
    const localDir = join(cwd, "skills", "alpha");

    await mkdir(localDir, { recursive: true });

    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const descriptor: SourceDescriptor = {
      kind: "local",
      raw: "skills/alpha",
      path: resolve(localDir),
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      runCommand: runner,
    });

    expect(result.sourceDir).toBe(resolve(localDir));
    expect(calls).toHaveLength(0);
  });

  it("returns different local cache keys for identical contents at different absolute paths", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-local-provenance-"));
    cleanupDirs.push(base);

    const firstDir = join(base, "workspace-a", "skills", "alpha");
    const secondDir = join(base, "workspace-b", "skills", "alpha");

    await mkdir(firstDir, { recursive: true });
    await mkdir(secondDir, { recursive: true });
    await writeFile(join(firstDir, "SKILL.md"), "# alpha\n");
    await writeFile(join(secondDir, "SKILL.md"), "# alpha\n");

    const firstResult = await fetchSource(
      {
        kind: "local",
        raw: "workspace-a/skills/alpha",
        path: resolve(firstDir),
      },
      {
        tempDir: join(base, "tmp"),
      },
    );

    const secondResult = await fetchSource(
      {
        kind: "local",
        raw: "workspace-b/skills/alpha",
        path: resolve(secondDir),
      },
      {
        tempDir: join(base, "tmp"),
      },
    );

    expect(firstResult.cacheKey).not.toBe(secondResult.cacheKey);
  });

  it("changes the local cache key when local content changes", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-local-content-"));
    cleanupDirs.push(base);

    const localDir = join(base, "workspace", "skills", "alpha");
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "SKILL.md"), "# alpha\n");

    const descriptor: SourceDescriptor = {
      kind: "local",
      raw: "workspace/skills/alpha",
      path: resolve(localDir),
    };

    const initialResult = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
    });

    await writeFile(join(localDir, "SKILL.md"), "# alpha updated\n");

    const updatedResult = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
    });

    expect(initialResult.cacheKey).not.toBe(updatedResult.cacheKey);
  });

  it("resolves git branch refs to a remote commit and uses a commit-based cache key", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-"));
    cleanupDirs.push(base);

    const repoCanonical = "github.com/acme/skills";
    const remoteHeadSha = "0123456789abcdef0123456789abcdef01234567";
    const storeRootDir = join(base, "store");
    const calls: RecordedCall[] = [];

    const descriptor: SourceDescriptor = {
      kind: "git",
      raw: "acme/skills#main",
      url: "https://github.com/acme/skills.git",
      ref: "main",
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      storeRootDir,
      runCommand: gitFlowRunner({
        commitSha: remoteHeadSha,
        record: calls,
        lsRemote: () => `${remoteHeadSha}\trefs/heads/main\n`,
      }),
    });

    expect(result.sourceDir).toContain(join(base, "tmp"));
    expect(result.cacheKey).toBe(
      createHash("sha256")
        .update(`git:${repoCanonical}@${remoteHeadSha}`)
        .digest("hex"),
    );
    expect(result.commitSha).toBe(remoteHeadSha);
    expect(result.repoCanonical).toBe(repoCanonical);
    expect(result.repoKey).toBe(repoKeyFromCanonical(repoCanonical));

    expect(summarize(calls)).toEqual([
      "ls-remote",
      "clone",
      "fetch",
      "rev-parse",
      "archive",
      "tar",
    ]);
    expect(calls[0]).toEqual({
      command: "git",
      args: [
        "ls-remote",
        "https://github.com/acme/skills.git",
        "refs/heads/main",
        "refs/tags/main",
        "refs/tags/main^{}",
      ],
      cwd: undefined,
    });
    expect(calls[1]).toEqual({
      command: "git",
      args: ["clone", "--bare", "https://github.com/acme/skills.git", bareRepoPathFor(storeRootDir, repoCanonical)],
      cwd: undefined,
    });
  });

  it("resolves the remote default HEAD commit for git sources without an explicit ref", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-head-"));
    cleanupDirs.push(base);

    const repoCanonical = "github.com/acme/skills";
    const remoteHeadSha = "89abcdef0123456789abcdef0123456789abcdef";
    const storeRootDir = join(base, "store");
    const calls: RecordedCall[] = [];

    const descriptor: SourceDescriptor = {
      kind: "git",
      raw: "git@github.com:acme/skills.git",
      url: "git@github.com:acme/skills.git",
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      storeRootDir,
      runCommand: gitFlowRunner({
        commitSha: remoteHeadSha,
        record: calls,
        lsRemote: () => `ref: refs/heads/main\tHEAD\n${remoteHeadSha}\tHEAD\n`,
      }),
    });

    expect(result.cacheKey).toBe(
      createHash("sha256")
        .update(`git:${repoCanonical}@${remoteHeadSha}`)
        .digest("hex"),
    );
    expect(result.commitSha).toBe(remoteHeadSha);
    expect(calls[0]).toEqual({
      command: "git",
      args: ["ls-remote", "--symref", "git@github.com:acme/skills.git", "HEAD"],
      cwd: undefined,
    });
    expect(calls[1]).toEqual({
      command: "git",
      args: ["clone", "--bare", "git@github.com:acme/skills.git", bareRepoPathFor(storeRootDir, repoCanonical)],
      cwd: undefined,
    });
  });

  it("resolves annotated git tags to their peeled commit for cache-keying", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-tag-"));
    cleanupDirs.push(base);

    const repoCanonical = "github.com/acme/skills";
    const peeledCommitSha = "2222222222222222222222222222222222222222";
    const storeRootDir = join(base, "store");
    const calls: RecordedCall[] = [];

    const descriptor: SourceDescriptor = {
      kind: "git",
      raw: "https://github.com/acme/skills.git#v1.2.3",
      url: "https://github.com/acme/skills.git",
      ref: "v1.2.3",
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      storeRootDir,
      runCommand: gitFlowRunner({
        commitSha: peeledCommitSha,
        record: calls,
        lsRemote: () =>
          [
            `1111111111111111111111111111111111111111\trefs/tags/v1.2.3`,
            `${peeledCommitSha}\trefs/tags/v1.2.3^{}`,
            "",
          ].join("\n"),
      }),
    });

    expect(result.cacheKey).toBe(
      createHash("sha256")
        .update(`git:${repoCanonical}@${peeledCommitSha}`)
        .digest("hex"),
    );
    expect(result.commitSha).toBe(peeledCommitSha);
    expect(calls[0]).toEqual({
      command: "git",
      args: [
        "ls-remote",
        "https://github.com/acme/skills.git",
        "refs/heads/v1.2.3",
        "refs/tags/v1.2.3",
        "refs/tags/v1.2.3^{}",
      ],
      cwd: undefined,
    });
    expect(summarize(calls)).toEqual([
      "ls-remote",
      "clone",
      "fetch",
      "rev-parse",
      "archive",
      "tar",
    ]);
  });

  it("fails when a git ref matches both a branch and a tag", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-ambiguous-ref-"));
    cleanupDirs.push(base);

    const runner: CommandRunner = async (command, args): Promise<CommandRunnerResult> => {
      if (command === "git" && args[0] === "ls-remote") {
        return {
          stdout: [
            `3333333333333333333333333333333333333333\trefs/heads/release`,
            `4444444444444444444444444444444444444444\trefs/tags/release`,
            "",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    };

    const descriptor: SourceDescriptor = {
      kind: "git",
      raw: "https://github.com/acme/skills.git#release",
      url: "https://github.com/acme/skills.git",
      ref: "release",
    };

    await expect(
      fetchSource(descriptor, {
        tempDir: join(base, "tmp"),
        storeRootDir: join(base, "store"),
        runCommand: runner,
      }),
    ).rejects.toThrow(new SourceError("Ambiguous git ref 'release': matches both a branch and a tag"));
  });

  it("normalizes abbreviated commit refs to the resolved full commit for cache-keying", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-short-sha-"));
    cleanupDirs.push(base);

    const repoCanonical = "github.com/acme/skills";
    const shortSha = "0123456";
    const fullSha = "0123456789abcdef0123456789abcdef01234567";
    const storeRootDir = join(base, "store");
    const calls: RecordedCall[] = [];

    const descriptor: SourceDescriptor = {
      kind: "git",
      raw: `acme/skills#${shortSha}`,
      url: "https://github.com/acme/skills.git",
      ref: shortSha,
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      storeRootDir,
      runCommand: gitFlowRunner({ commitSha: fullSha, record: calls }),
    });

    expect(result.cacheKey).toBe(
      createHash("sha256")
        .update(`git:${repoCanonical}@${fullSha}`)
        .digest("hex"),
    );
    expect(result.commitSha).toBe(fullSha);
    expect(calls[0]).toEqual({
      command: "git",
      args: ["clone", "--bare", "https://github.com/acme/skills.git", bareRepoPathFor(storeRootDir, repoCanonical)],
      cwd: undefined,
    });
    expect(summarize(calls)).toEqual(["clone", "fetch", "rev-parse", "archive", "tar"]);
    const revParseCall = calls.find((call) => summarize([call])[0] === "rev-parse");
    expect(revParseCall?.args).toContain(shortSha);
  });

  it("exports the exact commit tree for full SHA refs", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-sha-"));
    cleanupDirs.push(base);

    const repoCanonical = "github.com/acme/skills";
    const fullSha = "0123456789abcdef0123456789abcdef01234567";
    const storeRootDir = join(base, "store");
    const calls: RecordedCall[] = [];

    const descriptor: SourceDescriptor = {
      kind: "git",
      raw: "acme/skills#0123456789abcdef0123456789abcdef01234567",
      url: "https://github.com/acme/skills.git",
      ref: "0123456789abcdef0123456789abcdef01234567",
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      storeRootDir,
      runCommand: gitFlowRunner({ commitSha: fullSha, record: calls }),
    });

    expect(result.cacheKey).toBe(
      createHash("sha256")
        .update(`git:${repoCanonical}@${fullSha}`)
        .digest("hex"),
    );
    expect(result.commitSha).toBe(fullSha);
    expect(summarize(calls)).toEqual(["clone", "fetch", "rev-parse", "rev-parse", "archive", "tar"]);
    const archiveCall = calls.find((call) => summarize([call])[0] === "archive");
    expect(archiveCall?.args).toContain(fullSha);
  });

  it("fetches a locked commit before resolving it from a fresh bare repository", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-locked-cold-cache-"));
    cleanupDirs.push(base);

    const repoCanonical = "github.com/acme/skills";
    const fullSha = "0123456789abcdef0123456789abcdef01234567";
    const storeRootDir = join(base, "store");
    const calls: RecordedCall[] = [];
    let commitFetched = false;

    const runner: CommandRunner = async (command, args, options): Promise<CommandRunnerResult> => {
      calls.push({ command, args, cwd: options?.cwd });

      if (command === "git" && args[0] === "clone" && args[1] === "--bare") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "fetch") {
        if (args[1] === "origin" && args[2] === fullSha) {
          commitFetched = true;
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (
        command === "git" &&
        args[0] === "--git-dir" &&
        args[2] === "rev-parse" &&
        args[3] === "--verify"
      ) {
        if (!commitFetched) {
          throw new SourceError(`Locked commit is unavailable locally: ${fullSha}`);
        }
        return { stdout: `${fullSha}\n`, stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "--git-dir" && args[2] === "rev-parse") {
        if (!commitFetched) {
          throw new SourceError(`Locked commit is unavailable locally: ${fullSha}`);
        }
        return { stdout: `${fullSha}\n`, stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "--git-dir" && args[2] === "archive") {
        const outputIndex = args.indexOf("--output");
        const tarPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
        if (tarPath) {
          await writeFile(tarPath, "FAKE_TAR");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "tar") {
        const cIndex = args.indexOf("-C");
        const target = cIndex >= 0 ? args[cIndex + 1] : undefined;
        if (target) {
          await mkdir(target, { recursive: true });
          await writeFile(join(target, "SKILL.md"), "# git skill\n");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    };

    const result = await fetchSource(
      {
        kind: "git",
        raw: `https://github.com/acme/skills.git#${fullSha}`,
        url: "https://github.com/acme/skills.git",
        ref: fullSha,
      },
      {
        tempDir: join(base, "tmp"),
        storeRootDir,
        runCommand: runner,
      },
    );

    expect(result.commitSha).toBe(fullSha);
    expect(summarize(calls)).toEqual(["clone", "fetch", "rev-parse", "fetch", "rev-parse", "archive", "tar"]);
    expect(calls[3]).toEqual({
      command: "git",
      args: ["fetch", "origin", fullSha],
      cwd: bareRepoPathFor(storeRootDir, repoCanonical),
    });
  });

  it("packs and extracts npm source via npm pack and tar", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-npm-"));
    cleanupDirs.push(base);

    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args): Promise<CommandRunnerResult> => {
      calls.push({ command, args });

      if (command === "npm" && args[0] === "pack") {
        return {
          stdout: JSON.stringify([{ filename: "acme-skills-kit-1.2.3.tgz" }]),
          stderr: "",
          exitCode: 0,
        };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const descriptor: SourceDescriptor = {
      kind: "npm",
      raw: "@acme/skills-kit@1.2.3",
      spec: "@acme/skills-kit@1.2.3",
      packageName: "@acme/skills-kit",
      version: "1.2.3",
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      runCommand: runner,
    });

    expect(result.sourceDir).toContain(join(base, "tmp"));
    expect(calls).toHaveLength(2);

    expect(calls[0]?.command).toBe("npm");
    expect(calls[0]?.args).toContain("pack");
    expect(calls[0]?.args).toContain("--pack-destination");
    expect(calls[0]?.args).toContain("--json");

    expect(calls[1]?.command).toBe("tar");
    expect(calls[1]?.args).toContain("-xzf");
    expect(calls[1]?.args).toContain("--strip-components=1");
    expect(calls[1]?.args).toContain(result.sourceDir);
  });

  it("uses absolute tarball path from pnpm pack output", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-npm-absolute-"));
    cleanupDirs.push(base);

    const absoluteTarballPath = join(base, "tmp", "pack-dir", "skill-cli-0.1.0.tgz");

    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args): Promise<CommandRunnerResult> => {
      calls.push({ command, args });

      if (command === "npm" && args[0] === "pack") {
        return {
          stdout: JSON.stringify([{ filename: absoluteTarballPath }]),
          stderr: "",
          exitCode: 0,
        };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const descriptor: SourceDescriptor = {
      kind: "npm",
      raw: "skill-cli@0.1.0",
      spec: "skill-cli@0.1.0",
      packageName: "skill-cli",
      version: "0.1.0",
    };

    await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      runCommand: runner,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.command).toBe("tar");
    expect(calls[1]?.args[1]).toBe(absoluteTarballPath);
  });
});
