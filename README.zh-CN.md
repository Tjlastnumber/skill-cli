# @tjlastnumber/skill-cli

[English](README.md) | 简体中文

`skill-cli` 是一个本地 CLI，用于在多个 AI 编程工具之间统一安装和管理 skills。它使用“统一本地存储 + 目标目录软链接”的方式，避免重复拷贝和状态不一致。

适合同时使用多个 agent CLI 的开发者，希望用一套命令完成安装、查看、恢复、清理。

## 为什么做这个项目

不同编程工具的 skill 目录结构不一致，同一套 skills 往往要重复安装、重复维护，容易出错。

`skill-cli` 通过以下方式解决这个问题：

- 使用统一的本地 store 保存技能内容
- 各工具目录只创建软链接，不复制文件
- 基于当前软链接 bundle 的 live 扫描结果推导安装状态
- 用 `skills-lock.yaml` 记录项目所需的 skill source，作为跨机器复现的期望状态

## 功能特性

- 支持从 `git`、`npm`、本地路径安装 skills
- 支持通过 `skill install --skill <name>` 按 skill 名称安装，或用 `--skill '*'` 安装全部 skill
- 支持通过 `skill lock` 从当前项目的 managed project 安装生成 skill 级 `skills-lock.yaml` v2
- 支持在执行 `skill install <source> --project` 和 `skill remove <bundle-name> --project` 后自动同步 `skills-lock.yaml`
- 支持在省略 `source` 时通过 `skill install` 从 `skills-lock.yaml` 批量安装所有锁定 source
- 支持直接搜索公开 GitHub 仓库中的根目录与嵌套 skills，无需克隆
- 支持 `claude-code`、`codex`、`opencode`
- 支持安装目标：`--global`、`--project`、`--dir <path>`
- `list` 中的 `managed` / `discovered` 来源于当前 live 扫描结果
- 项目级期望状态与恢复路径来自 `skills-lock.yaml`
- `doctor` 支持检测 live 安装状态、项目漂移和 source provenance 问题
- `prune` 支持清理未引用的 store 缓存，并可用可重复的 `--dir <path>` 保护仍在使用的自定义目录安装

`git` 安装会先把请求的 branch、tag 或远端 `HEAD` 解析到具体 commit，再写入 `~/.skills/store`，因此同一个仓库的同一个 commit 只会存一份，可被不同项目复用。

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

按名称只安装一个已发现的 skill（`'*'` 表示全部 skill，shell 中请加引号）：

```bash
skill install git@github.com:obra/superpowers.git --tool opencode --project --skill using-superpowers
skill install git@github.com:obra/superpowers.git --tool opencode --project --skill '*'
```

对同一个 `source`、同一个 tool 和 target 多次执行按名称安装时，会累积已选 skill，而不是用后一次选择覆盖前一次选择。

这类项目级安装成功后，也会自动创建或更新 `skills-lock.yaml`。

根据当前项目中已安装的 managed project 内容手动重建锁文件：

```bash
skill lock
```

从当前项目根目录下的 `skills-lock.yaml` 安装：

```bash
skill install --tool opencode --project
```

这种基于 lockfile 的安装会读取 `skills-lock.yaml`，但不会重写它。

删除一个 managed project bundle，并自动同步锁文件：

```bash
skill remove superpowers --tool opencode --project
```

不全局安装 CLI 时，也可以这样执行同一流程：

```bash
npx @tjlastnumber/skill-cli install --tool opencode --project
```

查看已安装 bundle：

```bash
skill list --tool opencode
skill list --tool opencode --expand
```

搜索公开 GitHub 仓库默认分支中的 skills，包括仓库根目录 `SKILL.md` 和嵌套 skill 文件：

```bash
skill search https://github.com/owner/repo
```

按 skill 名称、描述或路径进行不区分大小写的子串匹配筛选：

```bash
skill search https://github.com/owner/repo --filter browser
```

## 命令说明

| 命令 | 说明 |
| --- | --- |
| `skill search <github-repo-url> [--filter <text>]` | 搜索公开 GitHub 仓库默认分支中的仓库根目录 `SKILL.md` 与嵌套 skill 文件，无需克隆；`--filter` 对 skill 名称、描述和路径进行不区分大小写的子串匹配 |
| `skill install [source] [--skill <name>]... [--tool <tool-or-all>] [三选一目标：--global / --project / --dir <path>]` | 当传入 `source` 时从 git/npm/本地源安装单个 source，并可选按 skill 名称筛选；若为 `--project` 安装，则成功后会自动创建或更新 `skills-lock.yaml`；省略 `source` 时从 `skills-lock.yaml` 中按 source 分组执行安装，但不会重写该文件 |
| `skill lock [--tool <tool-or-all>] [--output <path>] [--force]` | 根据当前项目中 live 扫描识别出的 managed project skills 手动生成或重建 skill 级 `skills-lock.yaml` v2 |
| `skill list [--tool <tool-or-all>] [--status <all,managed,discovered>] [--expand]` | 查看 bundle 列表，并可展开成员 skill；`managed` / `discovered` 来源于当前 live 扫描 |
| `skill remove <bundle-name> --tool <tool-or-all>（三选一目标：--global / --project / --dir <path>）` | 删除已安装 bundle；若为 `--project` 删除，则会自动更新默认 `skills-lock.yaml`，并在没有符合条件的 managed project skills 时删除它 |
| `skill doctor [--tool <tool-or-all>] [--dir <path>]` | 检查当前 live 安装状态，对照 `skills-lock.yaml` 报告项目漂移，并提示无法恢复 source provenance 的 managed project bundle |
| `skill prune [--dir <path>]...` | 清理未引用的 store 缓存；可重复传入 `--dir`，在清理时保护仍在使用的自定义目录安装 |

当 `skill install` 在交互式终端中运行且缺少安装输入时，会按以下顺序提示：先选择安装范围；如果范围是 `--dir`，再输入自定义目录路径；最后选择工具。工具选择支持已配置的工具 id 和 `all`。

在非交互环境中，缺少必填安装输入时不会触发提示，而是直接返回 user-input 错误。

## 锁文件

`skill lock` 是手动重建锁文件的命令。它默认会在项目根目录写入 `skills-lock.yaml`。它只会导出同时满足以下条件的 skill 条目：

- 安装在当前项目的 `project` 目标下
- 在当前项目 live 扫描中被识别为 managed
- 仍然在当前项目扫描中存在且健康

`skill install <source> --project` 在安装成功后，会自动创建或更新项目根目录下默认的 `skills-lock.yaml`。

`skill remove <bundle-name> --project` 在删除成功后，会自动更新项目根目录下默认的 `skills-lock.yaml`。如果已经没有符合条件的 managed project skills，则会删除这个自动同步的默认锁文件。

当 `skill install` 省略 `source` 参数时，会从项目根目录读取 `skills-lock.yaml`，先按 `source` 分组，再按顺序安装每个 source，但不会重写该文件。

不再兼容 lockfile v1。旧文件需要通过 `skill lock --force` 重新生成。

生成出的 lockfile 结构如下：

```yaml
version: 2
skills:
  - source: git@github.com:obra/superpowers.git#0123456789abcdef0123456789abcdef01234567
    name: "*"
  - source: "@acme/skills@1.2.3"
    name: browser
  - source: ./skills/local-bundle
    name: debugger
```

说明：

- `name: "*"` 表示“安装该 source 下发现的全部 skills”
- 自动生成的本地 source 必须位于项目根目录内，才能被写成项目相对路径
- `skills-lock.yaml` 中的相对 source 会以项目根目录为基准解析，不受你当前所在子目录影响
- 当不存在符合条件的 managed project skills 时，`skill lock` 在手动模式下会报错；自动项目同步则会删除现有默认锁文件，若默认锁文件本就不存在，则保持不写入
- 当 managed project bundle 仍存在但其 source provenance 已无法恢复时，`skill lock` 与自动项目同步会直接失败，而不是静默重写或删除锁文件；`skill doctor` 会显式报告这类 provenance 问题

## 工作原理

1. 解析 source（`git` / `npm` / 本地路径）
2. 对 `git` 源先把请求的 ref 解析为远端具体 commit SHA
3. 拉取并持久化到本地 store（默认 `~/.skills`）
4. 按工具规则发现 skill 成员（默认 `**/SKILL.md`）
5. 在目标工具目录创建软链接
6. 基于当前 live 扫描结果推导 `managed` / `discovered` 状态

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

项目处于持续迭代中。核心命令链路（install/list/remove/lock/doctor/prune）已实现并有测试覆盖。

## 贡献指南

欢迎提 Issue 和 PR。若是较大改动，建议先开 Issue 对齐设计与范围。

## 许可证

本项目使用 MIT License，详见 `LICENSE` 文件。
