import { afterEach, describe, expect, it, vi } from "vitest";

import * as lockCommandModule from "../src/commands/lock.js";
import { ExitCode, SkillCliError } from "../src/core/errors.js";
import { runCli } from "../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("runCli lock", () => {
  it("forwards lock command options to runLockCommand", async () => {
    const runLockCommandSpy = vi
      .spyOn(lockCommandModule, "runLockCommand")
      .mockResolvedValue(undefined as never);

    await runCli([
      "node",
      "skill",
      "lock",
      "--tool",
      "opencode",
      "--output",
      "./custom-lock.yaml",
      "--force",
    ]);

    expect(runLockCommandSpy).toHaveBeenCalledTimes(1);
    expect(runLockCommandSpy).toHaveBeenCalledWith({
      tool: "opencode",
      output: "./custom-lock.yaml",
      force: true,
    });
  });

  it("surfaces SkillCliError from runLockCommand with user-input exit code", async () => {
    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(lockCommandModule, "runLockCommand").mockRejectedValue(
      new SkillCliError("lock failed", ExitCode.USER_INPUT),
    );

    await runCli(["node", "skill", "lock"]);

    expect(process.exitCode).toBe(ExitCode.USER_INPUT);
    expect(stderrWriteSpy).toHaveBeenCalledWith("ERROR: lock failed\n");
  });

  it("surfaces existing-lockfile errors with suggestion and user-input exit code", async () => {
    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(lockCommandModule, "runLockCommand").mockRejectedValue(
      new SkillCliError(
        "Lockfile already exists: /tmp/skills-lock.yaml",
        ExitCode.USER_INPUT,
        "Re-run with --force to overwrite the existing lockfile",
      ),
    );

    await runCli(["node", "skill", "lock"]);

    expect(process.exitCode).toBe(ExitCode.USER_INPUT);
    expect(stderrWriteSpy).toHaveBeenCalledWith("ERROR: Lockfile already exists: /tmp/skills-lock.yaml\n");
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      "Suggestion: Re-run with --force to overwrite the existing lockfile\n",
    );
  });
});
