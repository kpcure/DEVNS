# DEVNS Solidification Analysis

本文记录 1.0 之后继续加固 DEVNS 的调研判断和当前落地进展。目标不是追新框架，而是筛选适合 DEVNS 的成熟实践，把它们变成可验证的本地控制面能力。

## 调研依据

- Claude Code subagents: <https://code.claude.com/docs/en/sub-agents>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Codex subagents: <https://developers.openai.com/codex/subagents>
- OpenAI agent evals: <https://platform.openai.com/docs/guides/agent-evals>
- OpenAI evals and graders: <https://platform.openai.com/docs/guides/evals>, <https://platform.openai.com/docs/guides/graders>

## 适合 DEVNS 的技术点

### 1. Main Orchestrator + Focused Subagents

官方宿主都在支持更明确的 subagent 分工。Claude Code 的 subagent 适合把探索、实现、审查隔离到独立上下文；Codex 的 custom agent 适合显式派发实现、探索、review worker。

DEVNS 应采用的方式：

- 主 agent 只做队列、RFC、证据、review、commit 编排。
- feature worker 只实现一个已批准 RFC。
- review worker 只读，输出 `lane-result` JSON。
- Stop hook 只做安全网，不做正常长循环。

这已经与 `docs/orchestrator-mode.md`、`docs/review-agent-contract.md` 和 init 安装的 host subagents 对齐。后续要继续增强的是实际 review packet 的可评分性和 prompt 校准，而不是再拆更多 hook。

### 2. Eval Dataset + Grader-Style Gates

OpenAI 的 agent eval 指南把 trace、grader、dataset、eval run 作为 agent 质量闭环。DEVNS 是本地 harness，不应强依赖云端 eval API，但应采用同一思想：

- 用 T1 deterministic fixtures 保护控制面门禁。
- 用 T2 frozen review packets 校准 review-agent prompt 和 adapter。
- 用 T3 seed repositories 做端到端 pass^k、成本和稳定性评估。
- 每个 case 明确 expected decision、reason、mode、generality level。
- 每个 mode 尽量有 clean/trap 配对，计算 precision、recall、F1。

本轮已落地：

- `evidence_quality` 进入 T1 eval schema 和 runner，并新增 `M4_evidence_quality` clean/trap cases，覆盖 command evidence、fake browser coverage、review-agent semantic coverage、missing review-agent coverage。
- `review_lane_result` 进入 T2 eval runner，并新增 `M5_review_result_quality` frozen golden cases，覆盖 grounded block、grounded allow、rubber-stamp allow、ungrounded block。
- `devns orchestrate` 写入本地 `.devns/traces/orchestrator.jsonl`，记录 claim/handoff/review-routing 的 bounded workflow trace；`devns trace --audit` 可读取并审计最近的 orchestrator traces。
- `orchestrator_trace` 进入 T1 eval runner，并新增 `M6_trace_quality` cases，覆盖正常 claim trace、prompt 泄漏 trap、缺失 claim event trap。
- 状态写入使用加固后的 atomic JSON writer：随机临时文件、fsync、rename、异常清理，并新增 `M7_state_reliability` eval 覆盖 round-trip 和 temp leakage。
- `devns init` 安装 `.devns/lanes/browser-smoke.json`、`.devns/adapters/browser-smoke.sh` 和 `.devns/adapters/playwright-semantic-smoke.mjs`；默认 lane 通过 `DEVNS_BROWSER_SMOKE_URL` 启用，启用后可采集 screenshot、trace、console、network、visible text、DOM HTML 和 accessibility/ARIA 文本 artifact refs。
- `devns lanes run --write`、`devns lanes ingest` 和 `devns complete` 现在会向同一个 `.devns/traces/orchestrator.jsonl` 追加 lane/review/completion span；`M8_trace_continuity` 检查完成态 feature 是否具备 handoff、lane/review evidence 和 completion 的连续 trace。
- `evidence_quality` 现在要求用于覆盖验收项的 browser/human/review 语义 evidence 带 `artifactRefs` 或 `url`；`M9_artifact_requirements` 覆盖可追溯语义证据 clean case 和无 artifact 自报 trap。
- 新增 `artifact_integrity` 检查：本地 evidence artifact refs 必须存在，browser-smoke `run.json` 必须是可识别 manifest 并指向存在的 stdout/stderr；`M10_artifact_integrity` 覆盖 manifest clean 和缺失 log trap。
- Browser-smoke adapter 现在会向被包装命令暴露 artifact 目录，并自动把截图、trace、`console.ndjson`、`network.ndjson` 等 rich artifacts 写入 manifest；`M11_artifact_content_quality` 检查 rich artifacts 存在、图片格式基本可信、console/network JSON/JSONL 可解析。
- `artifact_integrity` 新增可选严格策略：`failOnConsoleError` 会阻断 console error，`failOnNetworkError` 会阻断 failed/error 标记或默认 500+ 状态码；`M12_browser_policy_quality` 覆盖健康 browser artifact、console error trap、network 5xx trap。
- Browser policy 进一步支持 `consoleErrorBudget`、`networkFailureBudget`、`networkAllowedUrls`、`networkBlockedUrls`；`M13_browser_policy_budget_allowlist` 覆盖预算内通过、console 预算超限、network allowlist 越界、blocklist 命中。
- `artifactIntegrity.browserSmoke` 进入 `.devns/devns.config.json` schema 和 `devns validate`；`M14_project_browser_policy_config` 覆盖项目配置直接驱动 browser artifact policy。
- 新增 `artifact-digest`：review packet 和 morning review 会把 browser-smoke refs 转成可读摘要，包含 rich artifact 数、截图/trace、console entries/errors、network requests/failures、sample URLs 和 policy findings；`M15_artifact_digest_review_surface` 覆盖 digest clean/missing case。

### 3. Evidence Must Match Verification Type

DEVNS 的核心风险不是“没有跑命令”，而是 evidence 看起来很多，却没有证明对应验收项。成熟评测体系通常要求测试数据、参考答案和 grader 语义一致；DEVNS 对应的是：

- AC 声明 `verificationType`。
- evidence 声明 `verificationType` 和覆盖关系。
- 显式覆盖也必须通过类型兼容检查。
- 语义 evidence 必须能追溯到 review packet、browser-smoke artifact、截图、日志或外部 review URL。
- command/build 不能冒充 browser/human/review 语义证据。
- review-agent evidence 是独立语义 evidence，不应被当作普通自报文本。

本轮已微调 `evaluateEvidenceQuality`：独立 review/browser 语义 evidence 不再因为“不是 deterministic command”而被错误提示为 evidence 不够；manual-only 仍会进入 human review。

### 4. Review Agent As Read-Only Grader

适合 DEVNS 的 review agent 不是“给建议的聊天角色”，而是 read-only grader：

- 输入：RFC、diff、lane outputs、history、project rules。
- 输出：一个 schema-validated `lane-result`。
- 阻断条件：高置信、高严重度、带 diff/file/line 或命令证据。
- 低置信风险进入 human review。
- allow 也必须说明残余测试缺口。

现状已经有 grounding/downranking 逻辑，也新增了 T2 frozen review packet quality gate：只给 feature title、缺 RFC/diff/evidence/history/project rules/output contract 的 review packet 会被阻断。下一步是把 live model adapter/prompt 校准接上这些 frozen packet。

## 不应该直接照搬的东西

- 不把 DEVNS 绑定到单一 LLM provider 或 Agents SDK。DEVNS 的稳定边界应继续是本地 JSON、CLI、schema、lanes、plugins 和 host adapters。
- 不把 Claude agent hook 作为主循环。Claude 官方也提示 agent hooks 仍可能变化，DEVNS 更适合让 hook 做安全网，把正常工作交给 orchestrator。
- 不把 “LLM review 通过” 当成唯一完成证据。LLM review 是 semantic grader，仍要与 deterministic lanes、browser/human evidence、artifact refs 合并判断。
- 不追求一个通用“最强 agent prompt”。每个项目的 RFC、risk、policy、lanes 才是可迁移的控制面。

## 当前缺口

1. T2 已接入 frozen review-result golden 和 frozen review-packet quality golden；还没有把 live model adapter 的完整 prompt 校准纳入 runner。
2. T3 seed repository 还没有 pass^k、成本、耗时和失败分类。
3. Browser smoke lane 已有通用 adapter/template、smoke 覆盖、dashboard/morning review artifact refs 展示、rich artifact manifest、项目级 console/network policy、预算和 URL allow/block-list、review packet/morning review artifact digest、dashboard artifact digest 富预览、dashboard artifact preview 的 DOM/文本快照语义 grader、从 browser-smoke manifest 读取 DOM/OCR/accessibility snapshot artifact 的 ingestion gate，以及 `devns init` 默认安装的 URL 驱动 Playwright semantic browser lane；下一步是把它接入 T3 seed repo。
4. Orchestrator trace 已覆盖 handoff、lane run、review ingest、complete 的连续性；worker result 和 repair loop 还没有进入同一 trace。
5. Eval schema 和 T1/T2 cases 已能表达 trace continuity、semantic artifact requirements、browser-smoke manifest integrity、基础 rich artifact parseability、console/network policy trap、预算和 URL allow/block-list、artifact digest、dashboard artifact preview 语义快照、browser-smoke semantic snapshot ingestion，以及 review packet 输入质量；下一步是把默认 browser command 模板放进 T3 seed repo 的真实 pass/fail 场景。
6. CI 目前能跑 T1/T2，但没有 nightly/release 级别的 T3。

## 建议顺序

1. 完成 T1 控制面 eval 覆盖：domain drift、scope、review independence、evidence quality、review finding grounding。
2. 扩展 T2 frozen review packets 到 live adapter calibration：用固定 diff 注入 correctness/security/test/scope bug，要求 review agent 返回结构化 findings，再用 `review_lane_result` golden grader 校验。
3. 扩展 local trace record：当前已记录 orchestrate claim/handoff/review-routing、lane run、review result、complete；下一步把 worker result 和 repair loop 串进同一 workflow trace。
4. 扩展 browser smoke artifact 体验：当前 adapter 已产出 run/stdout/stderr 和可选截图/trace/console/network/DOM/OCR/accessibility artifact refs，并已在 evidence-quality、artifact-integrity、morning review、review packet、dashboard artifact digest 预览和 dashboard semantic snapshot grader 中使用；`devns init` 也已默认安装 URL 驱动的 Playwright semantic browser lane。下一步把 T3 seed repo 接起来。
5. 增加 T3 seed repos：小型 CLI、React/Vite、Next、Python package，按 pass^k 和成本统计。
6. 将 eval report 接入 dashboard/morning review，让人看到 harness 质量趋势，而不只是当前 feature 状态。
