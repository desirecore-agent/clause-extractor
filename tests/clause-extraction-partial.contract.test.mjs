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
const admission = readFileSync(new URL('skills/clause-extraction/references/admission-and-e1.md', root), 'utf8')
const scaffoldText = readFileSync(new URL('skills/clause-extraction/references/clause-extraction-artifact-v22-authoring-scaffold.yaml', root), 'utf8')
const partialSchema = JSON.parse(readFileSync(new URL('skills/clause-extraction/references/clause-extraction-partial-checkpoint-v1.schema.json', root), 'utf8'))
const readySchema = JSON.parse(readFileSync(new URL('schemas/clause-extraction-artifact-v22.schema.json', root), 'utf8'))
const templateText = readFileSync(new URL('skills/clause-extraction/references/clause-extraction-partial-checkpoint-v1.yaml', root), 'utf8')
const templateDocument = YAML.parseDocument(templateText, { uniqueKeys: true, merge: false })
assert.equal(templateDocument.errors.length, 0, templateDocument.errors.map(error => error.message).join('; '))
const template = templateDocument.toJS()
const frontmatterVersion = /^version:\s*([^\r\n]+)$/m.exec(skill)?.[1].trim()
const metadataVersion = /^  version:\s*([^\r\n]+)$/m.exec(skill)?.[1].trim()
const releaseOwnedReferences = [
  'admission-and-e1.md',
  'e2-e5-structure-and-core-facts.md',
  'e6-e9-obligations-and-attachments.md',
  'e10-finalization-and-handoff.md',
  'legacy-v2-v21-contracts.md',
  'clause-extraction-partial-checkpoint-v1.schema.json',
  'clause-extraction-partial-checkpoint-v1.yaml',
  'clause-extraction-artifact-v22-authoring-scaffold.yaml',
  'clause-extraction-artifact-v22.schema.json',
]

function clone(value) {
  return structuredClone(value)
}

test('partial checkpoint template is block-style, binds the actual Clause identity, and validates', () => {
  assert.equal(agent.version, '1.0.13')
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

test('every staged rule resource is present and routed from the compact controller', () => {
  assert.ok(Buffer.byteLength(skill) < 12 * 1024, 'the always-loaded controller must stay compact')
  for (const name of releaseOwnedReferences) {
    const content = readFileSync(new URL(`skills/clause-extraction/references/${name}`, root), 'utf8')
    assert.ok(content.length > 0, `${name} must be a non-empty release-owned resource`)
    assert.ok(skill.includes(`references/${name}`), `${name} must have an explicit load route in SKILL.md`)
    assert.ok(skill.includes(`- \`references/${name}\``), `${name} must be in the release list`)
  }
  assert.match(readFileSync(new URL('skills/clause-extraction/references/e2-e5-structure-and-core-facts.md', root), 'utf8'), /## E2[\s\S]*## E3[\s\S]*## E4[\s\S]*## E5/)
  assert.match(readFileSync(new URL('skills/clause-extraction/references/e6-e9-obligations-and-attachments.md', root), 'utf8'), /## E6[\s\S]*## E7[\s\S]*## E8[\s\S]*## E9/)
  assert.doesNotMatch(skill, /templates\/clause-extraction-artifact\.yaml/)
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
  const start = skill.indexOf('### 1. 建立 typed checkpoint')
  const staged = skill.indexOf('### 2. 按组读取和小步写入')
  assert.ok(start >= 0 && staged > start)
  const startup = skill.slice(start, staged)
  for (const required of [
    'clause-extraction-partial-checkpoint-v1.schema.json',
    'clause-extraction-partial-checkpoint-v1.yaml',
    '下一次工具调用必须为 `Write`',
    'completed_groups` 为空',
    'remaining_groups` 恰为 `[E1, E2-E5, E6-E9, E10]`',
    '不得先读合同正文、附件或运行 `Grep`/`MathCalc`',
    'success:true, valid:true',
    '不能声称已经保存详细事实',
    '不能交接',
  ]) assert.ok(startup.includes(required), `startup must require ${required}`)
  assert.match(admission, /## E1 上游核验与对象绑定/)
  for (const required of [
    'E1–E10',
    '每个非空 `exact_quote` 必须逐字复制自最近一次同一 frozen part 的 `Read` 或 canonical Read',
    '19 个 coverage row',
    'Human Gate',
    '独立运行使用本 Agent 已确认 workspace',
    '到 8 分钟后不得再发起任何新 `Grep` batch',
    '10 分钟后不得继续生成大段最终内容',
    '不得自行 `Delegate`、`SendMessage`',
  ]) assert.ok(skill.includes(required), `Skill must retain ${required}`)
})

test('native literal batches are single-pass per unchanged source identity', () => {
  const start = skill.indexOf('## 单次来源 literals 核验')
  const end = skill.indexOf('## 最终 ready 和交接', start)
  assert.ok(start >= 0 && end > start)
  const batch = skill.slice(start, end)
  assert.match(batch, /Grep\(\{\s*path: <同一候选已确认的 source_abs_path 原样值>,\s*literals: \[<逐项固定字符串>\],\s*\}\)/s)
  for (const prohibited of ['`pattern`', '`output_mode`', '`glob`', '`type`', '`head_limit`', '`offset`', '`context_lines`', '`-A`', '`-B`', '`-C`', '`-n`', '`-i`']) {
    assert.ok(batch.includes(prohibited), `batch instructions must reject ${prohibited}`)
  }
  assert.match(batch, /缺省或为 `false`/)
  assert.match(batch, /相同 source 和相同 native batch 修正一次/)
  assert.match(batch, /不降级成逐条 pattern/)
  assert.match(batch, /不得为了“再确认”发第二次相同 source\+literals Grep/)
  assert.match(batch, /Lead 的独立复验/)
})

test('the authoring scaffold is visibly partial and cannot impersonate ready output', () => {
  const doc = YAML.parseDocument(scaffoldText, { uniqueKeys: true, merge: false })
  assert.equal(doc.errors.length, 0, doc.errors.map(error => error.message).join('; '))
  const scaffold = doc.toJS().clause_extraction
  assert.equal(scaffold.lifecycle.state, 'partial')
  assert.equal(scaffold.lifecycle.handoff, null)
  assert.equal(scaffold.payloads.length, 14)
  assert.equal(new Set(scaffold.payloads.map(entry => entry.group)).size, 14)
  assert.equal(scaffold.coverage.length, 19)
  assert.equal(new Set(scaffold.coverage.map(row => row.slug)).size, 19)
  assert.deepEqual(scaffold.ambiguities, [])
  const validateReady = new Ajv({ strict: false }).compile(readySchema)
  assert.equal(validateReady({ clause_extraction: scaffold }), false, 'the incomplete scaffold must not pass the final schema')
  assert.match(skill, /references\/clause-extraction-artifact-v22-authoring-scaffold\.yaml/)
  assert.match(skill, /最终候选完整后才做一次完整 Read \+ 最终 SFV/)
})
