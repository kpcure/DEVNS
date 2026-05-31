# DEVNS 中文说明

DEVNS 是一个面向长时间 Agent 开发的本地优先 harness。它让 Agent 持续交付小粒度、可验证、可审查的功能点，同时让人通过 HTML 看板和结构化报告来掌控进度、风险和最终质量。

核心思路是：

- JSON 是对 Agent 和 LLM 友好的事实源，生成快、可编辑、可被前端消费。
- Markdown 用来沉淀项目知识、设计理由、踩坑记录和长期上下文。
- HTML 看板是人的控制台，用来查看功能点、证据、风险、diff 和 morning review。
- 每次 Agent 只领取一个已批准 RFC 的功能点，完成实现、验证、记录证据并提交一个 commit。
- Stop hook 负责在 Agent 自然结束后接管流程：检查当前功能点状态、触发只读审查、决定是否继续领取下一个功能点。
- DEVNS 不提供 LLM Provider，也不试图替代 Claude Code、Codex、Cursor 等宿主；它提供可插拔的流程、状态、提示词、hook、review agent 契约和 dashboard。

## 解决什么问题

当 Agent 可以连续跑几个小时甚至一整晚时，真正难的不是让它写代码，而是让它不漂移、可审查、可恢复，并且让人第二天早上能高效理解它到底改了什么。

DEVNS 重点解决这些问题：

- 功能点不能只靠一句话开跑，必须先经过 RFC 澄清和人工批准。
- Agent 每次只做一个功能点，避免多个目标混在一起。
- 验证证据必须显式关联需求或验收标准，build/lint 不能冒充产品行为验证。
- Review Agent 默认只读，只输出发现和建议，不直接改代码。
- Morning review 不是 commit 列表，而是按功能点展示意图、diff、证据、风险、审查状态和建议动作。
- 项目知识不是流水账，而是沉淀“为什么这么设计”和“哪里踩过坑”。

## 首次使用

当前可以从 GitHub 安装到目标项目。注意：npm 上未加 scope 的 `devns` 名称属于另一个项目，不要在未安装本项目时直接执行一次性 `npx devns`。

```sh
npm install --save-dev github:kpcure/DEVNS
npx devns doctor
```

在本仓库本地开发时，也可以使用：

```sh
npm run devns -- doctor
```

如果目标项目还没有 DEVNS 工作区，先初始化：

```sh
npx devns init --project-name "Example Project" --project-description "Describe the migration or feature goal."
```

然后让 Agent 使用 `devns-init` skill 发现候选功能点。候选功能点还不能直接开发，必须先通过 `devns-rfc` skill 做需求澄清，并由人批准 RFC 后才会进入可领取队列。

已有 DEVNS 工作区时，可以让 Agent 使用 `devns-run` skill，或者运行：

```sh
npm run devns -- run --json
```

打开人类看板：

```sh
npm run devns -- dashboard
```

默认访问：

```text
http://127.0.0.1:5173/
```

## 推荐工作流

1. 人通过 doctor、dashboard 或 DEVNS skill 启动流程。
2. Discovery 根据项目背景和仓库内容生成候选功能点。
3. RFC 阶段澄清需求、验收标准、验证方式、风险和未知项。
4. 人批准 RFC 后，功能点进入 ready 队列。
5. Agent 读取 `AGENTS.md` 和 `.devns/` 状态，只领取一个 ready 功能点。
6. Agent 实现功能、运行静态和动态验证、记录 evidence。
7. 只读 Review Agent 或人工审查补充 review evidence。
8. `devns complete` 记录 commit、diff、证据质量和执行历史。
9. Stop hook 在 Agent 自然结束后检查状态，并按策略决定是否继续下一个功能点。
10. 人通过 morning review 查看整晚结果，而不是逐个 commit 猜意图。

## 重要目录

- `AGENTS.md`：Agent 进入仓库后的最短操作协议。
- `.devns/devns.config.json`：项目 DEVNS 配置。
- `.devns/features.json`：功能点事实源。
- `.devns/candidates.json`：候选功能点。
- `.devns/rfcs/`：RFC 记录。
- `.devns/history/`：执行历史和详细证据。
- `.devns/project.md`：项目背景。
- `apps/dashboard/`：本地 HTML review plane。
- `docs/feature-schema.md`：功能点和证据 schema。
- `docs/prompt-contracts.md`：提示词契约。
- `docs/review-agent-contract.md`：只读 Review Agent 契约。
- `docs/claude-code-hooks.md`：Claude Code Stop hook 集成说明。
- `docs/codex-plugin.md`：Codex 插件说明。
- `plugins/claude-code/devns/`：Claude Code 插件包。
- `plugins/codex/devns/`：Codex 插件包。
- `packages/core/src/harness/`：核心 harness 逻辑。

## Agent 操作边界

Agent 进入项目后应优先读取 `AGENTS.md`。这个文件必须保持短小，只放入口规则和指向 `.devns/` 的索引，避免让每次上下文都被长文档吃掉。

关键规则：

- 如果 `.devns/devns.config.json` 或 `.devns/features.json` 缺失，先初始化。
- 如果没有 active 功能点，只能领取已批准 RFC 的 ready 功能点。
- 如果存在 `in_progress` 功能点，必须先读取 RFC、历史、证据和最近状态再继续。
- 不允许根据一句候选描述直接实现。
- 一个功能点对应一个 commit。
- 详细执行记录放进 `.devns/history/`，`features.json` 只保留精简状态和索引。

## 验证和审查

DEVNS 把 evidence 当作一等公民。每条 evidence 可以声明：

- 覆盖了哪些 acceptance criteria。
- 覆盖了哪些 requirement。
- 属于 command、static review、browser smoke、human review 或 review agent 等验证类型。

默认策略是保守的：

- build/lint/security 只能证明工程检查通过，不能自动证明产品行为正确。
- UI、浏览器、人工判断、审查类验收标准必须有对应类型的 evidence。
- 缺少 review evidence 时，morning review 不会直接建议 approve。
- `devns complete` 在需要人工或审查证据时会阻止 approved completion，除非显式使用 `--force`。

## 插件和 Hook

DEVNS 作为插件和本地 runtime 工作，不要求用户配置新的 LLM Provider。

Claude Code、Codex 等宿主负责运行 Agent；DEVNS 负责提供：

- 插件 manifest 和 skill 入口。
- Stop hook 脚本和策略。
- review agent 的只读输入输出契约。
- RFC、需求澄清、实现 handoff、history 写入等 prompt contract。
- dashboard 和 morning review 的数据结构。

Stop hook 不是 Agent 主动调用的命令，而是宿主在 Agent 自然结束一轮 query 后触发的 hook。DEVNS 的 hook 逻辑会读取结构化状态、检查是否需要 review、是否可以 complete、是否继续领取下一个功能点。

## 本地开发

安装依赖：

```sh
npm install
```

构建：

```sh
npm run build
```

运行完整 smoke：

```sh
npm run smoke
```

校验当前 DEVNS 状态：

```sh
npm run devns -- validate
```

启动 dashboard：

```sh
npm run devns -- dashboard
```

## 许可证

DEVNS 使用 Apache License 2.0。详见 `LICENSE` 和 `NOTICE`。
