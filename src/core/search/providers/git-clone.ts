import { spawn } from "node:child_process";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SourceError } from "../../errors.js";
import { describeGitRepository } from "../../source/git-repo.js";
import { discoverLocalSearchSkills } from "../discover-local-skills.js";
import type { SearchProviderResult, SearchSourceDescriptor } from "../types.js";

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface GitCloneSearchProviderOptions {
  createTempDir?: () => Promise<string>;
  cleanupTempDir?: (tempDir: string) => Promise<void>;
  runCommand?: (command: string, args: string[]) => Promise<CommandResult>;
  discoverLocalSearchSkills?: typeof discoverLocalSearchSkills;
}

export class GitCloneSearchProvider {
  constructor(private readonly options: GitCloneSearchProviderOptions = {}) {}

  async search(source: SearchSourceDescriptor): Promise<SearchProviderResult> {
    const tempDir = await (this.options.createTempDir?.() ?? mkdtemp(join(tmpdir(), "skill-cli-search-")));
    const runCommand = this.options.runCommand ?? defaultRunCommand;
    const discover = this.options.discoverLocalSearchSkills ?? discoverLocalSearchSkills;
    const repositoryIdentity = describeGitRepository(source.cloneUrl);
    const rootSkillName = source.github?.repo ?? repositoryIdentity.bundleName;

    try {
      try {
        await runCommand("git", ["clone", "--depth", "1", source.cloneUrl, tempDir]);
      } catch (error) {
        throw sanitizeCloneError(error, source.cloneUrl);
      }

      const skills = await discover(tempDir, { rootSkillName });

      return {
        repository: {
          displayName: source.github?.displayName ?? repositoryIdentity.canonical,
          sourceLabel: source.github ? source.raw : repositoryIdentity.canonical,
          webUrl: source.github?.webUrl,
          resolvedBy: "git-clone",
        },
        skills,
      };
    } finally {
      await (this.options.cleanupTempDir?.(tempDir) ?? rm(tempDir, { recursive: true, force: true }));
    }
  }
}

function sanitizeCloneError(error: unknown, cloneUrl: string): unknown {
  if (!(error instanceof SourceError)) {
    return error;
  }

  const redactedCloneUrl = redactCloneUrl(cloneUrl);
  if (redactedCloneUrl === cloneUrl) {
    return error;
  }

  return new SourceError(
    error.message.replaceAll(cloneUrl, redactedCloneUrl),
    error.suggestion?.replaceAll(cloneUrl, redactedCloneUrl),
    error.cause,
  );
}

function redactCloneUrl(cloneUrl: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cloneUrl);
  } catch {
    return cloneUrl;
  }

  if ((parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") || !parsedUrl.username) {
    return cloneUrl;
  }

  parsedUrl.username = "";
  parsedUrl.password = "";
  return parsedUrl.toString();
}

async function defaultRunCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
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
