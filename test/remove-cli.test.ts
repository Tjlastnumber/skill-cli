import { afterEach, describe, expect, it, vi } from "vitest";

const { runAutoSyncProjectLockfileMock } = vi.hoisted(() => ({
  runAutoSyncProjectLockfileMock: vi.fn(),
}));

vi.mock("../src/commands/auto-sync-project-lockfile.js", () => ({
  runAutoSyncProjectLockfile: runAutoSyncProjectLockfileMock,
}));

import * as removeCommandModule from "../src/commands/remove.js";
import { runCli } from "../src/cli.js";
import { ExitCode, SkillCliError } from "../src/core/errors.js";

afterEach(() => {
  vi.restoreAllMocks();
  runAutoSyncProjectLockfileMock.mockReset();
  process.exitCode = undefined;
});

describe("runCli remove", () => {
  it("auto-syncs after successful project removals", async () => {
    const runRemoveCommandSpy = vi
      .spyOn(removeCommandModule, "runRemoveCommand")
      .mockResolvedValue(undefined);

    await runCli(["node", "skill", "remove", "alpha-skill", "--tool", "codex", "--project"]);

    expect(runRemoveCommandSpy).toHaveBeenCalledWith({
      bundleName: "alpha-skill",
      tool: "codex",
      target: { type: "project" },
    });
    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "remove",
      tool: "all",
    });
  });

  it("does not auto-sync after global removals", async () => {
    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue(undefined);

    await runCli(["node", "skill", "remove", "alpha-skill", "--tool", "codex", "--global"]);

    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
  });

  it("forwards tool all into auto-sync for project removals", async () => {
    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue(undefined);

    await runCli(["node", "skill", "remove", "alpha-skill", "--tool", "all", "--project"]);

    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "remove",
      tool: "all",
    });
  });

  it("surfaces auto-sync failures after successful project removals", async () => {
    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue(undefined);
    runAutoSyncProjectLockfileMock.mockRejectedValue(
      new SkillCliError(
        "Remove succeeded but automatic lockfile sync failed",
        ExitCode.FILESYSTEM,
        "Re-run `skill lock` to regenerate the project lockfile",
      ),
    );

    await runCli(["node", "skill", "remove", "alpha-skill", "--tool", "codex", "--project"]);

    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "remove",
      tool: "all",
    });
    expect(process.exitCode).toBe(ExitCode.FILESYSTEM);
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      "ERROR: Remove succeeded but automatic lockfile sync failed\n",
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      "Suggestion: Re-run `skill lock` to regenerate the project lockfile\n",
    );
  });
});
