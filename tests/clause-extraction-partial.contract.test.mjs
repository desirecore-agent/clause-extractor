import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const platformRequire = createRequire(new URL('../../package.json', root))
const YAML = platformRequire('yaml')
const Ajv = platformRequire('ajv')
const agent = JSON.parse(readFileSync(new URL('agent.json', root), 'utf8'))
const skill = readFileSync(new URL('skills/clause-extraction/SKILL.md', root), 'utf8')
const partialSchema = JSON.parse(readFileSync(new URL('skills/clause-extraction/references/clause-extraction-partial-checkpoint-v1.schema.json', root), 'utf8'))
const readySchema = JSON.parse(readFileSync(new URL('schemas/clause-extraction-artifact-v22.schema.json', root), 'utf8'))
const templateText = readFileSync(new URL('skills/clause-extraction/references/clause-extraction-partial-checkpoint-v1.yaml', root), 'utf8')
const templateDocument = YAML.parseDocument(templateText, { uniqueKeys: true, merge: false })
assert.equal(templateDocument.errors.length, 0, templateDocument.errors.map(error => error.message).join('; '))
const template = templateDocument.toJS()
const frontmatterVersion = /^version:\s*([^\r\n]+)$/m.exec(skill)?.[1].trim()
const metadataVersion = /^  version:\s*([^\r\n]+)$/m.exec(skill)?.[1].trim()

function clone(value) {
  return structuredClone(value)
}

test('partial checkpoint template is block-style, binds the actual Clause identity, and validates', () => {
  assert.equal(agent.version, '1.0.12')
  assert.equal(frontmatterVersion, agent.version)
  assert.equal(metadataVersion, frontmatterVersion)
  assert.equal(template.clause_extraction.skill, `clause-extraction@${frontmatterVersion}`)
  assert.equal(partialSchema.properties.clause_extraction.properties.skill.const, template.clause_extraction.skill)
  assert.equal(template.clause_extraction.lifecycle.state, 'partial')
  assert.equal(template.clause_extraction.lifecycle.handoff, null)
  assert.doesNotMatch(templateText, /[{}]/, 'machine-consumed checkpoint template must use block YAML mappings')
  assert.match(templateText, /^    completed_groups: \[\]$/m, 'the initial checkpoint must explicitly represent no completed E group')
  assert.equal((templateText.match(/^\s*[^#\r\n]+:\s*\[[^\]]+\]\s*$/gm) ?? []).length, 0, 'non-empty flow collections are forbidden in the checkpoint template')
  const validate = new Ajv({ strict: false }).compile(partialSchema)
  assert.equal(validate(template), true, JSON.stringify(validate.errors))
})

test('partial checkpoint closes the four E groups without overlap or omission', () => {
  const validate = new Ajv({ strict: false }).compile(partialSchema)
  const overlap = clone(template)
  overlap.clause_extraction.checkpoint.remaining_groups.unshift('E1')
  assert.equal(validate(overlap), false, 'one group cannot be both complete and remaining')
  const omission = clone(template)
  omission.clause_extraction.checkpoint.remaining_groups = ['E2-E5', 'E6-E9']
  assert.equal(validate(omission), false, 'every fixed E group must remain on exactly one side')
  const unknown = clone(template)
  unknown.clause_extraction.checkpoint.remaining_groups[0] = 'E11'
  assert.equal(validate(unknown), false, 'groups are closed to E1, E2-E5, E6-E9, and E10')
})

test('partial checkpoint cannot impersonate a ready artifact or carry a downstream handoff', () => {
  const validatePartial = new Ajv({ strict: false }).compile(partialSchema)
  const validateReady = new Ajv({ strict: false }).compile(readySchema)
  const withHandoff = clone(template)
  withHandoff.clause_extraction.lifecycle.handoff = { to: 'contract-review-lead' }
  assert.equal(validatePartial(withHandoff), false)
  assert.equal(validateReady(template), false, 'a partial checkpoint is never a v2.2 ready artifact')
})

test('partial checkpoint requires inbound frozen member facts rather than a self-authored summary', () => {
  const validate = new Ajv({ strict: false }).compile(partialSchema)
  const incompletePart = clone(template)
  delete incompletePart.clause_extraction.frozen_baseline.parts[0].sha256
  assert.equal(validate(incompletePart), false)
  const unboundCase = clone(template)
  unboundCase.clause_extraction.case_id = ''
  assert.equal(validate(unboundCase), false)
})


test('startup procedure validates the typed partial checkpoint before any E1 source analysis', () => {
  const start = skill.indexOf('### Typed partial checkpoint 启动序列（必须逐项执行）')
  const e1 = skill.indexOf('## E1 上游核验与对象绑定')
  assert.ok(start >= 0 && e1 > start)

  const startup = skill.slice(start, e1)
  for (const required of [
    'clause-extraction-partial-checkpoint-v1.schema.json',
    'clause-extraction-partial-checkpoint-v1.yaml',
    '下一次工具调用必须为 `Write`',
    'clause_extraction.case_id',
    'completed_groups` 为空',
    'remaining_groups` 恰为 `[E1, E2-E5, E6-E9, E10]`',
    '只有 E1 已按既有规则完成后才把 E1 移入 completed_groups',
    'StructuredFileValidate(document_path=<exact artifact>',
    'success:true, valid:true',
    '按既有 E1 规则读取全部 frozen baseline 部件并完成 E1',
    '把 E1 从 remaining_groups 移入 completed_groups',
    '不得读合同正文或附件、`Grep`、`MathCalc`',
    '立即 `Write` 当前已证实事实及 `blank`/`blocked` failure marks 并停止本轮',
  ]) {
    assert.ok(startup.includes(required), `startup must require ${required}`)
  }
  assert.ok(startup.includes('final v2.2 ready candidate'))
  for (const preservedConstraint of [
    '既有 E1–E10',
    '每个非空 `exact_quote` 必须直接复制自最近一次针对同一 `part` 的 `Read` 或 `Grep` 结果',
    '禁止根据记忆、摘要、思考内容或上游交接块重打原文',
    'coverage',
    'failure marks',
    'Human Gate',
    '独立非 Team 运行保持自己的已确认 `workspace` 路径',
    '不得为新父目录循环 `Ls`',
    '每个 E 组最多一次局部读取和一次 `Write` 更新',
    '不得重新运行输入治理或反复全文读取',
    '10 分钟前必须写入当前事实',
    '不得伪造完整 37 条或发送“已完成”回执',
    '不得自行 `Delegate` 或 `SendMessage`，partial 或失败均 HOLD',
  ]) {
    assert.ok(skill.includes(preservedConstraint), `Skill must retain ${preservedConstraint}`)
  }
})

test('native literal batches use the verified source path and no scalar search mode', () => {
  const start = skill.indexOf('### 原生 `Grep.literals` 批量核验（冻结来源、逐项结果）')
  const end = skill.indexOf('## 启动前置条件', start)
  assert.ok(start >= 0 && end > start)
  const batch = skill.slice(start, end)
  assert.match(batch, /Grep\(\{\s*path: <同一候选已确认的 source_abs_path 原样值>,\s*literals: \[<逐项固定字符串>\],\s*\}\)/s)
  for (const prohibited of ['`pattern`', '`output_mode`', '`glob`', '`type`', '`head_limit`', '`offset`', '`context_lines`', '`context`', '`-A`', '`-B`', '`-C`', '`-n`', '`-i`']) {
    assert.ok(batch.includes(prohibited), `batch instructions must reject ${prohibited}`)
  }
  assert.match(batch, /只能是 `false`，绝不得为 `true`/)
  assert.match(batch, /同一 source 与同一 native literals batch.*更正一次/s)
  assert.match(batch, /不得转成 many-pattern 或单条 pattern 调用/)
})
