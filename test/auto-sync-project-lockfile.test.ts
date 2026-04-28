import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExitCode, SkillCliError } from "../src/core/errors.js";

const { syncProjectLockfileMock } = vi.hoisted(() => ({
  syncProjectLockfileMock: vi.fn(),
}));

vi.mock("../src/core/lockfile/sync-project-lockfile.js", () => ({
  syncProjectLockfile: syncProjectLockfileMock,
}));

import { runAutoSyncProjectLockfile } from "../src/commands/auto-sync-project-lockfile.js";

describe("runAutoSyncProjectLockfile", () => {
  beforeEach(() => {
    syncProjectLockfileMock.mockReset();
  });

  it("always delegates to syncProjectLockfile in full-project auto mode", async () => {
    const env = { HOME: "/tmp/home" };
    const result = { outputPath: "/repo/skills-lock.yaml", bundleCount: 2 };
    syncProjectLockfileMock.mockResolvedValue(result);

    await expect(
      runAutoSyncProjectLockfile({
        action: "install",
        tool: "opencode",
        cwd: "/repo",
        homeDir: "/home/user",
        env,
      }),
    ).resolves.toBe(result);

    expect(syncProjectLockfileMock).toHaveBeenCalledWith(
      {
        tool: "all",
        mode: "auto",
        force: false,
      },
      {
        cwd: "/repo",
        homeDir: "/home/user",
        env,
        output: undefined,
      },
    );
  });

  it("wraps install sync SkillCliError failures with a rerun suggestion", async () => {
    syncProjectLockfileMock.mockRejectedValue(
      new SkillCliError("existing error", ExitCode.FILESYSTEM, "Check file permissions"),
    );

    await expect(
      runAutoSyncProjectLockfile({
        action: "install",
        tool: "opencode",
      }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      message: "Install succeeded but automatic lockfile sync failed",
      exitCode: ExitCode.FILESYSTEM,
      suggestion: "Check file permissions. Re-run `skill lock` to regenerate the project lockfile",
    });
  });

  it("wraps remove sync SkillCliError failures with the remove-specific message", async () => {
    syncProjectLockfileMock.mockRejectedValue(new SkillCliError("existing error", ExitCode.USER_INPUT));

    await expect(
      runAutoSyncProjectLockfile({
        action: "remove",
        tool: "opencode",
      }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      message: "Remove succeeded but automatic lockfile sync failed",
      exitCode: ExitCode.USER_INPUT,
      suggestion: expect.stringContaining("skill lock"),
    });
  });

  it("wraps unexpected sync failures as internal errors", async () => {
    syncProjectLockfileMock.mockRejectedValue(new Error("boom"));

    await expect(
      runAutoSyncProjectLockfile({
        action: "install",
        tool: "opencode",
      }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      message: "Install succeeded but automatic lockfile sync failed",
      exitCode: ExitCode.INTERNAL,
      suggestion: expect.stringContaining("skill lock"),
    });
  });
});
