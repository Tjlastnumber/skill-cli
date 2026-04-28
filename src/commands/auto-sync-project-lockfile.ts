import {
  syncProjectLockfile,
  type SyncProjectLockfileResult,
  type SyncProjectLockfileRuntimeOptions,
} from "../core/lockfile/sync-project-lockfile.js";
import { ExitCode, SkillCliError } from "../core/errors.js";

export interface AutoSyncProjectLockfileArgs extends SyncProjectLockfileRuntimeOptions {
  action: "install" | "remove";
  tool: string;
}

export type AutoSyncProjectLockfileResult = SyncProjectLockfileResult;

const AUTO_SYNC_SUGGESTION = "Re-run `skill lock` to regenerate the project lockfile";

function buildFailureMessage(action: AutoSyncProjectLockfileArgs["action"]): string {
  return `${action === "install" ? "Install" : "Remove"} succeeded but automatic lockfile sync failed`;
}

function buildSuggestion(suggestion?: string): string {
  return suggestion ? `${suggestion}. ${AUTO_SYNC_SUGGESTION}` : AUTO_SYNC_SUGGESTION;
}

export async function runAutoSyncProjectLockfile(
  args: AutoSyncProjectLockfileArgs,
): Promise<AutoSyncProjectLockfileResult> {
  try {
    return await syncProjectLockfile(
      {
        tool: "all",
        mode: "auto",
        force: false,
      },
      {
        cwd: args.cwd,
        homeDir: args.homeDir,
        env: args.env,
        output: args.output,
      },
    );
  } catch (error) {
    const message = buildFailureMessage(args.action);

    if (error instanceof SkillCliError) {
      throw new SkillCliError(message, error.exitCode, buildSuggestion(error.suggestion), error);
    }

    throw new SkillCliError(message, ExitCode.INTERNAL, AUTO_SYNC_SUGGESTION, error);
  }
}
