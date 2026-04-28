import {
  syncProjectLockfile,
  type SyncProjectLockfileResult,
  type SyncProjectLockfileRuntimeOptions,
} from "../core/lockfile/sync-project-lockfile.js";

export interface LockCommandArgs {
  tool: string;
  output?: string;
  force: boolean;
}

export type LockRuntimeOptions = SyncProjectLockfileRuntimeOptions;
export type LockCommandResult = SyncProjectLockfileResult;

export async function runLockCommand(
  args: LockCommandArgs,
  runtime: LockRuntimeOptions = {},
): Promise<LockCommandResult> {
  return await syncProjectLockfile(
    {
      tool: args.tool,
      mode: "manual",
      outputPath: args.output,
      force: args.force,
    },
    runtime,
  );
}
