# E6–E9：义务、期限、责任与附件

<!-- clause-extraction@1.0.13：由 SKILL.md 在 E6–E9 前按需加载。 -->

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

用 `Grep` 全量搜引用形态（`pattern` 加 `is_regex: true`）：`附件[一二三四五六七八九十\d]+`、`Exhibit [A-Z]`、
`Schedule \d`、`Annex \w`、`Appendix \w`、`附表\w`。这不替代前述固定 quote 的原生 `Grep.literals` 批量核验。

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
