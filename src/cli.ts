#!/usr/bin/env node

import { Command, CommanderError } from "commander";
import { pathToFileURL } from "node:url";

import { runDoctorCommand } from "./commands/doctor.js";
import { runInstallCommand } from "./commands/install.js";
import { parseExplicitInstallTargetFlags, resolveInstallInputs } from "./commands/install-inputs.js";
import { runListCommand } from "./commands/list.js";
import { runPruneCommand } from "./commands/prune.js";
import { runRegisterCommand } from "./commands/register.js";
import { runRelinkCommand } from "./commands/relink.js";
import { runRemoveCommand } from "./commands/remove.js";
import { runSearchCommand } from "./commands/search.js";
import type { InstallTarget } from "./commands/types.js";
import { loadConfig } from "./core/config/load.js";
import { ExitCode, SkillCliError } from "./core/errors.js";
import { createOutput } from "./core/output.js";

interface TargetOptions {
  global?: boolean;
  project?: boolean;
  dir?: string;
}

function parseTargetOptions(options: TargetOptions): InstallTarget {
  const count = Number(Boolean(options.global)) + Number(Boolean(options.project)) + Number(Boolean(options.dir));

  if (count !== 1) {
    throw new SkillCliError(
      "Exactly one target must be specified: --global, --project, or --dir <path>",
      ExitCode.USER_INPUT,
    );
  }

  if (options.global) {
    return { type: "global" };
  }

  if (options.project) {
    return { type: "project" };
  }

  return { type: "dir", dir: options.dir };
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const output = createOutput();

  const program = new Command();
  program
    .name("skill")
    .description("Install and manage local skills across coding tools")
    .version("0.1.1")
    .exitOverride();

  program
    .command("search")
    .argument("<github-repo-url>", "Public GitHub repository root URL")
    .option("--filter <text>", "Filter skills by name, description, or path")
    .action(async (repositoryUrl: string, options: { filter?: string }) => {
      await runSearchCommand({ repositoryUrl, filter: options.filter });
    });

  program
    .command("install")
    .argument("<source>", "Source path, git URL, or package name")
    .option("--tool <tool>", "Target tool id or 'all'")
    .option("--global", "Install into tool global directory")
    .option("--project", "Install into tool project directory")
    .option("--dir <path>", "Install into custom directory")
    .option("--force", "Replace existing target entries")
    .action(async (source: string, options: TargetOptions & { tool?: string; force?: boolean }) => {
      const config = await loadConfig();
      const resolved = await resolveInstallInputs({
        tool: options.tool,
        target: parseExplicitInstallTargetFlags(options),
        configuredTools: Object.keys(config.tools),
        stdinIsTTY: Boolean(process.stdin.isTTY),
        stdoutIsTTY: Boolean(process.stdout.isTTY),
      });

      if ("cancelled" in resolved) {
        process.exitCode = 0;
        return;
      }

      await runInstallCommand({
        source,
        tool: resolved.tool,
        force: Boolean(options.force),
        target: resolved.target,
      });
    });

  program
    .command("remove")
    .argument("<bundle-name>", "Bundle name to remove")
    .requiredOption("--tool <tool>", "Target tool id or 'all'")
    .option("--global", "Remove from tool global directory")
    .option("--project", "Remove from tool project directory")
    .option("--dir <path>", "Remove from custom directory")
    .action(async (bundleName: string, options: TargetOptions & { tool: string }) => {
      await runRemoveCommand({
        bundleName,
        tool: options.tool,
        target: parseTargetOptions(options),
      });
    });

  program
    .command("list")
    .option("--tool <tool>", "Target tool id or 'all'", "all")
    .option("--dir <path>", "Also scan custom directory")
    .option("--expand", "Show bundle members")
    .option("--status <status>", "Filter by status: all|managed|discovered", "all")
    .action(async (options: { tool: string; dir?: string; expand?: boolean; status?: string }) => {
      await runListCommand({
        tool: options.tool,
        dir: options.dir,
        expand: Boolean(options.expand),
        status: (options.status ?? "all") as "all" | "managed" | "discovered",
      });
    });

  program
    .command("register")
    .option("--tool <tool>", "Target tool id or 'all'", "all")
    .option("--dir <path>", "Also scan custom directory")
    .action(async (options: { tool: string; dir?: string }) => {
      await runRegisterCommand({ tool: options.tool, dir: options.dir });
    });

  program
    .command("doctor")
    .option("--tool <tool>", "Target tool id or 'all'", "all")
    .option("--dir <path>", "Also scan custom directory")
    .option("--repair-registry", "Backfill registry from discovered installed skills")
    .action(async (options: { tool: string; dir?: string; repairRegistry?: boolean }) => {
      await runDoctorCommand({
        tool: options.tool,
        dir: options.dir,
        repairRegistry: Boolean(options.repairRegistry),
      });
    });

  program
    .command("relink")
    .option("--tool <tool>", "Target tool id or 'all'", "all")
    .action(async (options: { tool: string }) => {
      await runRelinkCommand({ tool: options.tool });
    });

  program.command("prune").action(async () => {
    await runPruneCommand();
  });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof SkillCliError) {
      output.error(error.message);
      if (error.suggestion) {
        output.info(`Suggestion: ${error.suggestion}`);
      }
      process.exitCode = error.exitCode;
      return;
    }

    if (error instanceof CommanderError) {
      process.exitCode = (error as CommanderError).exitCode;
      return;
    }

    output.error(error instanceof Error ? error.message : "Unexpected error");
    process.exitCode = ExitCode.INTERNAL;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
