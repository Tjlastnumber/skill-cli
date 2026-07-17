import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { CommandRunner } from "./fetch.js";

export function repoKeyFromCanonical(repoCanonical: string): string {
  return createHash("sha256").update(repoCanonical).digest("hex");
}

export function bareRepoPath(storeRootDir: string, repoKey: string): string {
  return join(storeRootDir, "repos", repoKey);
}

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

const LOCK_POLL_MS = 100;
const LOCK_MAX_ATTEMPTS = 100;

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const pidText = (await readFile(lockPath, "utf8")).trim();
    const pid = Number(pidText);
    if (!Number.isInteger(pid)) {
      return true;
    }
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

async function acquireRepoLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        if (await isLockStale(lockPath)) {
          await rm(lockPath, { force: true });
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Could not acquire repo lock after ${LOCK_MAX_ATTEMPTS} attempts: ${lockPath}`);
}

async function withRepoLock<T>(barePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${barePath}.lock`;
  await acquireRepoLock(lockPath);
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

export async function ensureBareRepo(options: {
  storeRootDir: string;
  repoKey: string;
  url: string;
  runCommand: CommandRunner;
}): Promise<{ barePath: string }> {
  const { storeRootDir, repoKey, url, runCommand } = options;
  const barePath = bareRepoPath(storeRootDir, repoKey);

  if (!(await pathExists(barePath))) {
    await mkdir(join(storeRootDir, "repos"), { recursive: true });
    await runCommand("git", ["clone", "--bare", url, barePath]);
  } else {
    await runCommand("git", ["remote", "set-url", "origin", url], { cwd: barePath });
  }

  return { barePath };
}

export async function fetchIntoBare(options: {
  barePath: string;
  runCommand: CommandRunner;
}): Promise<void> {
  const { barePath, runCommand } = options;
  await runCommand("git", ["fetch", "--all", "--tags"], { cwd: barePath });
}

export async function resolveCommitSha(options: {
  barePath: string;
  ref: string;
  runCommand: CommandRunner;
}): Promise<string> {
  const { barePath, ref, runCommand } = options;
  const result = await runCommand("git", ["--git-dir", barePath, "rev-parse", ref]);
  return result.stdout.trim();
}

export async function prepareBareRepo(options: {
  storeRootDir: string;
  repoKey: string;
  url: string;
  runCommand: CommandRunner;
}): Promise<{ barePath: string }> {
  const { storeRootDir, repoKey, url, runCommand } = options;
  const barePath = bareRepoPath(storeRootDir, repoKey);

  await mkdir(join(storeRootDir, "repos"), { recursive: true });

  return withRepoLock(barePath, async () => {
    await ensureBareRepo({ storeRootDir, repoKey, url, runCommand });
    await fetchIntoBare({ barePath, runCommand });
    return { barePath };
  });
}

export async function exportCommit(options: {
  barePath: string;
  commitSha: string;
  destDir: string;
  tempDir: string;
  runCommand: CommandRunner;
}): Promise<void> {
  const { barePath, commitSha, destDir, tempDir, runCommand } = options;

  await mkdir(destDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });

  const tarPath = join(tempDir, `export-${commitSha}.tar`);

  await runCommand("git", [
    "--git-dir",
    barePath,
    "archive",
    "--format=tar",
    "--output",
    tarPath,
    commitSha,
  ]);
  await runCommand("tar", ["-x", "-f", tarPath, "-C", destDir]);
  await rm(tarPath, { force: true });
}
