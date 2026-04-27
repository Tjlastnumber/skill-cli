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

interface SourceInstallFailure {
  message: string;
  error: unknown;
}

const aggregateFailureSuggestion = "Review the source failure output above and re-run after fixing the reported sources";

interface GroupedLockfileSource {
  source: string;
  names: string[];
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof FilesystemError && Boolean(error.cause && typeof error.cause === "object" && "code" in error.cause && error.cause.code === "ENOENT");
}

function resolveAggregateExitCode(failures: SourceInstallFailure[]): ExitCode {
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

function groupLockfileSources(lockfile: { skills: Array<{ source: string; name: string }> }): GroupedLockfileSource[] {
  const groups = new Map<string, string[]>();

  for (const skill of lockfile.skills) {
    const current = groups.get(skill.source) ?? [];
    if (current.includes("*")) {
      continue;
    }

    if (skill.name === "*") {
      groups.set(skill.source, ["*"]);
      continue;
    }

    if (!current.includes(skill.name)) {
      current.push(skill.name);
    }
    groups.set(skill.source, current);
  }

  return Array.from(groups.entries()).map(([source, names]) => ({ source, names }));
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

  if (lockfile.skills.length === 0) {
    throw new SkillCliError(
      `Lockfile has no skill entries: ${lockfilePath}`,
      ExitCode.USER_INPUT,
      "Add skill entries to skills-lock.yaml or regenerate it with 'skill lock'",
    );
  }

  const failures: SourceInstallFailure[] = [];
  const groupedSources = groupLockfileSources(lockfile);

  for (const group of groupedSources) {
    try {
      await runInstallCommand(
        {
          source: await normalizeInstallSource(group.source, lockfileRoot, homeDir),
          tool: args.tool,
          target: args.target,
          force: args.force,
          skills: group.names,
        },
        {
          ...runtime,
          cwd,
          homeDir,
        },
      );
    } catch (error) {
      failures.push({
        message: `${group.source}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error,
      });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      output.warn(failure.message);
    }

    throw new SkillCliError(
      `Failed to install ${failures.length} source(s) from skills-lock.yaml`,
      resolveAggregateExitCode(failures),
      aggregateFailureSuggestion,
    );
  }

  return {
    lockfilePath,
    installedSources: groupedSources.map((group) => group.source),
  };
}
