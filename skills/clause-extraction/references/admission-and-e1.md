# 启动准入、交接消费与 E1

<!-- clause-extraction@1.0.13：由 SKILL.md 在 E1 前按需加载。 -->

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
