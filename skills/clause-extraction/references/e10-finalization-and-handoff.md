# E10、最终产物与交接

<!-- clause-extraction@1.0.13：由 SKILL.md 在 E10 前按需加载。 -->

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
`part_not_delivered` / `quote_verification_incomplete` / `quote_verification_failed`

批量固定字符串核验未完整返回时，使用 `quote_verification_incomplete`（代码
`EXT-QUOTE-VERIFY-INCOMPLETE`）记录已核验的源 SHA-256、实际位置和未穷尽原因；SHA
不匹配、无位置或工具失败时使用 `quote_verification_failed`，对应覆盖项必须是
`blank` 或 `blocked`，不得把失败伪装成阴性结论。

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
Team sync: <实际确认的 team effective cwd>/members/clause-extractor/<入站 case_id>/<本次 extraction_id>/artifact/<extraction_id>.extraction.yaml
独立运行: <本 Agent 已确认的 workspace>/contract-review/<contract_object_id>/extraction/<extraction_id>.extraction.yaml
```

团队 sync 的 `<实际确认的 team effective cwd>` 必须用当前 effective cwd 的 `Ls` 实际确认；case_id 只逐字复用完整入站 handoff，extraction_id 只使用本次真实 `GenerateUUID` 返回值（可保留既有 `EXTRACT-` 固定前缀），不得从 task、路径或旧回执推导。**不要在提示词或产物里写死任何用户主目录字面量**。团队路径必须位于 member-owned `members/clause-extractor/.../artifact/`，不得改写或复用 Lead `contract-review/**`、共享 `<extraction_id>.extraction.yaml` 或任何其他 Agent 产物；独立非 Team 运行保持本 Agent 的确认 workspace。
先按主控制器创建 typed partial checkpoint；完成 E1 后读取 release-owned v2.2 authoring scaffold，并按 E2–E5、E6–E9、E10 用有界 Edit 增量填写同一路径。不要反复整文件 Write，也不要在每次增量后重跑最终 schema。最终 `ready_for_handoff` 文件必须先带确定的本文件绝对 `artifact_path` 与唯一 `to: contract-review-lead`，然后完整 `Read` 回读，并以 `${SKILL_DIR}/references/clause-extraction-artifact-v22.schema.json` 调用 `StructuredFileValidate(document_path: <exact artifact>, schema_path: <exact release-owned schema>, format: yaml)`。只接受公共 `success:true` 与 `valid:true`；`valid:false` 允许一次本 Agent `Edit` 修复，修复后必须重新 `Read` 和重验。第二次不匹配、Read/工具/范围/512 KiB/8,000 nodes/depth 64 失败时，保留实际 code，写 `blocked` 或 `partial` 与 `handoff: null`，并 return HOLD 事实给同步 Lead。验证成功后最终文件不可变；任何后续 `Write`/`Edit` 都使旧结果失效，必须重新 Read 和验证。不得把返回 hash、模型自述或 `valid` 字段写进业务产物。
旧产物**保留不覆盖**——规则或解析器更新后要靠它们做历史回放与差异对比。
`parser_revision` 变化后旧产物一律作废重抽，不做增量修补。

---

## 抽取产物完整结构

所有机器消费的 YAML 必须使用块式映射和块式序列；禁止非空 flow map 与 flow sequence。当前 v2.2 唯一可读取的写作骨架是 `${SKILL_DIR}/references/clause-extraction-artifact-v22-authoring-scaffold.yaml`；它保持 `partial`、`handoff: null` 且故意不能作为 ready 交接。最终产物为 `<extraction_id>.extraction.yaml`，不再使用历史 `clauses.yaml` 或 1.0.1 shape。

v2 的 E2–E10 明细在 `payloads` 下以字段组名键入；每个字段组都必须存在且是严格 evidence-carrying records。不可把未交付部件删除、把 quote 失败改成阴性结论，或把任何 local YAML/JSON/Ajv 检查当作运行时工具事实。`StructuredFileValidate` 只验证单个 YAML 的受限 Draft-07 结构，不证明来源、跨记录相等、quote、DOCX provenance、法律结论或 Human Gate；`success:true, valid:true` 只解除本 Agent 的结构闸门。工具失败或 `valid:false` 时最终状态只能 `blocked` 或 `partial` 且 `lifecycle.handoff: null`。

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
  # readings: use one block sequence; unknown_reason: "..."
  # 且所有 normalized_* 必须为 null + normalization_blocked_reason
```

> 结论四元组的另外两项（结论等级、对应动作）**不由本 Agent 产出**——那是风险识别与
> 复核出报告的职责。你的任务是把前两项做到无一遗漏，让它们**补得出来**后两项。

---

## 结构化交接

**只发这个块。不发对话历史，不发你的推理过程，不发中间草稿。**
骨架与上游 `contract-intake` 同构（`to` / `from` / `object` / `confirmed` / `pending` /
`scope` / `do_not_pass`），便于全链路统一消费与回放。

### 唯一回传方与方式

本 Agent 不调度下游。`contract-review-lead` 是唯一的 O2/O3 编排、账本和派发责任方；本 Agent 只在其 `Delegate(mode: sync)` 返回后，将下列交接数据作为同步结果返回给调用方。不得调用 `Delegate`、`SendMessage` 或任何下游 Agent；不得把 task 裸字段、文件名或旧摘要当作交接身份。

最终 return 只包含这一个已验证产物的绝对 `artifact_path`、下列结构化 `handoff`、`stats`、`failure_marks` 与 `pending`。不附对话历史、推理过程、中间草稿、opaque canonical Read ref、工具 hash 或模型自述的校验结论。

### 回传数据结构

```yaml
handoff:
  to: contract-review-lead
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
      - 风险打分与市场标尺比对（由 Lead 派发 risk-scanner）
      - 法域规则匹配与冲突判定（由 Lead 派发 jurisdiction-auditor）
      - 最终评分、动作建议与 Human Gate 判定（由 Lead 派发 review-reporter）
    frozen_baseline:
      # use the v2 block mapping from the canonical template; do not inline flow YAML
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

**回传硬规则**：引用的所有文件必须写**绝对路径**；只有最终文件已经 `Read` 且 `StructuredFileValidate` 返回 `success:true, valid:true` 后，才能 return。Lead 必须仍按 O2 同调用 Compose 和既有 RC/HG 验收，不能把本回传替代 Compose。

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
- [ ] 本次产物是确认 workspace 下唯一的新 extraction 文件，未写入或覆盖 lead/shared 路径、`<extraction_id>.extraction.yaml` 或其他 Agent 产物
- [ ] 交接前已 `Read` 回读最终产物；交接块只引用 `artifact_path`，没有复制整份条款正文
- [ ] 没有无界推理、循环重写同一 YAML、重复生成条款或全文反复扫描
- [ ] `coverage` 里必查字段组**一个不落**，每行都有状态
- [ ] 每个 `not_present` 都附了 `search_performed`（`patterns` + `scope`）
- [ ] 检索不充分的写了 `blank`，没有充数为 `not_present`
- [ ] 每批 `Grep.literals` 都符合 64 项 / 单项 2 KiB / 合计 16 KiB / 源文件 5 MiB / 文件字节数乘项数 64 MiB 的预算，并传入原生数组
- [ ] 每个 quote 的返回 SHA-256 与同一冻结部件的 FileDigest SHA-256 相同；`incomplete` 只保留实际命中位置并留有欠账，未被写成阴性或穷尽结论
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
- [ ] 唯一回传方是同步调用的 `contract-review-lead`；没有向 `risk-scanner`、`jurisdiction-auditor` 或 `review-reporter` 投递
- [ ] 没有调用 `Delegate`、`SendMessage`、`subtask` 或创建第二条调度路径
- [ ] 所有文件引用都是绝对路径
- [ ] 产物落盘路径是实际确认过的工作目录，没有写死任何用户主目录字面量

## v2.2 DOCX canonical-text contract

只用 SHA-256 `fc5355dfc349bde3ff52e0b05171010f7b6d8db0d5d3811576baf02ae7090d3d` 的 `schemas/clause-extraction-artifact-v22.schema.json` 与 `clause-extraction@1.0.13` 创建当前 v2.2 新产物。它是 v2.1 的 sibling；不得改写 v2.1 产物、fixture、schema bytes 或 pins。`source_representations[]` 对每个 delivered part 恰有一项，对 undelivered part 没有项；全部未交付时为 `[]` 并保持 HOLD。`source_sha256`、`source_size_bytes` 始终标识原冻结文件字节，不放 derived-text digest。text part 使用 `original_text`；DOCX part 使用 `canonical_text`，精确携带 `derived_text_sha256`、`text_offset_codec: utf16_code_unit` 和 `derived_text_utf16_code_units`。只有 Lead 明确选择其已发布的 v2.3 current-parts admission path 时，本 Agent 才能返回 v2.2；本 Agent 的单文件结构校验不构成该选择或 admission。

DOCX part 先用已注册 generic canonical Read preparation。它返回仅归本 Agent、本 conversation 和 exact optional Work Context 所有的 private opaque reference；该 reference 不是 artifact/handoff 字段、Lead 输入、文件路径或 delegation capability。只按 zero-based `utf16_offset` 与 `utf16_limit` 读取 canonical text，保留每页返回的 original SHA/size、derived SHA、codec 和连续 slice coordinates。不得用普通 path Read 降级替代。

仅在 `slice_utf16_end` 严格前进且不切 surrogate pair 时继续，从返回 end 接续；只在 `complete: true` 停止。reference 过期、owner/context 失败、range/budget 错误或 original/derived tuple 改变时，丢弃 partial canonical reading，重新 prepare 并从 offset zero 开始。无法在本次有界运行完成时保留真实错误 debt，相关记录为 blank/blocked，handoff 保持 null。

DOCX 正向 evidence 沿用 payload record、coverage 和 ambiguity candidate 三个 v2.1 路径。每个非空 quote 从 canonical Read 逐字复制，`utf16_offsets` 是该 canonical representation 的数值偏移，不能是 line label 或 byte offset。`exact_quote: null` 不进入正向 literal 核验。声明不是证明：Lead 必须使用已注册的 same-call generic Compose `derived_source` operand，把 worker-private provenance 与本 artifact 独立绑定。该 Compose 或 release-owned rule/pin 不可用、拒绝、失败或不匹配时为 HOLD；模型比较、普通 Grep 或本 Agent schema pass 都不能替代。

Lead 把 `source_representations` 当作 delivered-subset exact tuple map，不把它当自认证 provenance。对每个且只对 `parts[].delivered: true` 成员，要求唯一匹配 `part_id`、`source_name`、`format`、original `source_sha256` 和 `source_size_bytes`，并与 `frozen_baseline.parts` 相同；duplicate、extra、omission、false-delivery entry 或任一 mismatch 都是 HOLD。same-call Compose receipt 再独立绑定声明的 DOCX derived fields。
