import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  repoKeyFromCanonical,
  bareRepoPath,
  ensureBareRepo,
  fetchIntoBare,
  exportCommit,
  prepareBareRepo,
  resolveCommitSha,
} from "../src/core/source/git-bare-repo.js";
import type { CommandRunner, CommandRunnerResult } from "../src/core/source/fetch.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function recordingRunner(record?: Array<{ command: string; args: string[]; cwd?: string }>): CommandRunner {
  return async (command, args, options): Promise<CommandRunnerResult> => {
    record?.push({ command, args, cwd: options?.cwd });
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

function missingCommitRunner(record: Array<{ command: string; args: string[]; cwd?: string }>): CommandRunner {
  return async (command, args, options): Promise<CommandRunnerResult> => {
    record.push({ command, args, cwd: options?.cwd });
    if (command === "git" && args[0] === "--git-dir" && args[2] === "rev-parse") {
      throw new Error("Commit is not present");
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("repoKeyFromCanonical", () => {
  it("produces a deterministic sha256 hex digest of the canonical", () => {
    const canonical = "github.com/acme/skills";
    const expected = createHash("sha256").update(canonical).digest("hex");

    expect(repoKeyFromCanonical(canonical)).toBe(expected);
    expect(repoKeyFromCanonical(canonical)).toHaveLength(64);
  });

  it("produces different keys for different canonicals", () => {
    expect(repoKeyFromCanonical("github.com/acme/skills")).not.toBe(
      repoKeyFromCanonical("github.com/acme/other"),
    );
  });
});

describe("bareRepoPath", () => {
  it("places the bare repo under <storeRootDir>/repos/<repoKey>", () => {
    const storeRootDir = "/home/u/.skills";
    const repoKey = "a".repeat(64);

    expect(bareRepoPath(storeRootDir, repoKey)).toBe(
      join(storeRootDir, "repos", repoKey),
    );
  });
});

describe("ensureBareRepo", () => {
  it("clones a bare repo when one does not yet exist for the source", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-bare-clone-"));
    cleanupDirs.push(base);
    const storeRootDir = join(base, "store");
    const repoKey = repoKeyFromCanonical("github.com/acme/skills");
    const url = "https://github.com/acme/skills.git";

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const { barePath } = await ensureBareRepo({
      storeRootDir,
      repoKey,
      url,
      runCommand: recordingRunner(calls),
    });

    expect(barePath).toBe(bareRepoPath(storeRootDir, repoKey));
    expect(calls).toEqual([
      {
        command: "git",
        args: ["clone", "--bare", url, barePath],
        cwd: undefined,
      },
    ]);
    expect(await pathExists(join(storeRootDir, "repos"))).toBe(true);
  });

  it("updates the remote url when the bare repo already exists", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-bare-update-"));
    cleanupDirs.push(base);
    const storeRootDir = join(base, "store");
    const repoKey = repoKeyFromCanonical("github.com/acme/skills");
    const barePath = bareRepoPath(storeRootDir, repoKey);
    await mkdir(barePath, { recursive: true });
    const url = "git@github.com:acme/skills.git";

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    await ensureBareRepo({
      storeRootDir,
      repoKey,
      url,
      runCommand: recordingRunner(calls),
    });

    expect(calls).toEqual([
      {
        command: "git",
        args: ["remote", "set-url", "origin", url],
        cwd: barePath,
      },
    ]);
  });
});

describe("fetchIntoBare", () => {
  it("runs git fetch --all --tags against the bare repo", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-bare-fetch-"));
    cleanupDirs.push(base);
    const barePath = join(base, "repo.git");
    await mkdir(barePath, { recursive: true });

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    await fetchIntoBare({ barePath, runCommand: recordingRunner(calls) });

    expect(calls).toEqual([
      {
        command: "git",
        args: ["fetch", "--all", "--tags"],
        cwd: barePath,
      },
    ]);
  });

  it("fetches an explicitly requested commit from origin", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-bare-fetch-commit-"));
    cleanupDirs.push(base);
    const barePath = join(base, "repo.git");
    const commitSha = "0123456789abcdef0123456789abcdef01234567";
    await mkdir(barePath, { recursive: true });

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    await fetchIntoBare({ barePath, commitSha, runCommand: missingCommitRunner(calls) });

    expect(calls).toEqual([
      {
        command: "git",
        args: ["fetch", "--all", "--tags"],
        cwd: barePath,
      },
      {
        command: "git",
        args: ["--git-dir", barePath, "rev-parse", "--verify", `${commitSha}^{commit}`],
        cwd: undefined,
      },
      {
        command: "git",
        args: ["fetch", "origin", commitSha],
        cwd: barePath,
      },
    ]);
  });
});

describe("resolveCommitSha", () => {
  it("runs git rev-parse against the bare repo and trims the output", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-bare-resolve-"));
    cleanupDirs.push(base);
    const barePath = join(base, "repo.git");
    await mkdir(barePath, { recursive: true });

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner: CommandRunner = async (command, args, options): Promise<CommandRunnerResult> => {
      calls.push({ command, args, cwd: options?.cwd });
      if (command === "git" && args[0] === "--git-dir") {
        return { stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const sha = await resolveCommitSha({ barePath, ref: "0123456", runCommand: runner });

    expect(sha).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(calls[0]?.args.slice(0, 2)).toEqual(["--git-dir", barePath]);
    expect(calls[0]?.args).toContain("rev-parse");
    expect(calls[0]?.args).toContain("0123456");
  });
});

describe("exportCommit", () => {
  it("archives the commit to a tar then extracts into the destination dir", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-bare-export-"));
    cleanupDirs.push(base);
    const barePath = join(base, "repo.git");
    const destDir = join(base, "export");
    const tempDir = join(base, "tmp");
    await mkdir(barePath, { recursive: true });

    const sha = "0123456789abcdef0123456789abcdef01234567";
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner: CommandRunner = async (command, args, options): Promise<CommandRunnerResult> => {
      calls.push({ command, args, cwd: options?.cwd });

      if (command === "git" && args.includes("archive")) {
        const outputFlagIndex = args.indexOf("--output");
        const tarPath = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined;
        if (tarPath) {
          await writeFile(tarPath, "FAKE_TAR");
        }
      }

      if (command === "tar" && args.includes("-x")) {
        const cFlagIndex = args.indexOf("-C");
        const target = cFlagIndex >= 0 ? args[cFlagIndex + 1] : undefined;
        if (target) {
          await mkdir(target, { recursive: true });
          await writeFile(join(target, "SKILL.md"), "# git skill\n");
        }
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await exportCommit({
      barePath,
      commitSha: sha,
      destDir,
      tempDir,
      runCommand: runner,
    });

    expect(calls[0]).toMatchObject({
      command: "git",
      cwd: undefined,
    });
    expect(calls[0]?.args.slice(0, 2)).toEqual(["--git-dir", barePath]);
    expect(calls[0]?.args).toContain("archive");
    expect(calls[0]?.args).toContain(sha);

    expect(calls[1]?.command).toBe("tar");
    expect(calls[1]?.args).toContain("-x");
    expect(calls[1]?.args).toContain(destDir);

    expect(await pathExists(join(destDir, "SKILL.md"))).toBe(true);

    const tarPaths = calls[0]?.args.slice(calls[0].args.indexOf("--output") + 1)[0];
    expect(await pathExists(tarPaths as string)).toBe(false);
  });
});

describe("prepareBareRepo", () => {
  it("clones then fetches and releases the lock when the bare repo is absent", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prepare-clone-"));
    cleanupDirs.push(base);
    const storeRootDir = join(base, "store");
    const repoKey = repoKeyFromCanonical("github.com/acme/skills");
    const url = "https://github.com/acme/skills.git";

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const { barePath } = await prepareBareRepo({
      storeRootDir,
      repoKey,
      url,
      runCommand: recordingRunner(calls),
    });

    expect(calls.map((entry) => entry.args[0])).toEqual(["clone", "fetch"]);
    expect(barePath).toBe(bareRepoPath(storeRootDir, repoKey));
    expect(await pathExists(`${barePath}.lock`)).toBe(false);
  });

  it("updates remote url then fetches and releases the lock when the bare repo exists", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prepare-update-"));
    cleanupDirs.push(base);
    const storeRootDir = join(base, "store");
    const repoKey = repoKeyFromCanonical("github.com/acme/skills");
    const barePath = bareRepoPath(storeRootDir, repoKey);
    await mkdir(barePath, { recursive: true });
    const url = "git@github.com:acme/skills.git";

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    await prepareBareRepo({
      storeRootDir,
      repoKey,
      url,
      runCommand: recordingRunner(calls),
    });

    expect(calls.map((entry) => entry.args[0])).toEqual(["remote", "fetch"]);
    expect(await pathExists(`${barePath}.lock`)).toBe(false);
  });

  it("fetches a requested commit while holding the bare repo lock", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prepare-commit-"));
    cleanupDirs.push(base);
    const storeRootDir = join(base, "store");
    const repoKey = repoKeyFromCanonical("github.com/acme/skills");
    const url = "https://github.com/acme/skills.git";
    const commitSha = "0123456789abcdef0123456789abcdef01234567";
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    await prepareBareRepo({
      storeRootDir,
      repoKey,
      url,
      commitSha,
      runCommand: missingCommitRunner(calls),
    });

    const barePath = bareRepoPath(storeRootDir, repoKey);
    expect(calls).toContainEqual({
      command: "git",
      args: ["fetch", "origin", commitSha],
      cwd: barePath,
    });
    expect(await pathExists(`${barePath}.lock`)).toBe(false);
  });

});
