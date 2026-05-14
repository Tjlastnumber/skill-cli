import { describe, expect, it, vi } from "vitest";

import { ExitCode, SkillCliError } from "../src/core/errors.js";
import { parseExplicitRemoveTargetFlags, resolveRemoveInputs } from "../src/commands/remove-inputs.js";

describe("parseExplicitRemoveTargetFlags", () => {
  it("returns undefined when no explicit target was provided", () => {
    expect(parseExplicitRemoveTargetFlags({})).toBeUndefined();
  });

  it("preserves an explicit global target", () => {
    expect(parseExplicitRemoveTargetFlags({ global: true })).toEqual({ type: "global" });
  });

  it("preserves an explicit project target", () => {
    expect(parseExplicitRemoveTargetFlags({ project: true })).toEqual({ type: "project" });
  });

  it("preserves an explicit custom directory target", () => {
    expect(parseExplicitRemoveTargetFlags({ dir: "./custom" })).toEqual({
      type: "dir",
      dir: "./custom",
    });
  });

  it("throws when multiple explicit targets are provided", () => {
    expect(() => parseExplicitRemoveTargetFlags({ global: true, project: true })).toThrow(
      /Exactly one target may be specified/,
    );
  });
});

describe("resolveRemoveInputs", () => {
  it("defaults remove target to project and infers the matching tool", async () => {
    const resolved = await resolveRemoveInputs({
      bundleName: undefined,
      skillName: "browser",
      tool: undefined,
      target: undefined,
      configuredTools: ["opencode"],
      stdinIsTTY: false,
      stdoutIsTTY: false,
      findMatchingTools: async () => ["opencode"],
      findSkillCandidates: async () => [
        {
          tool: "opencode",
          bundleName: "skills-source",
          skillName: "browser",
          target: { type: "project" },
          targetRoot: "/repo/.opencode/skills",
          linkPath: "/repo/.opencode/skills/browser",
        },
      ],
    });

    expect(resolved).toEqual({
      bundleName: undefined,
      skillName: "browser",
      selectedSkill: {
        tool: "opencode",
        bundleName: "skills-source",
        skillName: "browser",
        target: { type: "project" },
        targetRoot: "/repo/.opencode/skills",
        linkPath: "/repo/.opencode/skills/browser",
      },
      target: { type: "project" },
      tool: "opencode",
    });
  });

  it("requires exactly one of bundle name or skill name", async () => {
    await expect(
      resolveRemoveInputs({
        bundleName: "alpha-bundle",
        skillName: "browser",
        tool: "opencode",
        target: { type: "project" },
        configuredTools: ["opencode"],
        stdinIsTTY: false,
        stdoutIsTTY: false,
        findMatchingTools: async () => ["opencode"],
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
    });
  });

  it("requires one of bundle name or skill name", async () => {
    await expect(
      resolveRemoveInputs({
        bundleName: undefined,
        skillName: undefined,
        tool: "opencode",
        target: { type: "project" },
        configuredTools: ["opencode"],
        stdinIsTTY: false,
        stdoutIsTTY: false,
        findMatchingTools: async () => ["opencode"],
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
    });
  });

  it("accepts an explicit valid tool without inferring", async () => {
    const findMatchingTools = vi.fn(async () => ["opencode"]);

    const resolved = await resolveRemoveInputs({
      bundleName: "alpha-bundle",
      skillName: undefined,
      tool: "opencode",
      target: { type: "global" },
      configuredTools: ["opencode", "codex"],
      stdinIsTTY: false,
      stdoutIsTTY: false,
      findMatchingTools,
    });

    expect(resolved).toEqual({
      bundleName: "alpha-bundle",
      skillName: undefined,
      target: { type: "global" },
      tool: "opencode",
    });
    expect(findMatchingTools).toHaveBeenCalledWith({
      bundleName: "alpha-bundle",
      skillName: undefined,
      target: { type: "global" },
    });
  });

  it("rejects an explicit tool when the named bundle is not installed", async () => {
    const findMatchingTools = vi.fn(async () => []);

    await expect(
      resolveRemoveInputs({
        bundleName: "missing-bundle",
        skillName: undefined,
        tool: "opencode",
        target: { type: "project" },
        configuredTools: ["opencode", "codex"],
        stdinIsTTY: false,
        stdoutIsTTY: false,
        findMatchingTools,
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
      message: "No matching installed tool found in project scope",
    });

    expect(findMatchingTools).toHaveBeenCalledWith({
      bundleName: "missing-bundle",
      skillName: undefined,
      target: { type: "project" },
    });
  });

  it("rejects an invalid explicit tool", async () => {
    await expect(
      resolveRemoveInputs({
        bundleName: "alpha-bundle",
        skillName: undefined,
        tool: "not-a-tool",
        target: { type: "project" },
        configuredTools: ["opencode"],
        stdinIsTTY: false,
        stdoutIsTTY: false,
        findMatchingTools: async () => ["opencode"],
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
      message: "Invalid tool selected",
    });
  });

  it("throws when no matching tools are found for inference", async () => {
    await expect(
      resolveRemoveInputs({
        bundleName: undefined,
        skillName: "browser",
        tool: undefined,
        target: undefined,
        configuredTools: ["opencode"],
        stdinIsTTY: false,
        stdoutIsTTY: false,
        findMatchingTools: async () => [],
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
    });
  });

  it("prompts for tool when multiple matching tools are found", async () => {
    const prompt = {
      select: vi.fn().mockResolvedValue("opencode"),
      cancel: vi.fn(),
      isCancel: vi.fn().mockReturnValue(false),
    };

    const resolved = await resolveRemoveInputs({
      bundleName: undefined,
      skillName: "browser",
      tool: undefined,
      target: undefined,
      configuredTools: ["opencode", "codex"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
      findMatchingTools: async () => ["codex", "opencode"],
      findSkillCandidates: async () => [
        {
          tool: "opencode",
          bundleName: "alpha-source",
          skillName: "browser",
          target: { type: "project" },
          targetRoot: "/repo/.opencode/skills",
          linkPath: "/repo/.opencode/skills/browser",
        },
      ],
    });

    expect(prompt.select).toHaveBeenCalledTimes(1);
    expect(resolved.tool).toBe("opencode");
    expect(resolved.target).toEqual({ type: "project" });
  });

  it("prompts again for duplicate skill candidates after interactive tool selection", async () => {
    const prompt = {
      select: vi
        .fn()
        .mockResolvedValueOnce("opencode")
        .mockResolvedValueOnce("opencode::/repo-two/.opencode/skills::beta-source::browser"),
      cancel: vi.fn(),
      isCancel: vi.fn().mockReturnValue(false),
    };
    const output = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const findSkillCandidates = vi.fn(async ({ tool }: { tool: string }) => {
      if (tool === "opencode") {
        return [
          {
            tool: "opencode",
            bundleName: "alpha-source",
            skillName: "browser",
            target: { type: "project" },
            targetRoot: "/repo-one/.opencode/skills",
            linkPath: "/repo-one/.opencode/skills/browser",
          },
          {
            tool: "opencode",
            bundleName: "beta-source",
            skillName: "browser",
            target: { type: "project" },
            targetRoot: "/repo-two/.opencode/skills",
            linkPath: "/repo-two/.opencode/skills/browser",
          },
        ];
      }

      return [];
    });

    const resolved = await resolveRemoveInputs({
      bundleName: undefined,
      skillName: "browser",
      tool: undefined,
      target: undefined,
      configuredTools: ["opencode", "codex"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
      output,
      findMatchingTools: async () => ["codex", "opencode"],
      findSkillCandidates,
    });

    expect(prompt.select).toHaveBeenCalledTimes(2);
    expect(prompt.select).toHaveBeenNthCalledWith(1, {
      message: "Select tool",
      options: [
        { value: "codex", label: "codex" },
        { value: "opencode", label: "opencode" },
      ],
    });
    expect(prompt.select).toHaveBeenNthCalledWith(2, {
      message: "Select skill",
      options: [
        {
          value: "opencode::/repo-one/.opencode/skills::alpha-source::browser",
          label: "browser (alpha-source -> /repo-one/.opencode/skills)",
        },
        {
          value: "opencode::/repo-two/.opencode/skills::beta-source::browser",
          label: "browser (beta-source -> /repo-two/.opencode/skills)",
        },
      ],
    });
    expect(findSkillCandidates).toHaveBeenCalledWith({
      skillName: "browser",
      tool: "opencode",
      target: { type: "project" },
    });
    expect(output.info).toHaveBeenCalledWith("Matching installed skills: 2");
    expect(resolved).toEqual({
      bundleName: undefined,
      skillName: "browser",
      tool: "opencode",
      target: { type: "project" },
      selectedSkill: {
        tool: "opencode",
        bundleName: "beta-source",
        skillName: "browser",
        target: { type: "project" },
        targetRoot: "/repo-two/.opencode/skills",
        linkPath: "/repo-two/.opencode/skills/browser",
      },
    });
  });

  it("auto-selects a single matching skill candidate", async () => {
    const resolved = await resolveRemoveInputs({
      bundleName: undefined,
      skillName: "browser",
      tool: undefined,
      target: undefined,
      configuredTools: ["opencode"],
      stdinIsTTY: false,
      stdoutIsTTY: false,
      findMatchingTools: async () => ["opencode"],
      findSkillCandidates: async () => [
        {
          tool: "opencode",
          bundleName: "alpha-source",
          skillName: "browser",
          target: { type: "project" },
          targetRoot: "/repo/.opencode/skills",
          linkPath: "/repo/.opencode/skills/browser",
        },
      ],
    });

    expect(resolved).toEqual({
      bundleName: undefined,
      skillName: "browser",
      target: { type: "project" },
      tool: "opencode",
      selectedSkill: {
        tool: "opencode",
        bundleName: "alpha-source",
        skillName: "browser",
        target: { type: "project" },
        targetRoot: "/repo/.opencode/skills",
        linkPath: "/repo/.opencode/skills/browser",
      },
    });
  });

  it("prompts for a duplicate-name skill candidate in interactive mode", async () => {
    const prompt = {
      select: vi.fn().mockResolvedValue("opencode::/repo-two/.opencode/skills::beta-source::browser"),
      cancel: vi.fn(),
      isCancel: vi.fn().mockReturnValue(false),
    };
    const output = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const resolved = await resolveRemoveInputs({
      bundleName: undefined,
      skillName: "browser",
      tool: undefined,
      target: undefined,
      configuredTools: ["opencode"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
      output,
      findMatchingTools: async () => ["opencode"],
      findSkillCandidates: async () => [
        {
          tool: "opencode",
          bundleName: "alpha-source",
          skillName: "browser",
          target: { type: "project" },
          targetRoot: "/repo-one/.opencode/skills",
          linkPath: "/repo-one/.opencode/skills/browser",
        },
        {
          tool: "opencode",
          bundleName: "beta-source",
          skillName: "browser",
          target: { type: "project" },
          targetRoot: "/repo-two/.opencode/skills",
          linkPath: "/repo-two/.opencode/skills/browser",
        },
      ],
    });

    expect(output.info).toHaveBeenCalledWith("Matching installed skills: 2");
    expect(output.info).toHaveBeenCalledWith("  browser");
    expect(output.info).toHaveBeenCalledWith("    bundle: alpha-source");
    expect(output.info).toHaveBeenCalledWith("    target: /repo-one/.opencode/skills");
    expect(output.info).toHaveBeenCalledWith("    bundle: beta-source");
    expect(output.info).toHaveBeenCalledWith("    target: /repo-two/.opencode/skills");
    expect(prompt.select).toHaveBeenCalledTimes(1);
    expect(resolved.selectedSkill).toEqual({
      tool: "opencode",
      bundleName: "beta-source",
      skillName: "browser",
      target: { type: "project" },
      targetRoot: "/repo-two/.opencode/skills",
      linkPath: "/repo-two/.opencode/skills/browser",
    });
  });

  it("fails in non-interactive mode when duplicate-name skill candidates exist", async () => {
    const output = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(
      resolveRemoveInputs({
        bundleName: undefined,
        skillName: "browser",
        tool: undefined,
        target: undefined,
        configuredTools: ["opencode"],
        stdinIsTTY: false,
        stdoutIsTTY: false,
        output,
        findMatchingTools: async () => ["opencode"],
        findSkillCandidates: async () => [
          {
            tool: "opencode",
            bundleName: "alpha-source",
            skillName: "browser",
            target: { type: "project" },
            targetRoot: "/repo-one/.opencode/skills",
            linkPath: "/repo-one/.opencode/skills/browser",
          },
          {
            tool: "opencode",
            bundleName: "beta-source",
            skillName: "browser",
            target: { type: "project" },
            targetRoot: "/repo-two/.opencode/skills",
            linkPath: "/repo-two/.opencode/skills/browser",
          },
        ],
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
      message: "Multiple matching installed skills found. Re-run interactively or pass a narrower target",
    });

    expect(output.info).toHaveBeenCalledWith("Matching installed skills: 2");
  });

  it("fails in non-interactive mode when multiple tools match", async () => {
    await expect(
      resolveRemoveInputs({
        bundleName: undefined,
        skillName: "browser",
        tool: undefined,
        target: undefined,
        configuredTools: ["opencode", "codex"],
        stdinIsTTY: false,
        stdoutIsTTY: false,
        findMatchingTools: async () => ["codex", "opencode"],
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
    });
  });
});
