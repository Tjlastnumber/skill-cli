# @tjlastnumber/skill-cli

[English](README.md) | 简体中文

`skill-cli` 是一个本地 CLI，用于在多个 AI 编程工具之间统一安装和管理 skills。它使用“统一本地存储 + 目标目录软链接”的方式，避免重复拷贝和状态不一致。

适合同时使用多个 agent CLI 的开发者，希望用一套命令完成安装、查看、修复、清理。

## 为什么做这个项目

不同编程工具的 skill 目录结构不一致，同一套 skills 往往要重复安装、重复维护，容易出错。

`skill-cli` 通过以下方式解决这个问题：

- 使用统一的本地 store 保存技能内容
- 各工具目录只创建软链接，不复制文件
- 使用 bundle 级注册表追踪安装状态

## 功能特性

- 支持从 `git`、`npm`、本地路径安装 skills
- 支持 `claude-code`、`codex`、`opencode`
- 支持安装目标：`--global`、`--project`、`--dir <path>`
- bundle 级注册表（包含成员 skill）
- `list` 支持 `managed` / `discovered` 状态
- `register` 支持将已安装但未登记的 skills 回填到注册表
- `doctor` / `relink` 支持检测和修复
- `prune` 支持清理未引用的 store 缓存

## 安装

```bash
npm i -g @tjlastnumber/skill-cli
```

安装后验证：

```bash
skill --help
```

## 快速开始

安装一个 bundle（以 OpenCode 项目级安装为例）：

```bash
skill install git@github.com:obra/superpowers.git --tool opencode --project
```

查看已安装 bundle：

```bash
skill list --tool opencode
skill list --tool opencode --expand
```

把“已安装但未登记”的内容写入注册表：

```bash
skill register --tool opencode
skill doctor --tool opencode --repair-registry
```

## 命令说明

| 命令 | 说明 |
| --- | --- |
| `skill install <source> --tool <tool|all> (--global\|--project\|--dir <path>)` | 从 git/npm/本地源安装 bundle |
| `skill list [--tool <tool|all>] [--dir <path>] [--status all\|managed\|discovered] [--expand]` | 查看 bundle 列表，并可额外扫描自定义目录 |
| `skill remove <bundle-name> --tool <tool|all> (--global\|--project\|--dir <path>)` | 删除已安装 bundle |
| `skill register [--tool <tool|all>] [--dir <path>]` | 扫描并回填注册表，也可包含自定义目录 |
| `skill doctor [--tool <tool|all>] [--dir <path>] [--repair-registry]` | 检查状态、报告断链，并可选修复注册表 |
| `skill relink [--tool <tool|all>]` | 重建缺失或损坏的软链接 |
| `skill prune` | 清理未引用的 store 缓存 |

## 工作原理

1. 解析 source（`git` / `npm` / 本地路径）
2. 拉取并持久化到本地 store（默认 `~/.skills`）
3. 按工具规则发现 skill 成员（默认 `**/SKILL.md`）
4. 在目标工具目录创建软链接
5. 在 `registry.json` 中记录 bundle 与成员关系

## 支持工具与默认目录

- `claude-code`
  - global: `~/.claude/skills`
  - project: `.claude/skills`
- `codex`
  - global: `~/.codex/skills`
  - project: `.codex/skills`
- `opencode`
  - global: `~/.config/opencode/skills`
  - project: `.opencode/skills`

可通过配置扩展更多工具。

## 本地开发

```bash
pnpm install
pnpm test
pnpm build
pnpm verify:manual
```

将本地二进制命令链接到全局：

```bash
pnpm link --global
skill --help
```

## 项目状态

项目处于持续迭代中。核心命令链路（install/list/remove/register/doctor/relink/prune）已实现并有测试覆盖。

## 贡献指南

欢迎提 Issue 和 PR。若是较大改动，建议先开 Issue 对齐设计与范围。

## 许可证

本项目使用 MIT License，详见 `LICENSE` 文件。
