import { dirname } from "node:path";
import { homedir } from "node:os";

import { runInstallCommand, type InstallRuntimeOptions } from "./install.js";
import type { InstallTarget } from "./types.js";
import { ExitCode, FilesystemError, SkillCliError } from "../core/errors.js";
import { loadSkillsLockfile } from "../core/lockfile/load.js";
import { resolveProjectSkillsLockfilePath } from "../core/lockfile/path.js";
import { createOutput } from "../core/output.js";
import { parseSource } from "../core/source/parse.js";

export interface InstallFromLockfileCommandArgs {
  tool: string;
  target: InstallTarget;
  force: boolean;
}

export interface InstallFromLockfileCommandResult {
  lockfilePath: string;
  installedSources: string[];
}

interface BundleInstallFailure {
  message: string;
  error: unknown;
}

const aggregateFailureSuggestion = "Review the bundle failure output above and re-run after fixing the reported sources";

function isMissingFileError(error: unknown): boolean {
  return error instanceof FilesystemError && Boolean(error.cause && typeof error.cause === "object" && "code" in error.cause && error.cause.code === "ENOENT");
}

function resolveAggregateExitCode(failures: BundleInstallFailure[]): ExitCode {
  if (failures.length === 0) {
    return ExitCode.OK;
  }

  const skillCliFailures = failures.filter((failure) => failure.error instanceof SkillCliError);
  if (skillCliFailures.length !== failures.length) {
    return ExitCode.INTERNAL;
  }

  if (skillCliFailures.some((failure) => failure.error instanceof SkillCliError && failure.error.exitCode === ExitCode.INTERNAL)) {
    return ExitCode.INTERNAL;
  }

  const [firstFailure] = skillCliFailures;
  if (!firstFailure || !(firstFailure.error instanceof SkillCliError)) {
    return ExitCode.SOURCE;
  }

  const sharedExitCode = firstFailure.error.exitCode;
  return skillCliFailures.every(
    (failure) => failure.error instanceof SkillCliError && failure.error.exitCode === sharedExitCode,
  )
    ? sharedExitCode
    : ExitCode.SOURCE;
}

async function normalizeInstallSource(source: string, cwd: string, homeDir: string): Promise<string> {
  const descriptor = await parseSource(source, { cwd, homeDir });
  return descriptor.kind === "local" ? descriptor.path : source;
}

export async function runInstallFromLockfileCommand(
  args: InstallFromLockfileCommandArgs,
  runtime: InstallRuntimeOptions = {},
): Promise<InstallFromLockfileCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const output = runtime.output ?? createOutput();
  const homeDir = runtime.homeDir ?? homedir();
  const lockfilePath = await resolveProjectSkillsLockfilePath(cwd);
  const lockfileRoot = dirname(lockfilePath);

  const lockfile = await loadSkillsLockfile(lockfilePath).catch((error) => {
    if (isMissingFileError(error)) {
      throw new SkillCliError(
        `Missing lockfile: ${lockfilePath}`,
        ExitCode.USER_INPUT,
        "Run 'skill lock' in this project, or pass a source to 'skill install <source>'",
      );
    }

    throw error;
  });

  if (lockfile.bundles.length === 0) {
    throw new SkillCliError(
      `Lockfile has no bundle sources: ${lockfilePath}`,
      ExitCode.USER_INPUT,
      "Add bundle sources to skills-lock.yaml or regenerate it with 'skill lock'",
    );
  }

  const failures: BundleInstallFailure[] = [];

  for (const bundle of lockfile.bundles) {
    try {
      await runInstallCommand(
        {
          source: await normalizeInstallSource(bundle.source, lockfileRoot, homeDir),
          tool: args.tool,
          target: args.target,
          force: args.force,
        },
        {
          ...runtime,
          cwd,
          homeDir,
        },
      );
    } catch (error) {
      failures.push({
        message: `${bundle.source}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error,
      });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      output.warn(failure.message);
    }

    throw new SkillCliError(
      `Failed to install ${failures.length} bundle(s) from skills-lock.yaml`,
      resolveAggregateExitCode(failures),
      aggregateFailureSuggestion,
    );
  }

  return {
    lockfilePath,
    installedSources: lockfile.bundles.map((bundle) => bundle.source),
  };
}
