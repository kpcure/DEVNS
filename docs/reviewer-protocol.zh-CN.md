# DEVNS 评审 Agent 协议

评审 Agent 是 DEVNS review lane 后面的只读 critic。它不改文件、不安装依赖、不提交代码，只读取 review packet，输出符合 `tools/schema/lane-result.schema.json` 的 JSON。

## 输入

DEVNS 在运行 `type: "agent"` 的 lane 前会生成 review packet，并通过环境变量注入上下文：

- `DEVNS_FEATURE_ID`：当前 feature id。
- `DEVNS_REVIEW_PACKET`：JSON packet 路径。
- `DEVNS_REVIEW_PROMPT`：面向 LLM 的 Markdown prompt 路径。
- `DEVNS_DIFF_BASE`：实现提交或 diff base。
- `DEVNS_REPO`：仓库根目录。

Codex 宿主下，`devns init --host codex` 会准备：

- `.devns/adapters/code-review.codex.sh`
- `.devns/lanes/code-review.json`

运行方式是：

```sh
npm run devns -- lanes run --feature <feature-id> --write --json
```

这个命令会先生成 review packet/prompt，再调用 adapter。adapter 使用只读 Codex worker 输出 lane-result JSON，并设置 `DEVNS_STOP_COMMAND=true`，避免嵌套 Codex review 过程递归触发项目 Stop Hook。

Stop Hook 也可以在 `hooks.stop.reviewAgent.mode = "run_missing"` 时自动补跑缺失的只读 Review Agent lane。这里仍然只有一个 Stop Hook：它先运行缺失的 `code-review` lane，写入 evidence/history 和 reviewDecision，然后基于更新后的状态统一返回 allow/block。不要把状态检查和评审检查拆成两个同事件 hook，因为宿主可能并发执行它们，导致一个 hook 要继续修、另一个 hook 要认领下一个需求的冲突。

packet 包含 RFC、验收标准、证据质量、已有 evidence、执行历史、项目规则、Git status 和 bounded diff。评审者必须基于这些字段判断，不能凭空补充仓库外事实。

## 输出

stdout 必须包含一个 lane-result JSON 对象，字段以 `tools/schema/lane-result.schema.json` 为准。关键字段：

- `findings`：按严重度排序的问题列表。
- `scores`：可选的五维 0–1 分数：`correctness`、`requirementCoverage`、`scope`、`security`、`test`。
- `evidence`：评审确实读取了哪些 packet/diff/命令证据。
- `artifacts`：必须包含可追溯 artifact，例如 review packet 路径。
- `recommendedActions`：下一步修复或人工审查动作。

每个 blocking finding 必须尽量带：

- `file`
- `line`
- `category`
- `confidence`
- `evidence`，其中 diff evidence 的 summary 应引用或概括 packet diff 中可定位的片段。

## 裁决规则

评审 Agent 可以给出自己的 `decision`，但 DEVNS 不采信它作为最终裁决。DEVNS 会重新计算：

- high-confidence、evidence-backed 的 error finding 在 blocking lane 中判为 `block`。
- error、low-confidence finding 或 high-confidence warning 判为 `needs_human_review`。
- warning 判为 `warn`。
- 无 finding 且有 grounded evidence/artifact 才能 `allow`。
- 无 finding、无 evidence 的空头放行会降级为 `needs_human_review`。

如果 finding 没有用 file/line 接到 packet diff，DEVNS 会把可阻塞 finding 降级为低置信 warning，避免 critic 幻觉直接阻塞。

## 独立性

approved completion 需要独立评审证据：

- evidence 的 `actor` 必须不同于实现者。
- evidence 必须有 `artifactRefs`。
- evidence 类型必须是 `review_agent`、`human_review`、`browser_smoke` 或 review/human/browser 类 evidence。

实现者自盖章、没有 packet artifact 的评审、或纯口头 approval 都不能完成 approved 状态，除非人显式 `--force --reason`。
