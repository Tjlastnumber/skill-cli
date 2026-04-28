import { afterEach, describe, expect, it, vi } from "vitest";

const clackPrompts = vi.hoisted(() => ({
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  select: vi.fn(),
  text: vi.fn(),
}));

const { runAutoSyncProjectLockfileMock } = vi.hoisted(() => ({
  runAutoSyncProjectLockfileMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => clackPrompts);
vi.mock("../src/commands/auto-sync-project-lockfile.js", () => ({
  runAutoSyncProjectLockfile: runAutoSyncProjectLockfileMock,
}));

import * as installCommandModule from "../src/commands/install.js";
import * as installFromLockfileCommandModule from "../src/commands/install-from-lockfile.js";
import * as installInputsModule from "../src/commands/install-inputs.js";
import { ExitCode, SkillCliError } from "../src/core/errors.js";
import * as loadConfigModule from "../src/core/config/load.js";
import { runCli } from "../src/cli.js";

const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

afterEach(() => {
  vi.restoreAllMocks();
  clackPrompts.cancel.mockReset();
  clackPrompts.isCancel.mockReset();
  clackPrompts.isCancel.mockReturnValue(false);
  clackPrompts.select.mockReset();
  clackPrompts.text.mockReset();
  runAutoSyncProjectLockfileMock.mockReset();
  if (stdinIsTTYDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinIsTTYDescriptor);
  }
  if (stdoutIsTTYDescriptor) {
    Object.defineProperty(process.stdout, "isTTY", stdoutIsTTYDescriptor);
  }
  process.exitCode = undefined;
});

describe("runCli install", () => {
  it("preserves explicit flags and force for install", async () => {
    const loadConfigSpy = vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    const resolveInstallInputsSpy = vi
      .spyOn(installInputsModule, "resolveInstallInputs")
      .mockResolvedValue({
        tool: "codex",
        target: { type: "global" },
      });
    const runInstallCommandSpy = vi
      .spyOn(installCommandModule, "runInstallCommand")
      .mockResolvedValue(undefined as never);
    const runInstallFromLockfileCommandSpy = vi
      .spyOn(installFromLockfileCommandModule, "runInstallFromLockfileCommand")
      .mockResolvedValue({
        installedSources: [],
        lockfilePath: "/workspace/skills-lock.yaml",
      });

    await runCli(["node", "skill", "install", "./skills", "--tool", "codex", "--global", "--force"]);

    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
    expect(resolveInstallInputsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "codex",
        target: { type: "global" },
        configuredTools: ["codex"],
      }),
    );
    expect(runInstallCommandSpy).toHaveBeenCalledWith({
      source: "./skills",
      tool: "codex",
      target: { type: "global" },
      force: true,
    });
    expect(runInstallFromLockfileCommandSpy).not.toHaveBeenCalled();
    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
  });

  it("resolves missing install inputs before running install", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        claude: {
          globalDir: ".claude/global",
          projectDir: ".claude/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    const resolveInstallInputsSpy = vi
      .spyOn(installInputsModule, "resolveInstallInputs")
      .mockResolvedValue({
        tool: "claude",
        target: { type: "project" },
      });
    const runInstallCommandSpy = vi
      .spyOn(installCommandModule, "runInstallCommand")
      .mockResolvedValue(undefined as never);
    const runInstallFromLockfileCommandSpy = vi
      .spyOn(installFromLockfileCommandModule, "runInstallFromLockfileCommand")
      .mockResolvedValue({
        installedSources: [],
        lockfilePath: "/workspace/skills-lock.yaml",
      });

    await runCli(["node", "skill", "install", "./skills"]);

    expect(resolveInstallInputsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: undefined,
        target: undefined,
        configuredTools: ["claude", "codex"],
      }),
    );
    expect(runInstallCommandSpy).toHaveBeenCalledWith({
      source: "./skills",
      tool: "claude",
      target: { type: "project" },
      force: false,
    });
    expect(runInstallFromLockfileCommandSpy).not.toHaveBeenCalled();
    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "install",
      tool: "all",
    });
  });

  it("exits cleanly when install input resolution is cancelled", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({ cancelled: true });
    const runInstallCommandSpy = vi
      .spyOn(installCommandModule, "runInstallCommand")
      .mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "install", "./skills"]);

    expect(runInstallCommandSpy).not.toHaveBeenCalled();
    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("routes to lockfile install mode when source is omitted", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    const resolveInstallInputsSpy = vi
      .spyOn(installInputsModule, "resolveInstallInputs")
      .mockResolvedValue({
        tool: "codex",
        target: { type: "project" },
      });
    const runInstallCommandSpy = vi
      .spyOn(installCommandModule, "runInstallCommand")
      .mockResolvedValue(undefined as never);
    const runInstallFromLockfileCommandSpy = vi
      .spyOn(installFromLockfileCommandModule, "runInstallFromLockfileCommand")
      .mockResolvedValue({
        installedSources: ["./skills/alpha"],
        lockfilePath: "/workspace/skills-lock.yaml",
      });

    await runCli(["node", "skill", "install"]);

    expect(resolveInstallInputsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: undefined,
        target: undefined,
        configuredTools: ["codex"],
      }),
    );
    expect(runInstallFromLockfileCommandSpy).toHaveBeenCalledWith({
      tool: "codex",
      target: { type: "project" },
      force: false,
    });
    expect(runInstallCommandSpy).not.toHaveBeenCalled();
    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
  });

  it("routes to source install mode when source is present", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({
      tool: "codex",
      target: { type: "project" },
    });
    const runInstallCommandSpy = vi
      .spyOn(installCommandModule, "runInstallCommand")
      .mockResolvedValue(undefined as never);
    const runInstallFromLockfileCommandSpy = vi
      .spyOn(installFromLockfileCommandModule, "runInstallFromLockfileCommand")
      .mockResolvedValue({
        installedSources: ["./skills/alpha"],
        lockfilePath: "/workspace/skills-lock.yaml",
      });

    await runCli(["node", "skill", "install", "./skills"]);

    expect(runInstallCommandSpy).toHaveBeenCalledWith({
      source: "./skills",
      tool: "codex",
      target: { type: "project" },
      force: false,
    });
    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "install",
      tool: "all",
    });
    expect(runInstallFromLockfileCommandSpy).not.toHaveBeenCalled();
  });

  it("passes repeated --skill options through to source installs", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({
      tool: "codex",
      target: { type: "project" },
    });
    const runInstallCommandSpy = vi
      .spyOn(installCommandModule, "runInstallCommand")
      .mockResolvedValue(undefined as never);

    await runCli([
      "node",
      "skill",
      "install",
      "./skills",
      "--skill",
      "browser",
      "--skill",
      "debugger",
    ]);

    expect(runInstallCommandSpy).toHaveBeenCalledWith({
      source: "./skills",
      tool: "codex",
      target: { type: "project" },
      force: false,
      skills: ["browser", "debugger"],
    });
    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "install",
      tool: "all",
    });
  });

  it("rejects --skill when install source is omitted", async () => {
    const loadConfigSpy = vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    const resolveInstallInputsSpy = vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({
      tool: "codex",
      target: { type: "project" },
    });
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand");
    const runInstallFromLockfileCommandSpy = vi.spyOn(
      installFromLockfileCommandModule,
      "runInstallFromLockfileCommand",
    );
    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["node", "skill", "install", "--skill", "browser"]);

    expect(runInstallCommandSpy).not.toHaveBeenCalled();
    expect(runInstallFromLockfileCommandSpy).not.toHaveBeenCalled();
    expect(loadConfigSpy).not.toHaveBeenCalled();
    expect(resolveInstallInputsSpy).not.toHaveBeenCalled();
    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      "ERROR: The --skill option requires a source passed to 'skill install <source>'\n",
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      "Suggestion: Pass a source to 'skill install <source>' or remove --skill\n",
    );
    expect(process.exitCode).toBe(ExitCode.USER_INPUT);
  });

  it("does not auto-sync after global source installs", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({
      tool: "codex",
      target: { type: "global" },
    });
    vi.spyOn(installCommandModule, "runInstallCommand").mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "install", "./skills", "--global"]);

    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
  });

  it("does not auto-sync after custom-dir source installs", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({
      tool: "codex",
      target: { type: "dir", dir: "/tmp/skills" },
    });
    vi.spyOn(installCommandModule, "runInstallCommand").mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "install", "./skills", "--dir", "/tmp/skills"]);

    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
  });

  it("surfaces auto-sync failures after successful project source installs", async () => {
    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({
      tool: "codex",
      target: { type: "project" },
    });
    const runInstallCommandSpy = vi
      .spyOn(installCommandModule, "runInstallCommand")
      .mockResolvedValue(undefined as never);
    runAutoSyncProjectLockfileMock.mockRejectedValue(
      new SkillCliError(
        "Install succeeded but automatic lockfile sync failed",
        ExitCode.FILESYSTEM,
        "Re-run `skill lock` to regenerate the project lockfile",
      ),
    );

    await runCli(["node", "skill", "install", "./skills", "--project"]);

    expect(runInstallCommandSpy).toHaveBeenCalledWith({
      source: "./skills",
      tool: "codex",
      target: { type: "project" },
      force: false,
    });
    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "install",
      tool: "all",
    });
    expect(process.exitCode).toBe(ExitCode.FILESYSTEM);
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      "ERROR: Install succeeded but automatic lockfile sync failed\n",
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      "Suggestion: Re-run `skill lock` to regenerate the project lockfile\n",
    );
  });

  it("forwards tool all into auto-sync for project source installs", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        claude: {
          globalDir: ".claude/global",
          projectDir: ".claude/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(installInputsModule, "resolveInstallInputs").mockResolvedValue({
      tool: "all",
      target: { type: "project" },
    });
    vi.spyOn(installCommandModule, "runInstallCommand").mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "install", "./skills", "--tool", "all", "--project"]);

    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "install",
      tool: "all",
    });
  });

  it("resolves install inputs interactively end-to-end including the all tool option", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        claude: {
          globalDir: ".claude/global",
          projectDir: ".claude/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    const runInstallCommandSpy = vi
      .spyOn(installCommandModule, "runInstallCommand")
      .mockResolvedValue(undefined as never);

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    clackPrompts.select.mockResolvedValueOnce("global").mockResolvedValueOnce("all");

    await runCli(["node", "skill", "install", "./skills"]);

    expect(clackPrompts.select).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: expect.stringMatching(/install scope/i),
      }),
    );
    expect(clackPrompts.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: expect.stringMatching(/tool/i),
        options: expect.arrayContaining([
          expect.objectContaining({ value: "all", label: "all" }),
          expect.objectContaining({ value: "claude", label: "claude" }),
          expect.objectContaining({ value: "codex", label: "codex" }),
        ]),
      }),
    );
    expect(runInstallCommandSpy).toHaveBeenCalledWith({
      source: "./skills",
      tool: "all",
      target: { type: "global" },
      force: false,
    });
    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
    expect(vi.isMockFunction(installInputsModule.resolveInstallInputs)).toBe(false);
  });
});
