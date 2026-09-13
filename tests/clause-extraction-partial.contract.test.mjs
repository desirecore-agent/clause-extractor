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
  assert.equal(agent.version, '1.0.11')
  assert.equal(frontmatterVersion, agent.version)
  assert.equal(metadataVersion, frontmatterVersion)
  assert.equal(template.clause_extraction.skill, `clause-extraction@${frontmatterVersion}`)
  assert.equal(partialSchema.properties.clause_extraction.properties.skill.const, template.clause_extraction.skill)
  assert.equal(template.clause_extraction.lifecycle.state, 'partial')
  assert.equal(template.clause_extraction.lifecycle.handoff, null)
  assert.doesNotMatch(templateText, /[{}\[\]]/, 'machine-consumed checkpoint template must use block YAML, not flow collections')
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
