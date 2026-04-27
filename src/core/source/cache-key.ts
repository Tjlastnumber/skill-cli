import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { SourceDescriptor } from "./types.js";

function normalizedSourceText(descriptor: SourceDescriptor): string {
  switch (descriptor.kind) {
    case "local":
      return `local:${descriptor.path}`;
    case "git":
      return `git:${descriptor.url}#${descriptor.ref ?? "HEAD"}`;
    case "npm":
      return `npm:${descriptor.spec}`;
  }
}

export function createSourceCacheKey(descriptor: SourceDescriptor): string {
  return createHash("sha256").update(normalizedSourceText(descriptor)).digest("hex");
}

export function createGitStoreKey(input: { repoCanonical: string; commitSha: string }): string {
  return createHash("sha256")
    .update(`git:${input.repoCanonical}@${input.commitSha}`)
    .digest("hex");
}

async function updateHashForDirectory(
  hash: ReturnType<typeof createHash>,
  rootDir: string,
  currentDir: string,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const relativePath = relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      hash.update(`dir:${relativePath}\n`);
      await updateHashForDirectory(hash, rootDir, fullPath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      hash.update(`symlink:${relativePath}->${await readlink(fullPath)}\n`);
      continue;
    }

    if (entry.isFile()) {
      hash.update(`file:${relativePath}\n`);
      hash.update(await readFile(fullPath));
      hash.update("\n");
      continue;
    }

    const stats = await lstat(fullPath);
    hash.update(`other:${relativePath}:${stats.mode}:${stats.size}\n`);
  }
}

export async function createSourceSnapshotKey(sourceDir: string): Promise<string> {
  const rootDir = resolve(sourceDir);
  const hash = createHash("sha256");
  hash.update("skill-cli-source-snapshot\n");
  await updateHashForDirectory(hash, rootDir, rootDir);
  return hash.digest("hex");
}
