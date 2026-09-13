# E2–E5：条款结构与核心事实

<!-- clause-extraction@1.0.13：由 SKILL.md 在 E2–E5 前按需加载。 -->

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
