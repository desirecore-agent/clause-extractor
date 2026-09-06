---
name: clause-extraction
description: >-
  合同条款结构化抽取。把已通过输入治理的合同正文与附件，按固定顺序 E1→E10 逐条转写为带
  条款编号与页码锚点的结构化数据：条款树、定义术语、金额（中文大写与阿拉伯数字双录）、
  付款条件与时间点、期限索引、解除与终止、争议解决、责任与赔偿上限（可比较结构）、
  当事方标识、附件引用与附件清单双表。原始歧义原样保留：读不准并列候选、文档矛盾双录、
  不确定不归一化。产出为下游风险识别、法域合规、复核出报告三个环节的共同输入。
  用户提到条款抽取、条款结构化、条款清单、定义条款、术语表、金额抽取、大写金额、付款节点、
  期限、宽限期、通知期、解除条件、争议解决、管辖、仲裁、责任上限、赔偿上限、间接损失、
  当事方、附件引用、证据索引、页码锚点时使用。
  Use when converting a gated contract into machine-consumable structured clauses with
  clause numbers and page anchors; extracts amounts in both Chinese words and figures,
  keeps ambiguity unresolved, and never normalizes uncertain values.
version: 1.0.2
type: procedural
risk_level: low
status: enabled
tags:
  - contract-review
  - clause-extraction
  - structured-extraction
  - evidence-chain
  - ambiguity-preservation
requires:
  tools:
    - Read
    - Ls
    - Glob
    - Grep
    - Write
    - MathCalc
    - GenerateUUID
    - UnderstandImage
metadata:
  author: DesireCore
  version: 1.0.2
  updated_at: '2026-09-06'
  pipeline_stage: 3
  upstream: contract-intake
  downstream: [risk-scanner, jurisdiction-auditor]
  ontology_ref: shared/resources/business-ontology/contract.yaml
---

# 合同条款结构化抽取

## 何时使用

输入治理闸门给出 `passed` 或 `conditional` 之后、任何风险判断之前执行。它是固定工具链的
第 3 步「条款抽取」，产出是第 4–7 步（法域知识注入、风险判读、版本对比、报告输出）的共同输入。

## 生产 O2 性能与落盘约束

单个 O2 抽取目标是在 **10 分钟内**完成可交接产物。这个时限约束执行方式如下，不能靠延长推理或等待模型自行收敛来规避：

1. **先写盘，后交接。** E1 完成并确认绝对工作目录后，立即建立本次 extraction 的绝对产物路径；每完成一组 E 步骤就用 `Write` 原子更新同一个新产物文件。至少按 E1、E2–E5、E6–E9、E10 四个检查点落盘。只有最终文件写成功、可读回并包含完整 E1–E10 结构后，才发送 `handoff` 或 `SendMessage`；交接块只引用 `artifact_path`，不携带整份条款正文。
2. **分块读取与精简正文。** 按 `frozen_baseline.page_range` 的部件和页段分块读取；每块只保留当前 E 步骤需要的短原文片段、稳定 ID 和 `{part, page, quote}` 证据。不要在上下文或交接块重复整份 3 页/多附件正文；条款全文留在落盘产物，交接只传统计、缺口和下游所需事实。
3. **一次有界推理。** 依次完成 E1→E10，使用已经确认的 `confirmed[]`，不得重新跑输入治理或全文反复重读。每个 E 组只做一次抽取和一次针对硬字段的局部核对；禁止无界思考、循环改写同一 YAML、重复生成同一条款或为了“再确认一次”重新扫描全文。
4. **到时如实收口。** 在 8 分钟时检查剩余 E 步骤和落盘状态，在 10 分钟前必须写入当前事实。若无法完成，保留已写产物，把未完成字段记为 `blank`/`blocked` 并写入对应 `failure_marks`，不得伪造完整 37 条或发送“已完成”回执；交接只能在产物结构和失败标记可被下游消费时进行，否则停在当前环节并报告超时。

这组约束只压缩读取、上下文和重复工作，不放宽 E1–E10、页码/行号证据、金额大写与小写双录、`pending` 原样透传、歧义保留或 handoff 完整性。

### 首写硬闸（必须先做，优先级高于本技能其余说明）

模型不得把“准备写入”当作已经落盘。完成启动凭证读取后，先用一次 `GenerateUUID` 建立 `extraction_id`；完成第一次合同或冻结部件 `Read` 后，**下一次工具调用必须是 `Write`**：
在 `workspace` 下建立本案唯一的绝对 `artifact_path`，先写入可读的 E1 身份/版本骨架（未确定字段使用 `blank`，不得等待完整分析）。除这一次 `GenerateUUID` 外，首次 `Write` 前禁止 `Grep`、`MathCalc`、第二次全文 `Read` 或长篇推理；不确定时先落盘再增量更新。

之后每个 E 组最多允许一次局部读取和一次 `Write` 更新；任何新发现都写入既有产物，不得另起草稿。若距离启动已超过 8 分钟或模型无法在下一步完成当前 E 组，立即 `Write` 当前事实和 `failure_marks`（可为 `blank`/`blocked`），再停止本轮；不得继续扫描或重复规划。10 分钟后不得发起新的分析工具调用。

## 启动前置条件（不满足则拒绝启动）

上游 `contract-intake` 的结构化交接块（顶层键 `handoff`）是你唯一合法的启动凭证。

| 条件 | 不满足时 |
|---|---|
| 收到 `handoff` 块，且 `handoff.to == clause-extractor` | 拒绝启动，回报 `EXT-NO-HANDOFF`——不得凭原文直接开工 |
| 上游回执 `verdict` ∈ {`passed`, `conditional`} | 拒绝启动（`EXT-UPSTREAM-REJECTED`）。`blocked` 时闸门关上就是关上，不得以"先抽出来供参考"绕过 |
| `object` 齐全（`contract_object_id` + `object_title` + `submission_mode`） | 拒绝启动，回报 `EXT-OBJECT-INCOMPLETE` 并指明缺哪一项 |
| `scope.frozen_baseline` 存在 | 拒绝启动（`EXT-BASELINE-ABSENT`） |
| `receipt_path` 为可读的绝对路径 | 拒绝启动（`EXT-RECEIPT-UNREADABLE`） |

---

## 交接契约消费规则（强制）

上游交接块的五个部分，各有各的消费义务。**这一节的每一条都是硬规则，不是建议。**

### `confirmed[]` —— 直接当作事实使用，不重复校验

`confirmed` 里的每一条（主版本已冻结、页码连续、附件清单已冻结、签章齐备、无占位符、
主体名称全文一致、法域线索）都是上游已经完成的判定。**直接用，不重跑。**

重复校验有两个具体危害：一是你可能得出与上游不同的结论，制造两个互相矛盾的权威判定；
二是**你不是闸门**——你没有拒绝权，重新校验出的问题你也无处安放，只会变成一句越权的评论。

> 例外仅一处：`confirmed` 与你在原文中直接读到的内容**正面冲突**时，不要自行推翻，
> 写入 `ambiguities`（`upstream_conflict`）并在交接块 `pending` 中上报，标 `must_escalate: true`。

### `pending[]` —— 不得自行消化，必须原样透传

每条 `pending` 含 `id` / `from_flag` / `must_escalate` / `statement` /
`required_downstream_action` / `evidence`。你的义务：

1. **原样复制进你自己的输出交接块**，`id` 不改、`statement` 不改写、`evidence` 不重新锚定。
2. `must_escalate: true` 的项**必须**出现在你给下游的 `pending` 中。
   **不得因为"我觉得不重要""我已经抽到了对应条款""看起来问题不大"而吞掉。**
3. 可以**追加**你在抽取中发现的新待确认项（用 `PEND-EXT-<序号>` 编号，与上游 `PEND-*` 区分），
   但不得删改上游的任何一条。
4. `required_downstream_action` 指向的动作若属于你的职责范围，你执行它并把结果写进
   `resolution_evidence`；**但该 `pending` 条目仍然保留并继续透传**——执行不等于消化。

> 典型：`PEND-01 / FLG-ATTACHMENT-VERSION-CHANGED`——附件二由 SLA-v1.2 替换为 SLA-v2.0，
> 正文逐字相同（`body_diff_count=0`），**不得据此判定两版一致**。
> 你要做的是：把附件二的引用与受影响条款抽全（E9），把该 `pending` 原样传下去，
> 并且**不对"风险变化方向"作任何表态**——那是下游的判断。

### `scope.in_scope` / `scope.out_of_scope` —— 不越界

- `in_scope`：条款抽取（条款号 / 定义 / 金额 / 付款 / 期限 / 解除 / 争议解决），保留来源页码。
- `out_of_scope`：**风险打分、法域规则匹配、最终评分与动作建议。**

越界的具体形态（全部禁止）：给条款打风险等级、与市场标尺比对、判断是否合规、
提修改建议、用"偏高""不利""建议关注""值得注意"这类倾向性措辞。
陈述事实（"第 9.3 条约定赔偿总额不超过合同总价的 100%"）可以；作出评价（"这个上限偏高"）不可以。

### `scope.consistency_conclusion_allowed == false` —— 措辞禁令

为 `false` 时，你的**全部输出**（产物文件、交接块、面向人的回复）中禁止出现下列表述及其等价说法：

```
一致 / 无差异 / 差异为 0 / 相同 / 没有变化 / 内容未变 / 两版一样 / identical / no difference
```

需要陈述客观观察时用**受限措辞**：`正文逐字相同（body_diff_count=0）；一致性结论未获授权，不予给出`。
把 `consistency_conclusion_allowed` 原样传给下游，不得置为 `true`。

> 原因见蓝本第九节：主文本 diff 为零而附件被整体替换时，"差异为 0"是最阴险的结论形态。
> 未冻结/未授权时输出一致性结论，等于替下游把最大的风险签掉。

### `do_not_pass[]` —— 上游不传给你的，你也不去找

上游声明不传递：对话历史、其推理过程与中间草稿、未经 `evidence` 锚定的判断。
**不得通过 `RecallConversation` 或任何其他途径去获取这些内容。**
你的输入只有：原文 + 交接块 + 回执文件。

---

## E1 上游核验与对象绑定

1. 读取 `handoff` 块，逐项核对「启动前置条件」与「交接契约消费规则」。
2. 立即用 `GenerateUUID` 生成 `extraction_id`，格式 `EXTRACT-<YYYYMMDD>-<uuid 前 8 位>`；这是首次 `Write` 前唯一允许的元数据工具调用。
3. 用 `Read` 读入 `receipt_path` 指向的回执，取 `frozen_baseline` 的完整值。
4. 用 `Ls` 确认工作目录，用 `Read` 逐一读入 `frozen_baseline.page_range` 声明的全部部件。
   **只读 `frozen_baseline` 列出的部件**——多读一个未冻结的文件，就是在处理另一个对象。
   `page_range` 是**按部件**给的（如 `{body: "1-7", "attachment:附件二": "1-2"}`），
   你的 `part` 标识必须与它逐字一致。
5. 登记版本信息：`parser_revision`（文档解析器版本）、`ontology_version`、`skill_version`，
   并把 `intake_id` / `receipt_path` 写进 `upstream` 段，保持链路可回放。
6. 图片型页面用 `UnderstandImage` 读取，**结果一律 `certainty: uncertain` 起步**，
   除非文字清晰无歧义才升为 `certain`；置信度不足时进 `readings[]`。

> ⚠️ `parser_revision` 变化后旧产物一律作废重抽，不做增量修补（蓝本第八节）。
> 缺了它，OCR 升级之后无法区分"这条结论仍然成立"与"这条结论只是没人重新验证过"。

### 证据锚点的统一结构

本技能产出的**每一个** `evidence` 字段都用同一结构，与上游逐字对齐：

```yaml
evidence:
  part: body                 # 部件标识，与 frozen_baseline.page_range 的键一致
                             # 取值：body | attachment:<编号>，如 attachment:附件二
  page: 2                    # 归一化页码；不可得时该条进 failure_marks，不得写 null 混入正常产物
  quote: "协议期内首年采购预算总额为人民币壹佰贰拾万元整（¥1,280,000.00）"
                             # 原文片段，必须能在该部件源文件中按固定字符串 grep 到
```

`quote` 的硬要求：**逐字原文，不省略、不改标点、不加省略号截断到无法匹配**。
它是下游复核唯一的回溯入口，改一个字符就断链。

### 稳定 ID 前缀

自由文本不得当 ID。本技能的全部机器可读标识：

| 前缀 | 用途 |
|---|---|
| `EXT-*` | 抽取缺口与启动失败（如 `EXT-NO-HANDOFF`、`EXT-CLAUSE-NO-PAGE`） |
| `PEND-EXT-*` | 本 Agent 新增的待确认项（上游的 `PEND-*` 原样保留，不复用此前缀） |
| `AMB-*` | 歧义条目 |
| `CLS-*` / `DEF-*` / `PTY-*` / `MON-*` / `PAY-*` / `TRM-*` / `ATT-*` / `ATTREF-*` | 各类抽取记录的行 ID |

---

## E2 条款树切分与编号层级

**怎么抽**

1. 按部件分别处理，不跨部件混编条款号。
2. 识别三层编号形态，中英文合同都要支持：

| 层级 | 中文形态 | 英文形态 | `ordinal_path` 示例 |
|---|---|---|---|
| L1 | `第九条`、`第 9 条` | `Section 9`、`Article 9`、`9.` | `[9]` |
| L2 | `9.3`、`九、（三）` | `9.3` | `[9, 3]` |
| L3 | `（一）`、`（三）`、`9.3.1` | `(a)`、`(i)`、`9.3.1` | `[9, 3, 1]` |

3. 每条记录：`clause_no_raw`（原文形态，逐字保留）+ `clause_no`（点分归一形态）+
   `ordinal_path`（整数数组，供机器排序与跳号检测）+ `level` + `parent_clause_no` +
   `heading` + `heading_chain`（各级标题链）+ `page` + `text`（**原文逐字**）+ `category`。
4. `category` 取自业务本体 `entities.clause.category` 的枚举：`definition` / `payment` /
   `term_duration` / `liability` / `indemnity` / `warranty` / `confidentiality` / `ip` /
   `data_protection` / `termination` / `breach_remedy` / `force_majeure` / `dispute_resolution` /
   `governing_law` / `assignment` / `subcontracting` / `audit` / `non_compete` / `notice` /
   `misc` / `unknown`。**一条条款可归多类时全部列出，不强行选一个主类。**
5. `cross_references`：本条引用的其他条款号与附件号**原文**（如 `附件三`、`第 5.2 款`）。

**命中什么算失败**

| 情形 | 记录 |
|---|---|
| 条款命中但页码不可得 | `failure_marks: clause_hit_without_page`，该条不进 `clauses` |
| 同一部件内条款号重复且内容不同 | `failure_marks: duplicate_clause_no`，两条都保留并加后缀 `#dup1` / `#dup2` |
| 条款号跳号（`ordinal_path` 不连续） | `failure_marks: clause_no_gap`（**陈述事实，不判定为缺页**——缺页是上游的判定） |
| 编号形态无法识别 | `clause_no_raw` 照录，`clause_no: unknown`，`ordinal_path: null` |

> ⚠️ 最容易出错的地方：把「9.3」的层级判成 L1。中文合同常见「第九条」下挂「9.1 9.2 9.3」，
> 三者的 `parent_clause_no` 都是 `9`，不是并列的顶层条款。父子关系判错会让下游的
> "责任条款整条缺失"判定失准。

---

## E3 定义条款与术语表

**怎么抽**

1. 定位定义来源：独立的「定义」条款、正文中的括注定义（`（以下简称"服务商"）`、
   `(the "Services")`）、附件中的术语表。
2. 每个术语记录：`term`（术语原文）、`definition_text`（定义原文逐字）、
   `defined_at`（`{part, page, quote}` + 条款号）、`scope`（`contract_wide` / `clause_local`）、
   `used_at[]`（该术语在哪些条款被使用，含页码）、`is_party_shorthand`（是否为当事方简称）。
3. 用 `Grep` 回扫全文统计 `used_at`——定义了却从未使用、使用了却从未定义，都是下游要看的事实。

**命中什么算失败**

| 情形 | 记录 |
|---|---|
| 同一术语被定义两次且定义不同 | `ambiguities: internal_conflict`，两个定义都记，不选 |
| 术语被使用但全文无定义 | `undefined_term_usage: true`（**陈述事实**，不判定为缺陷） |

> `is_party_shorthand` 必须标——下游若把首部定义过的合法简称当成另一个主体，
> 会在"当事方名称不一致"上产生大面积误报。

---

## E4 当事方标识

**怎么抽**

对每一方记录：`party_id`、`role`（`party_a` / `party_b` / `party_c` / `guarantor` /
`affiliate_beneficiary` / `unknown`）、`canonical_name`（首部完整全称，逐字）、
`identifier`（统一社会信用代码 / 注册号 / EIN，缺则 `unknown` + 原因）、`domicile`、
`signatory_authority`、`name_variants[]`。

`name_variants[]` 逐次记录名称在全文的**每一次出现**：

```yaml
name_variants:
  - {text: 云梯信息技术（示例）有限公司, page: 1, clause_no: 首部, is_defined_term: false}
  - {text: 甲方, page: 1, clause_no: 首部, is_defined_term: true}
  - {text: 云梯科技（示例）有限公司, page: 6, clause_no: "10.4", is_defined_term: false}
```

**硬规则：名称形态不同的全部并列记录，不合并、不归一、不判断哪个是笔误。**
你只产出"这些写法各出现在哪里"，是否属于同一主体由下游与人工裁决。

| 情形 | 记录 |
|---|---|
| 出现与 `canonical_name` 不同且非已定义简称的写法 | 照录进 `name_variants` + `ambiguities: internal_conflict`，`adjudicated: false` |
| 同一名称在不同条款被指为不同角色 | `ambiguities: internal_conflict`，两处角色都记 |
| 缺统一社会信用代码 | `identifier: unknown` + `identifier_unknown_reason` |

---

## E5 金额抽取（大写与小写双录）

**这是最容易被消歧毁掉的一步。**

**怎么抽**

对每一处金额建一条 `monetary_terms` 记录：

| 字段 | 说明 |
|---|---|
| `id` | `MON-<序号>` |
| `clause_no` / `page` | 锚点，缺任一则进 `failure_marks` |
| `role` | `total_price` / `budget_cap` / `unit_price` / `installment` / `penalty` / `liquidated_damages` / `liability_cap` / `deposit` / `fee` / `unknown` |
| `amount_in_words` | **中文大写原文**（`壹佰贰拾万元整`）+ 独立 `certainty` + 独立 `evidence` |
| `amount_in_figures` | **阿拉伯数字原文**（`¥1,280,000.00`）+ 独立 `certainty` + 独立 `evidence` |
| `currency` | 币种代码；未声明写 `unknown` |
| `tax` | `{inclusive: true/false/unknown, rate, unknown_reason}` |
| `words_figures_match` | 两者数值是否相等；任一缺失写 `unknown` |
| `normalized_amount` | 过归一化闸门才写，否则 `null` |
| `is_placeholder` | 命中占位符模式即 `true` |

**硬规则**

1. **大写与小写必须各抽一份，各带各的证据位置，禁止合并成一个数值字段。**
   只抽小写会让「壹佰贰拾万」与 `1,280,000` 的差额永久消失。
2. 只出现一种形态时，另一种写 `unknown` + `unknown_reason: 原文仅有小写形态`，
   **不得由已有的一种反推另一种**。
3. `words_figures_match: false` 时 → `normalized_amount: null` +
   `normalization_blocked_reason: words_figures_mismatch` + 写入 `ambiguities`（`internal_conflict`），
   **两个值都保留，不裁决以哪个为准**。
4. 含税口径未在**本条**声明时写 `unknown`，**不得从邻近条款推断**。
   （典型陷阱：3.2 款声明预算总额未提含税，3.3 款声明"基准单价含 13% 增值税"——
   后者的适用对象是单价，不是预算总额，据此推断总额含税就是伪造事实。）
5. 命中占位符（`$X` / `TBD` / `[金额]` / `____` / `【待定】`）时 `is_placeholder: true`、
   `normalized_amount: null`，照录原文形态。**不得跳过、不得留空、不得替用户补全。**

**样例（两处不一致，双录不裁决）**

```yaml
- id: MON-003
  clause_no: "3.2"
  page: 2
  role: budget_cap
  amount_in_words:
    text: 壹佰贰拾万元整
    certainty: certain
    evidence: {part: body, page: 2, quote: "协议期内首年采购预算总额为人民币壹佰贰拾万元整（¥1,280,000.00）"}
  amount_in_figures:
    text: "¥1,280,000.00"
    certainty: certain
    evidence: {part: body, page: 2, quote: "协议期内首年采购预算总额为人民币壹佰贰拾万元整（¥1,280,000.00）"}
  currency: CNY
  tax:
    inclusive: unknown
    rate: unknown
    unknown_reason: 本款未声明含税口径；3.3 款的「含 13% 增值税」适用对象为基准单价，不得据此推断本款
  words_figures_match: false
  normalized_amount: null
  normalization_blocked_reason: words_figures_mismatch
  is_placeholder: false
  binding_note: 原文同时声明「该预算为参考额度，不构成采购承诺」
```

**样例（占位符）**

```yaml
- id: MON-001
  clause_no: "4.1"
  page: 3
  role: total_price
  amount_in_words:  {text: "【待定】", certainty: unknown, unknown_reason: 占位符, evidence: {part: body, page: 3, quote: "本合同总价款为人民币 $X 元（大写：【待定】），含 6% 增值税。"}}
  amount_in_figures: {text: "$X",     certainty: unknown, unknown_reason: 占位符, evidence: {part: body, page: 3, quote: "本合同总价款为人民币 $X 元（大写：【待定】），含 6% 增值税。"}}
  currency: CNY
  tax: {inclusive: true, rate: "6%"}
  words_figures_match: unknown
  normalized_amount: null
  normalization_blocked_reason: placeholder
  is_placeholder: true
```

---

## E6 付款条件与时间点

**怎么抽**

付款是蓝本第十二节法务四类不可替代动作之首（「付款触发与回款」），抽取必须落到**可执行的颗粒度**：
每个付款节点单独成行，触发条件与时间点分开记。

每条 `payment_terms` 记录：

| 字段 | 说明 |
|---|---|
| `id` | `PAY-<序号>` |
| `clause_no` / `evidence` | 锚点 |
| `sequence` | 节点序号（原文顺序，不重排） |
| `trigger` | 触发事件原文（`合同签署`、`M2 验收通过`、`对账确认`、`交付并验收合格`） |
| `trigger_type` | `on_signing` / `on_milestone` / `on_acceptance` / `on_invoice` / `on_reconciliation` / `periodic` / `unknown` |
| `due_offset` | `{value, unit, unit_raw, business_days}`——如 `{10, day, "个工作日", true}` |
| `amount_ref` | 指向 `monetary_terms` 的 `id`，或按比例表示 `{percentage: 30, of: MON-001}` |
| `payment_method` | 电汇 / 承兑 / 未声明 |
| `invoice_precondition` | 是否以开票为付款前提（原文表述） |
| `late_payment_consequence` | 逾期后果的条款号引用（不在此复述内容） |

**硬规则**

1. **按比例表示的节点不得自行算成金额。**「支付合同总价的 30%」在总价为占位符或大小写不一致时，
   任何乘算都是伪造。写 `{percentage: 30, of: MON-001}`，`resolved_amount: null` +
   `normalization_blocked_reason` 继承自 `MON-001`。
2. **工作日与自然日必须区分并留痕。**`unit_raw` 记原文（"个工作日" / "日" / "自然日"），
   `business_days` 记布尔值。折算成天数时写 `normalization_note` 说明是否扣除法定假日；
   无法确定假日日历时**不折算**，`normalized_days: null` + `cross_unit_conversion_unsafe`。
3. **付款节点的百分比合计不做校验、不做提示。**你可以用 `MathCalc` 算出合计并记入
   `installment_percentage_sum`（一个客观事实），但**不得**给出"合计不等于 100%，存在缺口"
   这类判断——那是下游的一致性检查。
4. 触发条件含前置依赖（"验收通过后"依赖验收条款）时，在 `depends_on_clause` 记录条款号引用。

**样例**

```yaml
payment_terms:
  - id: PAY-01
    clause_no: "4.2（一）"
    evidence: {part: body, page: 3, quote: "（一）合同签署后 10 个工作日内支付合同总价的 30%；"}
    sequence: 1
    trigger: 合同签署
    trigger_type: on_signing
    due_offset: {value: 10, unit: day, unit_raw: 个工作日, business_days: true}
    normalized_days: null
    normalization_blocked_reason: cross_unit_conversion_unsafe
    normalization_note: 工作日折自然日需假日日历，本次未获得，不折算
    amount_ref: {percentage: 30, of: MON-001}
    resolved_amount: null
    invoice_precondition: unknown
    invoice_precondition_unknown_reason: 本款未约定开票与付款的先后关系
  - id: PAY-02
    clause_no: "6.2"
    evidence: {part: body, page: 3, quote: "6.2 付款条件为对账确认后 60 日内电汇支付"}
    sequence: 1
    trigger: 对账确认
    trigger_type: on_reconciliation
    due_offset: {value: 60, unit: day, unit_raw: 日, business_days: false}
    normalized_days: 60
    payment_method: 电汇
installment_percentage_sum: 100      # 客观合计，不附带任何判断
```

---

## E7 期限索引

**怎么抽**

期限散落在全文，必须建**统一索引**，否则下游要拿"续约通知期 90 天""竞业 5 年"对市场标尺时无从取值。

每条 `temporal_terms` 记录：`id`（`TRM-<序号>`）、`kind`、`clause_no`、`evidence`、
`duration_text`（原文逐字）、`value` / `unit` / `unit_raw`、`normalized_days`、
`normalization_note`、`start_trigger`（起算点原文）、`counterparty`（该期限约束哪一方）。

`kind` 枚举（必须覆盖，缺哪类在 `coverage` 里留痕）：

| kind | 含义 | 市场标尺相关 |
|---|---|---|
| `contract_term` | 合同期 / 协议有效期 | |
| `renewal_term` | 续约期 | |
| `renewal_notice` | 续约或不续约通知期 | ✅ ≥90 天 |
| `termination_notice` | 解除 / 终止通知期 | |
| `grace_period` | 宽限期 / 违约治愈期 | ✅ |
| `cure_period` | 补救期 | |
| `payment_period` | 付款期 | |
| `objection_period` | 异议期 / 验收期 | |
| `warranty_period` | 保修期 / 质保期 | |
| `confidentiality_term` | 保密期限 | ✅ 永久无终止机制为风险 |
| `non_compete_term` | 竞业限制期 | ✅ 1–2 年 |
| `probation_period` | 试用期 | ✅ 法定上限 |
| `data_retention` | 数据保留期 | |
| `data_export_window` | 数据导出窗口 | ✅ ≥90 天 |
| `force_majeure_threshold` | 不可抗力持续时长阈值 | |
| `notice_period_general` | 其他通知期 | |

**硬规则**

1. **「个月」「年」的折算必须留痕。**月按 30 天与按自然月是不同结果，年按 365 天与按自然年同理。
   写 `normalization_note: 月按 30 天折算`。下游按别的口径重算时能看出差异来自折算而非原文。
2. `duration_text` 保留原文，**不得**把「五年」改写成「5 年」再存——原文形态本身是识别质量的证据。
3. 期限为「永久」「无限期」「perpetual」「至商业秘密不再构成商业秘密之日」等**非数值表述**时：
   `value: null`、`unit: null`、`normalized_days: null`、
   `is_indefinite: true` + `indefinite_text` 记原文。**不得折算成一个大数字**（如 99 年）。
4. 同一 `kind` 在文档多处出现不同值时 → `variants[]` 全记 + `ambiguities: internal_conflict`，
   不选一个作为"该合同的"该项期限。
5. 起算点（`start_trigger`）必须抽——「自签署之日起 5 年」与「自合同终止后 5 年届满」
   长度相同但实际截止时间差一个合同期。只抽时长不抽起算点等于抽了一半。

**样例**

```yaml
temporal_terms:
  - id: TRM-07
    kind: confidentiality_term
    clause_no: "8.2"
    evidence: {part: body, page: 5, quote: "8.2 保密期限自本合同签署之日起至合同终止后 5 年届满。"}
    duration_text: 至合同终止后 5 年届满
    value: 5
    unit: year
    unit_raw: 年
    normalized_days: 1825
    normalization_note: 年按 365 天折算；本期限的终点依赖合同终止日，绝对截止日不可得
    start_trigger: 合同终止之日
    start_trigger_note: 首句「自本合同签署之日起」与末句「至合同终止后 5 年届满」起讫点不同，原文照录
    counterparty: 乙方
  - id: TRM-11
    kind: confidentiality_term
    clause_no: "5.1"
    evidence: {part: body, page: 3, quote: "shall survive in perpetuity"}
    duration_text: in perpetuity
    value: null
    unit: null
    normalized_days: null
    is_indefinite: true
    indefinite_text: in perpetuity
    normalization_blocked_reason: unit_undeclared
```

---

## E8 解除终止、争议解决、责任与赔偿

这三组同属蓝本第十二节的法务不可替代动作，抽取颗粒度要求最高。

### E8.1 解除与终止

每条 `termination_grounds` 记录：`id`、`clause_no`、`evidence`、`ground_text`（原文）、
`ground_type`、`invoking_party`（哪一方可行使）、`notice_period_ref`（指向 `TRM-*`）、
`requires_cause`（是否需要理由）、`compensation`（终止后补偿的原文表述，无则 `not_stated`）、
`survival_ref`（终止后继续有效的条款引用）。

`ground_type` 枚举：`mutual_consent` / `convenience`（无理由终止）/ `material_breach` /
`insolvency` / `force_majeure_prolonged` / `change_of_control` / `non_payment` /
`regulatory` / `expiry` / `unknown`。

> ⚠️ `convenience`（便利终止 / 无理由终止）必须单独识别并标 `requires_cause: false`。
> 它对应关键条款清单的 `termination-convenience`，是下游必查项。
> 「协商一致可以解除」是 `mutual_consent`，**不是** `convenience`——把两者混为一谈
> 会让"缺失便利终止权"的判定失效。

### E8.2 争议解决

`dispute_resolution` 单独成对象，**不是**一条普通条款：

```yaml
dispute_resolution:
  present: true
  clause_no: "12.2"
  evidence: {part: body, page: 7, quote: "..."}
  mechanism: litigation          # litigation | arbitration | mediation_then_litigation
                                 # | mediation_then_arbitration | escalation_only | not_stated
  forum_named: true              # 是否指名了具体法院/仲裁机构
  forum: 甲方住所地有管辖权的人民法院
  forum_is_determinable: true    # 能否据原文确定唯一机构
  seat: unknown
  rules: unknown
  language: unknown
  exclusive: unknown
  pre_conditions: [友好协商]
governing_law:
  present: true
  clause_no: "12.1"
  evidence: {part: body, page: 7, quote: "12.1 本合同适用中华人民共和国法律。"}
  law_text: 中华人民共和国法律
  carve_outs: []
```

**硬规则（最容易出错的一条）**

**`governing_law` 与 `dispute_resolution` 是两个独立对象，必须分开抽、分别判断存在性。**
「本协议适用中华人民共和国法律」只填 `governing_law`，`dispute_resolution.present`
仍应为 `false`（`mechanism: not_stated`）——**有适用法律不等于有争议解决机制**。

把准据法条款当成争议解决条款，会让"未约定任何仲裁机构或管辖法院"这一严重缺失被整条吞掉。
这是本技能最高频的漏检形态。

同理：`mechanism: escalation_only`（只写"友好协商解决"、"双方协商"，没有后续机制）
也**不构成**争议解决机制，`forum_named: false` + `forum_is_determinable: false`。

同一文档出现两个及以上互斥的管辖/准据法约定时 → 全部记入 `variants[]` +
`ambiguities: internal_conflict`，**不选一个，也不判断哪个优先**（法域冲突的裁决属法域合规 Agent）。

### E8.3 责任与赔偿

```yaml
liability:
  cap:
    present: true
    clause_no: "9.3"
    evidence: {part: body, page: 6, quote: "..."}
    original_text: 任何一方违反本合同对另一方承担的赔偿责任总额，不超过合同总价的 100%
    scope: mutual                 # mutual | one_way_supplier | one_way_customer | unknown
    comparable:
      basis: contract_total_percentage
      months: null
      percentage: 100
      fixed_amount: null
      reference_base: 合同总价
      lookback_window_months: null
      normalized_for_ruler: false
      not_comparable_reason: >-
        本条以合同总价百分比计价，与市场标尺的「N 个月费用」量纲不同；
        换算需合同期与月费两个参数，本合同为一次性总价制，不存在月费口径。不做换算。
  indirect_damages_excluded:
    present: true
    clause_no: "9.4"
    evidence: {part: body, page: 6, quote: "..."}
    excluded_types: [间接损失, 利润损失, 数据丢失, 商誉损失]
  cap_exceptions:
    - trigger: 故意或重大过失
      effect: 不适用责任上限
      clause_no: "9.5"
      evidence: {part: body, page: 6, quote: "..."}
  breach_remedies:
    - id: BRM-01
      clause_no: "9.1"
      evidence: {part: body, page: 6, quote: "..."}
      breaching_party: 乙方
      trigger: 逾期交付
      remedy_type: liquidated_damages     # liquidated_damages | actual_damages
                                          # | specific_performance | termination_right
                                          # | refund | service_credit | not_stated
      rate_text: 每逾期 1 日按合同总价的千分之一
      cap_text: unknown
```

**`comparable` 的 `basis` 枚举与填法**

| basis | 何时用 | 必填字段 | `normalized_for_ruler` |
|---|---|---|---|
| `months_of_fees` | 「不超过前 N 个月已付费用」 | `months`, `lookback_window_months`, `reference_base` | `true` |
| `fixed_amount` | 「不超过人民币 X 元」 | `fixed_amount`, `currency` | `true` |
| `contract_total_percentage` | 「不超过合同总价的 N%」 | `percentage`, `reference_base` | 见下 |
| `multiple_of_fees` | 「不超过年费的 N 倍」 | `multiple`, `reference_base` | `true` |
| `uncapped` | 明示不设上限 | — | `true` |
| `unknown` | 表述无法归类 | `unknown_reason` | `false` |

**硬规则：量纲对不上时绝不硬换算。**

- 订阅制（有明确月费/年费）合同的「合同总价的 N%」→ 可换算，写换算式进 `normalization_note`。
- 一次性总价制合同的「合同总价的 N%」→ **不存在月费口径**，`normalized_for_ruler: false` +
  `not_comparable_reason`。硬换出一个"相当于 12 个月"的数字，会让下游得出建立在虚构假设上的
  标尺结论——**比不做比较更糟，因为它看起来是做过比较的**。

`present: false` 时必须走 `not_present` 流程（附 `search_performed`），
且**不得**顺带说明"缺失责任上限属于严重风险"——缺失的严重程度由下游判定。

> ⚠️ 分类错误提醒：「条款存在但内容不利」与「条款缺失」是两回事。
> 例如数据导出条款写明"不得导出"——这是 `present: true` 且内容为禁止，
> **不是** `not_present`。把前者报成后者是硬性判定错误。

---

## E9 附件双表与对账陈述

**一张表回答不了两个问题，所以必须抽两张，且两张表独立抽取、互不校正。**

| 表 | 来源 | 回答什么 |
|---|---|---|
| `attachment_manifest` | 附则的「附件清单如下」章节 | 这份合同**正式登记**了哪些附件 |
| `attachment_references` | 正文中每一次附件引用 | **哪些条款依赖哪个附件、依赖的是哪一版** |

只有清单表 → "正文引用了附件三但清单没登记"看不出来。
只有引用表 → "清单登记了但正文从未引用"看不出来。

> ⚠️ **禁止用一张表去"修正"另一张。**用清单的 V1.1 去覆盖正文引用的 V1.3，
> 正是把矛盾抹平的典型手法。两张表各自忠实于各自的来源。

### `attachment_manifest`（清单登记）

逐条抽四个字段，缺失写 `unknown` + 原因，**不得从正文引用补全**：

```yaml
attachment_manifest:
  - id: ATT-01
    no_raw: 附件一
    no_normalized: "1"
    name: 接口对接清单
    version_label: unknown
    version_unknown_reason: 清单未标注版本号
    doc_no: unknown
    declared_at: {part: body, page: 7, clause_no: "13.3", quote: "　　附件一　《接口对接清单》"}
  - id: ATT-02
    no_raw: 附件二
    no_normalized: "2"
    name: 技术规格书
    version_label: V1.1
    doc_no: unknown
    declared_at: {part: body, page: 7, clause_no: "13.3", quote: "　　附件二　《技术规格书 V1.1》"}
```

### `attachment_references`（正文引用，逐次记录不去重）

用 `Grep` 全量搜引用形态：`附件[一二三四五六七八九十\d]+`、`Exhibit [A-Z]`、
`Schedule \d`、`Annex \w`、`Appendix \w`、`附表\w`。

```yaml
attachment_references:
  - id: ATTREF-01
    no_raw: 附件二
    no_normalized: "2"
    name_as_cited: 技术规格书
    version_as_cited: V1.3
    cited_at: {part: body, page: 1, clause_no: "1.2", quote: "1.2 详细功能规格以附件二《技术规格书 V1.3》为准。"}
    binding_effect: prevails_over_body
    binding_effect_quote: 功能规格书与本合同正文不一致的，以功能规格书为准
  - id: ATTREF-02
    no_raw: 附件三
    no_normalized: "3"
    name_as_cited: 验收标准
    version_as_cited: unknown
    cited_at: {part: body, page: 2, clause_no: "2.3", quote: "各里程碑的验收标准依附件三《验收标准》执行"}
    binding_effect: incorporated_by_reference
  - id: ATTREF-03
    no_raw: 附件三
    no_normalized: "3"
    name_as_cited: 验收标准
    version_as_cited: unknown
    cited_at: {part: body, page: 5, clause_no: "6.3", quote: "通过附件三《验收标准》中约定的冒烟测试"}
    binding_effect: incorporated_by_reference
```

**硬规则**

1. **逐次记录，不去重。**同一附件在 2.3 与 6.3 各被引用一次是**两条记录**。
   附件被替换时（蓝本第九节版本对比陷阱），下游需要知道**具体哪些条款受影响**，去重会丢掉这个映射。
2. `binding_effect` 必抽：`prevails_over_body`（附件与正文冲突时以附件为准）/
   `incorporated_by_reference`（并入合同）/ `informational`（仅参考）/ `unknown`。
   约定了 `prevails_over_body` 的引用，意味着附件版本的不确定会**改变合同的实际约束内容**，
   而不只是一处记载瑕疵。
3. 引用处写明版本的记 `version_as_cited`；未写明的写 `unknown`，
   **不得**从清单把版本号搬过来。

### `attachment_reconciliation`（对账陈述——只陈述，不裁决）

三个维度逐一比对，产出**客观事实**：

```yaml
attachment_reconciliation:
  - no_normalized: "2"
    in_manifest: true
    manifest_ref: ATT-02
    referenced_count: 1
    referenced_by: [ATTREF-01]
    affected_clauses: ["1.2"]
    name_consistent: true
    version_consistent: false
    version_values:
      - {value: V1.3, source: reference, at: {part: body, page: 1, clause_no: "1.2"}}
      - {value: V1.1, source: manifest,  at: {part: body, page: 7, clause_no: "13.3"}}
    delivered: false
    adjudicated: false
    note: 两处版本标识不同，本 Agent 不裁决以哪一版为准
  - no_normalized: "3"
    in_manifest: false
    manifest_ref: null
    referenced_count: 2
    referenced_by: [ATTREF-02, ATTREF-03]
    affected_clauses: ["2.3", "6.3"]
    name_consistent: unknown
    version_consistent: unknown
    delivered: false
    adjudicated: false
    note: 正文引用 2 次，附件清单无对应条目
```

**陈述与裁决的分界（这条决定你会不会越权）**

| 允许写（事实） | 禁止写（裁决） |
|---|---|
| `version_consistent: false` | `这是阻断项` / `severity: critical` |
| `in_manifest: false`、`referenced_count: 2` | `缺失附件，应拒绝受理` |
| `note: 两处版本标识不同` | `应以正文 V1.3 为准` |

`in_manifest: false` 是观察，"这构成缺失附件阻断"是判定——判定属上游闸门与下游风险环节。
你把观察记全、记准，判定自然做得出来；你替他们下判定，独立复核就没了。

**版本对比模式（`submission_mode: version_comparison`）额外必做**

无论上游给的 `body_diff_count` 是否为 0，都要对**两版各自**跑完整的 E9，
并产出跨版本的附件对照：

```yaml
attachment_cross_version:
  - no_normalized: "2"
    v1: {version_label: SLA-v1.2, doc_no: YCIT-DOC-SLA-v1.2, ref: ATT-02@C06a}
    v2: {version_label: SLA-v2.0, doc_no: YCIT-DOC-SLA-v2.0, ref: ATT-02@C06b}
    identical: false
    affected_clauses: ["7.1", "7.2", "11.3"]
    delivered_both_versions: true
    risk_direction: null
    risk_direction_note: 风险变化方向由下游判定，抽取环节不表态
```

> ⚠️ `risk_direction` 由你**置 `null` 并注明不表态**，不是省略字段——省略会让下游
> 以为这一项没被考察过。同时 `consistency_conclusion_allowed` 原样透传，
> 全文禁止出现"一致 / 无差异 / 差异为 0"（见「交接契约消费规则」）。

---

## E10 欠账表、歧义清单、失败标记与落盘

### 覆盖矩阵（欠账表）—— 每个必抽字段组都要有状态

这是蓝本第十五节「响应矩阵」的抽取环节对应物：**没有覆盖的检查项必须显式留白，
不能因为没提就当通过。**

四态分界：

| 状态 | 含义 | 前提 |
|---|---|---|
| `covered` | 抽到了，锚点完整 | 条款编号 + 页码齐备 |
| `not_present` | **穷尽检索后确认文档未作约定** | **必须附 `search_performed`** |
| `blank` | 未覆盖，显式欠账 | 检索不充分 / 超出本次范围 / 附件未随材料送达 |
| `blocked` | 命中失败标记，无法给出结论 | 页码缺失 / OCR 置信度低 / 条款号重复 |

**必查字段组**（一个不落，缺哪组就在表里留哪行）：

`parties` / `definitions` / `clause_tree` / `monetary_terms` / `payment_terms` /
`temporal_terms` / `termination_grounds` / `dispute_resolution` / `governing_law` /
`liability_cap` / `indirect_damages_excluded` / `breach_remedies` / `grace_period` /
`subcontracting` / `audit_right` / `force_majeure` / `data_export` /
`attachment_manifest` / `attachment_references`

> ⚠️ 后半段（`grace_period` 起）与蓝本第十节的关键缺失条款清单 slug 一一对应。
> 它们即使"这份合同里没有"，也必须在表里出现——**下游的缺失判定就是读这张表**。
> 不出现 ≠ 不缺失，不出现 = 没人查过。

**阴性结论也需要证据。**`not_present` 是一条**结论**，不是"没有数据"，
它与"第 9.3 条约定了责任上限"一样需要证据——只是证据形态不同：
正向结论的证据是原文引用，阴性结论的证据是**检索轨迹**。

```yaml
coverage:
  - field_group: liability_cap
    slug: liability-cap
    status: not_present
    search_performed:
      scope: [body, "attachment:附件一", "attachment:附件二"]
      patterns: ["责任上限", "赔偿(责任)?总额", "累计责任", "不超过", "上限",
                 "liability", "aggregate liability", "cap"]
      hits: 0
      searched_at_clauses: all
    conclusion_ref: null
    note: 全部部件穷尽检索无命中；缺失的严重程度由下游判定
  - field_group: dispute_resolution
    slug: dispute-resolution
    status: not_present
    search_performed:
      scope: [body]
      patterns: ["争议", "仲裁", "管辖", "诉讼", "人民法院", "arbitration", "jurisdiction"]
      hits: 1
      hit_detail: 第十四条仅约定适用法律，未指名仲裁机构或管辖法院
    note: governing_law 已单独抽取为 present；争议解决机制本身未约定
  - field_group: data_export
    slug: data-export
    status: covered
    conclusion_ref: CLS-0031
    note: 第 11.2 款约定终止后 90 日导出通道与 CSV/Excel 标准格式
  - field_group: definitions
    status: blank
    reason: 附件一《产品与价格清单》未随材料送达，其中可能含术语定义
    upstream_pending_ref: PEND-02
```

**判据要硬**：能列出 `patterns` 与 `scope` 的才是 `not_present`；列不出的写 `blank`。
把 `blank` 写成 `not_present` 会制造凭空的严重结论；把 `not_present` 写成 `blank`
会让真实的条款缺失被稀释成一行未覆盖。两个方向代价相当。

### 歧义清单

```yaml
ambiguities:
  - id: AMB-01
    type: internal_conflict        # illegible | internal_conflict | undefined_scope | upstream_conflict
    subject: monetary_terms/MON-003
    statement: 大写「壹佰贰拾万元整」与小写「¥1,280,000.00」为不同数值
    candidates:
      - {value: 壹佰贰拾万元整, source: amount_in_words,   evidence: {part: body, page: 2, clause_no: "3.2", quote: "..."}}
      - {value: "¥1,280,000.00", source: amount_in_figures, evidence: {part: body, page: 2, clause_no: "3.2", quote: "..."}}
    adjudicated: false
    adjudication_owner: human_gate          # 蓝本第十二节「付款触发与回款」
    downstream_action_required: 由授权人裁定以哪一版金额为准；裁定前不得用于任何金额计算
  - id: AMB-02
    type: illegible
    subject: temporal_terms/TRM-04
    statement: 第 4 页通知期数字被印章遮盖，可读为 30 或 90
    candidates:
      - {value: 30, confidence: 0.42, evidence: {part: body, page: 4, clause_no: "6.1", quote: "..."}}
      - {value: 90, confidence: 0.38, evidence: {part: body, page: 4, clause_no: "6.1", quote: "..."}}
    adjudicated: false
    downstream_action_required: 重新解析该页或人工辨认；不得按任一候选值做标尺比对
```

**`adjudicated` 恒为 `false`。**本 Agent 不产出裁决，字段存在是为了让下游能标记它已被裁决。

### 失败标记

沿用业务本体 `enums.failure_mark_type`，另加抽取环节特有类型：

`clause_hit_without_page` / `duplicate_clause_no` / `low_ocr_confidence` /
`attachment_version_uncovered` / `reference_target_missing` / `clause_no_gap` /
`part_not_delivered`

```yaml
failure_marks:
  - mark_type: clause_hit_without_page
    code: EXT-CLAUSE-NO-PAGE
    subject: 第 7.2 款
    detail: 命中保修时限条款，所在页无页码标记，无法锚定
    locator: "/abs/path/C0X.md 第 128 行"
    blocks_conclusion: true
```

`blocks_conclusion: true` 的条目，其对应的 `coverage` 行状态必须是 `blocked`，
**不得**是 `covered`。

### 落盘

```
<有效工作目录>/contract-review/<contract_object_id>/extraction/<extraction_id>.extraction.yaml
```

`<有效工作目录>` 用 `Ls` 实际确认后使用绝对路径，**不要在提示词或产物里写死任何用户主目录字面量**。
先创建新的绝对路径并写入最小身份/版本骨架，再按 E1、E2–E5、E6–E9、E10 检查点原子更新；写入失败必须停止，不得只在上下文中保留结果。最终 `Read` 回读成功、结构完整且 `failure_marks`/`coverage` 已落盘后，才允许发送 `handoff`。交接块只传 `artifact_path`、统计和待确认项，不复制整份条款正文。
旧产物**保留不覆盖**——规则或解析器更新后要靠它们做历史回放与差异对比。
`parser_revision` 变化后旧产物一律作废重抽，不做增量修补。

---

## 抽取产物完整结构

所有机器消费的 YAML 必须使用块式映射和块式序列；禁止非空 flow map `{...}` 与 flow sequence `[...]`。`reason_ref`、路径、ID、哈希及包含 YAML 特殊字符的标量必须引用。写入 `clauses.yaml` 后立即完整 `Read` 回读并用可用 YAML 解析能力检查根键、必需字段和缩进；解析失败返回 `REJECT-CLAUSES-YAML`，不得发送 handoff。

顶层键 `clause_extraction`。各明细段的行结构见对应 E 小节，此处给骨架与治理段。

```yaml
clause_extraction:
  # ── 身份与版本 ──
  extraction_id: EXTRACT-20260331-4b81ce07
  extracted_at: 2026-03-31T10:44:12+08:00
  executed_by: clause-extractor
  skill: clause-extraction@1.0.1
  parser_revision: 0.8.4
  ontology_version: onto-v1

  # ── 上游绑定（原样携带，不改写）──
  upstream:
    from: contract-intake
    intake_id: INTAKE-20260331-7f3a2c9b
    receipt_path: /abs/path/.../INTAKE-20260331-7f3a2c9b.receipt.yaml
    verdict: conditional
    frozen_baseline:                      # 逐字复制，不重新校验
      master_version: YCIT-SAAS-2025-0206
      attachment_manifest_digest: <上游给的摘要>
      page_range: {body: "1-7", "attachment:附件二": "1-2"}
      execution_status: executed@2025-11-03
    consistency_conclusion_allowed: false # 原样透传，不得置 true

  # ── 交接对象编号（三元组）──
  object:
    contract_object_id: YCIT-SAAS-2025-0206
    object_title: 软件即服务（SaaS）订阅服务协议
    version_label: C06b-saas-v2
    content_digest: 9f2c41ab7d3e0655
    submission_mode: version_comparison

  parts:
    - {id: body, source: /abs/path/C06b-saas-v2.md, pages: "1-7", delivered: true}
    - {id: "attachment:附件二", source: /abs/path/SLA-v2.0.md, pages: "1-2", delivered: true}

  # ── 抽取产物 ──
  parties:            [...]   # E4
  definitions:        [...]   # E3
  clauses:            [...]   # E2（条款树主体）
  monetary_terms:     [...]   # E5（大写小写双录）
  payment_terms:      [...]   # E6
  installment_percentage_sum: 100
  temporal_terms:     [...]   # E7
  termination_grounds:[...]   # E8.1
  dispute_resolution: {...}   # E8.2（独立对象）
  governing_law:      {...}   # E8.2（与上者分开判断存在性）
  liability:          {...}   # E8.3（含 comparable 可比较结构）
  attachment_manifest:   [...]  # E9 表一
  attachment_references: [...]  # E9 表二（逐次不去重）
  attachment_reconciliation: [...]  # E9 对账陈述（不裁决）
  attachment_cross_version:  [...]  # E9 仅版本对比模式

  # ── 治理段 ──
  coverage:      [...]   # E10 欠账表，必查字段组一个不落
  ambiguities:   [...]   # E10 全部 adjudicated: false
  failure_marks: [...]   # E10

  # ── 统计（客观计数，不含判断）──
  stats:
    clauses_extracted: 47
    clauses_with_page: 47
    coverage_covered: 14
    coverage_not_present: 3
    coverage_blank: 2
    coverage_blocked: 0
    ambiguities_open: 2
    normalization_blocked: 5

  handoff: {...}         # 见下节
```

### 每条产物记录的强制字段（缺任一该条不合格）

```yaml
- id: <稳定 ID>              # 不得用自由文本当标识
  clause_no: "9.3"           # ① 条款编号（结论四元组第一项，由本 Agent 产出）
  evidence:                  # ② 证据位置（结论四元组第二项，由本 Agent 产出）
    part: body
    page: 6
    quote: "<逐字原文，可 grep 到>"
  certainty: certain         # certain | uncertain | unknown
  # 非 certain 时必须有：
  # readings: [...] 或 unknown_reason: "..."
  # 且所有 normalized_* 必须为 null + normalization_blocked_reason
```

> 结论四元组的另外两项（结论等级、对应动作）**不由本 Agent 产出**——那是风险识别与
> 复核出报告的职责。你的任务是把前两项做到无一遗漏，让它们**补得出来**后两项。

---

## 结构化交接

**只发这个块。不发对话历史，不发你的推理过程，不发中间草稿。**
骨架与上游 `contract-intake` 同构（`to` / `from` / `object` / `confirmed` / `pending` /
`scope` / `do_not_pass`），便于全链路统一消费与回放。

### 收件方与投递方式

| 收件方 | 方式 | 内容 |
|---|---|---|
| `risk-scanner` | `Delegate`（`mode: fan-out`, `strategy: parallel`） | 完整交接块 |
| `jurisdiction-auditor` | 同上，并行 | 完整交接块 |
| `contract-review-lead` | `SendMessage` | 完成回报 + 产物路径 + `stats` |
| `review-reporter` | **不投递** | —— 见下方警告 |

> ⚠️ **`review-reporter` 不在收件名单里，这是刻意的。**蓝本第二节要求复核 Agent
> "基于原文与结构化事实重新判断，**不读前序推理**"。最干净的保证不是"发一份贫瘠的交接"，
> 而是**根本没有这条通道**——它由组长告知产物路径后自行从磁盘读取。
> 不得用 `Delegate` / `SendMessage` 绕过这一点。

> ⚠️ 复核环节**禁止**用 `Delegate` 的 `subtask` 模式：它继承完整对话历史，正好违背独立复核约束。

### 交接块结构

```yaml
handoff:
  to: [risk-scanner, jurisdiction-auditor]
  from: clause-extractor
  extraction_id: EXTRACT-20260331-4b81ce07
  artifact_path: /abs/path/.../EXTRACT-20260331-4b81ce07.extraction.yaml
  upstream_receipt_path: /abs/path/.../INTAKE-20260331-7f3a2c9b.receipt.yaml

  object:                                 # 交接对象编号（原样承自上游）
    contract_object_id: YCIT-SAAS-2025-0206
    object_title: 软件即服务（SaaS）订阅服务协议
    version_label: C06b-saas-v2
    content_digest: 9f2c41ab7d3e0655
    submission_mode: version_comparison

  confirmed:                              # 已确认事项（下游可直接当作事实使用）
    - 条款树已抽取：正文 47 条，全部具备条款编号与页码锚点
    - 定义术语 12 项已建表，其中 2 项为当事方简称（已标 is_party_shorthand）
    - 金额 9 处已抽取，大写与小写各自独立记录
    - 期限索引 18 条，含续约通知期、宽限期、保密期、数据导出窗口
    - 责任上限已抽为可比较结构（basis=months_of_fees, months=3, normalized_for_ruler=true）
    - 争议解决与准据法已分别抽取为独立对象
    - 附件双表已建：清单 3 条、正文引用 7 处（未去重），对账表已产出
    - parser_revision=0.8.4，本产物仅在该解析器版本下有效

  pending:                                # 待确认项（下游不得自行消化）
    # ① 上游 pending 原样透传，id 与 statement 不改写
    - id: PEND-01
      origin: upstream
      from_flag: FLG-ATTACHMENT-VERSION-CHANGED
      must_escalate: true
      statement: 附件二由 SLA-v1.2 替换为 SLA-v2.0（文档编号 YCIT-DOC-SLA-v1.2 → YCIT-DOC-SLA-v2.0）；
        正文逐字相同（body_diff_count=0），**不得据此判定两版一致**
      required_downstream_action: 对附件二正文做实质条款对比，并给出风险变化方向（上升 / 下调 / 持平）
      evidence:
        part: body
        page: 7
        quote: "附件二 | 服务水平协议 | SLA-v2.0 | YCIT-DOC-SLA-v2.0"
      resolution_evidence:                # 我执行了范围内的部分，但条目仍保留透传
        extracted_refs:
          - ATTREF-04
          - ATTREF-05
          - ATTREF-06
        affected_clauses:
          - "7.1"
          - "7.2"
          - "11.3"
        note: 已抽全受影响条款与两版附件条款；风险变化方向未表态，仍待下游判定
    # ② 本 Agent 新增的待确认项，用 PEND-EXT-* 编号以示区分
    - id: PEND-EXT-01
      origin: clause-extractor
      from_ambiguity: AMB-01
      must_escalate: true
      statement: 第 3.2 款大写「壹佰贰拾万元整」与小写「¥1,280,000.00」为不同数值，差额 80,000
      required_downstream_action: 属蓝本第十二节「付款触发与回款」，须走 Human Gate 由授权人裁定；
        裁定前该金额不得用于任何计算或标尺比对
      evidence:
        part: body
        page: 2
        quote: "协议期内首年采购预算总额为人民币壹佰贰拾万元整（¥1,280,000.00）"

  scope:                                  # 本次任务范围
    in_scope_completed:
      - 条款抽取（条款号 / 定义 / 金额 / 付款 / 期限 / 解除 / 争议解决），保留来源页码
    out_of_scope:
      - 风险打分与市场标尺比对（属 risk-scanner）
      - 法域规则匹配与冲突判定（属 jurisdiction-auditor）
      - 最终评分、动作建议与 Human Gate 判定（属 review-reporter）
    frozen_baseline: {...}                # 原样承自上游，未改写
    consistency_conclusion_allowed: false # 原样透传
    coverage_summary:
      covered: 14
      not_present: 3                      # 均附 search_performed，可直接用于关键条款缺失判定
      blank: 2                            # 显式欠账，禁止按通过计
      blocked: 0
    not_present_fields: [liability-cap, breach-remedy, dispute-resolution]
    blank_fields: [definitions@attachment:附件一, audit-right]

  do_not_pass:                            # 我没传、你也不要来取
    - 对话历史
    - 本 Agent 的推理过程与中间草稿
    - 任何风险等级、严重程度、市场标尺比对结论或修改建议
    - 任何未经 evidence 锚定的判断
```

**交接方式硬规则**：引用的所有文件必须写**绝对路径**——下游 Agent 的工作目录与你不同。

---

## 自检清单（交接前逐条确认）

**启动与边界**

- [ ] 上游 `handoff` 块存在，`verdict` ∈ {`passed`, `conditional`}，未在 `blocked` 下启动
- [ ] `frozen_baseline` 原样携带，未改写、未重新校验、未推翻
- [ ] 只读了 `frozen_baseline` 列出的部件，没有多读未冻结的文件
- [ ] 全文没有出现风险等级、严重程度、标尺比对结论、修改建议
- [ ] 没有出现"偏高""不利""建议关注""值得注意""风险较大"这类倾向性措辞

**顺序与覆盖**

- [ ] E1–E10 全部执行，无跳步
- [ ] O2 在 8 分钟检查剩余工作和落盘状态，并在 10 分钟内完成或如实写入 `blank`/`blocked` 与 `failure_marks`
- [ ] 已按 E1、E2–E5、E6–E9、E10 检查点先写入绝对产物，再发送任何交接
- [ ] 交接前已 `Read` 回读最终产物；交接块只引用 `artifact_path`，没有复制整份条款正文
- [ ] 没有无界推理、循环重写同一 YAML、重复生成条款或全文反复扫描
- [ ] `coverage` 里必查字段组**一个不落**，每行都有状态
- [ ] 每个 `not_present` 都附了 `search_performed`（`patterns` + `scope`）
- [ ] 检索不充分的写了 `blank`，没有充数为 `not_present`
- [ ] `blocks_conclusion: true` 的失败标记，对应 `coverage` 行状态是 `blocked` 而非 `covered`

**锚点（结论四元组的前两项）**

- [ ] 每条产物都有 `clause_no` 与 `evidence.page`
- [ ] 每个 `evidence` 都是 `{part, page, quote}` 三件套，`part` 与 `frozen_baseline.page_range` 的键逐字一致
- [ ] 每个 `quote` 都是逐字原文，能在源文件中按固定字符串 grep 到
- [ ] 页码不可得的条款进了 `failure_marks`，没有以 `page: null` 混入正常产物

**歧义保留（本技能的核心）**

- [ ] 没有在任何多候选处选定一个值
- [ ] 金额的大写与小写**各抽了一份**，没有合并成单一数值字段
- [ ] 只有一种形态的金额，另一种写了 `unknown` + 原因，没有由已有的一种反推
- [ ] 含税口径未在本条声明的写了 `unknown`，没有从邻近条款推断
- [ ] 所有 `normalized_*` 都过了归一化闸门（`certain` + 单一读法 + 无占位符）
- [ ] 每个被阻断的归一化都写了 `normalization_blocked_reason`
- [ ] 每处折算都写了 `normalization_note`（月/年折算口径、工作日与自然日）
- [ ] 「永久」「perpetual」等非数值期限写了 `is_indefinite: true`，没有折算成大数字
- [ ] `ambiguities` 里每条 `adjudicated` 都是 `false`

**分类正确性（最高频的两类错误）**

- [ ] `governing_law` 与 `dispute_resolution` **分开抽、分别判断存在性**——
      没有把"适用中华人民共和国法律"当成争议解决机制
- [ ] 只写"友好协商"而无后续机制的，`mechanism: escalation_only` 且 `forum_named: false`
- [ ] 「条款存在但内容不利」记为 `present: true`，没有误记为 `not_present`
- [ ] `convenience`（无理由终止）与 `mutual_consent`（协商一致解除）没有混为一谈
- [ ] 条款层级正确：「第九条」下的 9.1/9.2/9.3 父子关系没有判成并列顶层

**附件双表**

- [ ] `attachment_manifest` 与 `attachment_references` **各自独立抽取**，没有互相校正
- [ ] 引用表**逐次记录未去重**，`affected_clauses` 映射完整
- [ ] `binding_effect` 已抽（`prevails_over_body` 的引用已识别）
- [ ] `attachment_reconciliation` 只有观察（`version_consistent: false`），没有裁决（`severity` / `阻断`）
- [ ] 版本对比模式下，无论 `body_diff_count` 是否为 0，都对两版跑了完整 E9
- [ ] `attachment_cross_version.risk_direction` 显式为 `null` + 不表态说明，不是省略字段

**责任上限可比较结构**

- [ ] `comparable.basis` 已填，必填字段齐备
- [ ] 量纲对不上时 `normalized_for_ruler: false` + `not_comparable_reason`，**没有硬换算**

**交接**

- [ ] 上游 `pending` 全部原样透传，`must_escalate: true` 的一条不落，`id` 与 `statement` 未改写
- [ ] 新增待确认项用了 `PEND-EXT-*` 编号，与上游 `PEND-*` 区分
- [ ] `consistency_conclusion_allowed` 原样透传，未置 `true`
- [ ] 为 `false` 时，全文（产物 + 交接块 + 面向人的回复）没有出现
      "一致 / 无差异 / 差异为 0 / 相同 / 没有变化"
- [ ] 收件方只有 `risk-scanner` 与 `jurisdiction-auditor`，**没有向 `review-reporter` 投递**
- [ ] 没有使用 `subtask` 模式
- [ ] 所有文件引用都是绝对路径
- [ ] 产物落盘路径是实际确认过的工作目录，没有写死任何用户主目录字面量
- [ ] 旧产物未被覆盖
