背景：模块拆分做了，但部分业务规则、完成信号和失败处理仍分散在多处。新增层承担了协调成本，旧的联动和判断又没有完全退出。
任务：以已完成的 spec #1、#8、#17、#26 及其关联 tickets 定义的目标行为为依据，逐项审查业务规则、完成信号和失败处理的实际归属，追踪跨模块协作中保留的旧联动、重复判断和交接缺口；每项发现须提供代码位置、对应需求、问题依据及简化或修复方向。

逐项记录审查覆盖情况，并区分已确认问题与待验证疑点。
现有代码行为和旧测试通过均不构成保留旧行为的依据。区分实现目标行为所需的代码增长与冗余增长，简化建议须保留目标功能和可读性。

利用codex 内置浏览器进行web 相关测试。

## 文档规范

按文档用途保留内容：需求说明行为，架构说明职责与交接，
操作说明提供必要步骤和资源位置。工作经过放在提交说明中，不进入文档。

新增文字中同一规则集中维护；避免换句话重复。

"不代表"、"不意味" 的免责声明是被禁止的恶心的废话。

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues. Before tracker operations, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triage, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. Before exploring the codebase, read `docs/agents/domain.md`.
