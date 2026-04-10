import { mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

import { SourceError } from "../errors.js";
import { createSourceCacheKey, createSourceSnapshotKey } from "./cache-key.js";
import type { SourceDescriptor } from "./types.js";

export interface CommandRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunnerOptions {
  cwd?: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions,
) => Promise<CommandRunnerResult>;

export interface FetchSourceOptions {
  tempDir: string;
  runCommand?: CommandRunner;
}

export interface FetchSourceResult {
  sourceDir: string;
  cacheKey: string;
}

function isCommitSha(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{7,40}$/i.test(value));
}

function toSlug(text: string): string {
  return text.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function parsePackedTarballName(stdout: string): string | undefined {
  const trimmed = stdout.trim();

  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        for (let index = parsed.length - 1; index >= 0; index -= 1) {
          const item = parsed[index];
          if (
            item &&
            typeof item === "object" &&
            "filename" in item &&
            typeof item.filename === "string" &&
            item.filename.endsWith(".tgz")
          ) {
            return item.filename;
          }
        }
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        "filename" in parsed &&
        typeof parsed.filename === "string" &&
        parsed.filename.endsWith(".tgz")
      ) {
        return parsed.filename;
      }
    } catch {
      // fall back to line-based parse for non-JSON output
    }
  }

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.replace(/^['"]|['"]$/g, "");
    if (line.endsWith(".tgz")) {
      return line;
    }
  }

  return undefined;
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: CommandRunnerOptions = {},
): Promise<CommandRunnerResult> {
  return await new Promise<CommandRunnerResult>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (exitCode) => {
      const code = exitCode ?? 1;
      if (code !== 0) {
        rejectPromise(
          new SourceError(
            `Command failed: ${command} ${args.join(" ")}`,
            stderr || stdout || "Unknown command failure",
          ),
        );
        return;
      }

      resolvePromise({
        stdout,
        stderr,
        exitCode: code,
      });
    });
  });
}

async function validateLocalDirectory(pathToCheck: string): Promise<void> {
  const stats = await stat(pathToCheck).catch(() => {
    throw new SourceError(`Local source path does not exist: ${pathToCheck}`);
  });

  if (!stats.isDirectory()) {
    throw new SourceError(`Local source path is not a directory: ${pathToCheck}`);
  }
}

export async function fetchSource(
  descriptor: SourceDescriptor,
  options: FetchSourceOptions,
): Promise<FetchSourceResult> {
  const runCommand = options.runCommand ?? defaultCommandRunner;
  await ensureDirectory(options.tempDir);

  const requestCacheKey = createSourceCacheKey(descriptor);

  if (descriptor.kind === "local") {
    await validateLocalDirectory(descriptor.path);
    return {
      sourceDir: descriptor.path,
      cacheKey: await createSourceSnapshotKey(descriptor.path),
    };
  }

  if (descriptor.kind === "git") {
    const sourceDir = join(options.tempDir, `git-${toSlug(requestCacheKey.slice(0, 16))}`);

    if (isCommitSha(descriptor.ref)) {
      await runCommand("git", ["clone", descriptor.url, sourceDir]);
      await runCommand("git", ["checkout", descriptor.ref], { cwd: sourceDir });
    } else {
      const args = descriptor.ref
        ? ["clone", "--depth", "1", "--branch", descriptor.ref, descriptor.url, sourceDir]
        : ["clone", "--depth", "1", descriptor.url, sourceDir];

      await runCommand("git", args);
    }

    return {
      sourceDir,
      cacheKey: await createSourceSnapshotKey(sourceDir),
    };
  }

  const packDir = join(options.tempDir, `pack-${toSlug(requestCacheKey.slice(0, 16))}`);
  const sourceDir = join(options.tempDir, `npm-${toSlug(requestCacheKey.slice(0, 16))}`);

  await ensureDirectory(packDir);
  await ensureDirectory(sourceDir);

  const packResult = await runCommand("npm", [
    "pack",
    descriptor.spec,
    "--pack-destination",
    packDir,
    "--json",
  ]);

  const tarballName = parsePackedTarballName(packResult.stdout);
  if (!tarballName) {
    throw new SourceError(
      `Unable to determine packed tarball name for npm source: ${descriptor.spec}`,
    );
  }

  const tarballPath = resolve(packDir, tarballName);

  await runCommand("tar", [
    "-xzf",
    tarballPath,
    "-C",
    sourceDir,
    "--strip-components=1",
  ]);

  return {
    sourceDir,
    cacheKey: await createSourceSnapshotKey(sourceDir),
  };
}
