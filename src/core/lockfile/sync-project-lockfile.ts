import { lstat, rm } from "node:fs/promises";
import { homedir } from "node:os";

import { ExitCode, SkillCliError } from "../errors.js";
import { createOutput, type Output } from "../output.js";
import { resolvePath } from "../path-utils.js";
import { buildProjectLockfile } from "./build-project-lockfile.js";
import { resolveProjectSkillsLockfilePath } from "./path.js";
import { writeSkillsLockfile } from "./write.js";

export interface SyncProjectLockfileArgs {
  tool: string;
  mode: "manual" | "auto";
  outputPath?: string;
  force: boolean;
}

export interface SyncProjectLockfileRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface SyncProjectLockfileResult {
  outputPath: string;
  bundleCount: number;
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await lstat(pathValue);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function syncProjectLockfile(
  args: SyncProjectLockfileArgs,
  runtime: SyncProjectLockfileRuntimeOptions = {},
): Promise<SyncProjectLockfileResult> {
  const resolvedRuntime: Required<SyncProjectLockfileRuntimeOptions> = {
    cwd: runtime.cwd ?? process.cwd(),
    homeDir: runtime.homeDir ?? homedir(),
    env: runtime.env ?? process.env,
    output: runtime.output ?? createOutput(),
  };

  const outputPath =
    args.mode === "manual" && args.outputPath
      ? resolvePath(args.outputPath, resolvedRuntime.cwd, resolvedRuntime.homeDir)
      : await resolveProjectSkillsLockfilePath(resolvedRuntime.cwd);

  const built = await buildProjectLockfile({
    cwd: resolvedRuntime.cwd,
    homeDir: resolvedRuntime.homeDir,
    env: resolvedRuntime.env,
    tool: args.tool,
  });

  if (built.unresolvableBundleCount > 0) {
    throw new SkillCliError(
      `Cannot generate project lockfile: ${built.unresolvableBundleCount} managed project bundle${built.unresolvableBundleCount === 1 ? " has" : "s have"} unresolvable source provenance`,
      ExitCode.USER_INPUT,
      "Reinstall the affected project skill source before re-running `skill lock`",
    );
  }

  if (built.lockedSkills.length === 0) {
    if (args.mode === "manual" && built.eligibleBundleCount === 0) {
      throw new SkillCliError(
        "No eligible managed project bundles found for lockfile generation",
        ExitCode.USER_INPUT,
      );
    }

    if (args.mode === "auto") {
      if (await pathExists(outputPath)) {
        await rm(outputPath, { force: true });
        resolvedRuntime.output.info(`Removed ${outputPath} because no eligible managed project bundles remain`);
      }

      return {
        outputPath,
        bundleCount: 0,
      };
    }

    if (!args.force && (await pathExists(outputPath))) {
      throw new SkillCliError(
        `Lockfile already exists: ${outputPath}`,
        ExitCode.USER_INPUT,
        "Re-run with --force to overwrite the existing lockfile",
      );
    }

    await writeSkillsLockfile(outputPath, {
      version: 2,
      skills: [],
    });

    resolvedRuntime.output.info(`Wrote 0 locked skill entries to ${outputPath}`);

    return {
      outputPath,
      bundleCount: 0,
    };
  }

  if (args.mode === "manual" && !args.force && (await pathExists(outputPath))) {
    throw new SkillCliError(
      `Lockfile already exists: ${outputPath}`,
      ExitCode.USER_INPUT,
      "Re-run with --force to overwrite the existing lockfile",
    );
  }

  await writeSkillsLockfile(outputPath, {
    version: 2,
    skills: built.lockedSkills,
  });

  resolvedRuntime.output.info(
    `Wrote ${built.lockedSkills.length} locked skill entr${built.lockedSkills.length === 1 ? "y" : "ies"} to ${outputPath}`,
  );

  return {
    outputPath,
    bundleCount: built.bundleCount,
  };
}
