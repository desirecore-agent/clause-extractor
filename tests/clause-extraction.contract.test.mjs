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
const schemaText = readFileSync(new URL('schemas/clause-extraction-artifact.schema.json', root), 'utf8')
const schema = JSON.parse(schemaText)
const fixture = name => readFileSync(new URL(`fixtures/structured-contract/${name}`, root), 'utf8')
const expectations = JSON.parse(readFileSync(new URL('fixtures/structured-contract/expectations.json', root), 'utf8'))
for (const { file } of expectations.fixtures) assert.ok(fixture(file).length > 0, `missing fixture: ${file}`)
const parseYaml = name => {
  const raw = fixture(name)
  assert.doesNotMatch(raw, /(^|\s)([&*!]|<<:)/m, `${name} must not use YAML anchors, aliases, tags, or merges`)
  const doc = YAML.parseDocument(raw, { uniqueKeys: true, merge: false })
  assert.equal(doc.errors.length, 0, `${name}: ${doc.errors.map(error => error.message).join('; ')}`)
  return doc.toJS()
}
const allowed = new Set(['$schema', 'title', 'description', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'allOf', 'anyOf', 'oneOf', 'not'])
function assertRestricted(value, propertyNames = false) {
  if (Array.isArray(value)) return value.forEach(item => assertRestricted(item, false))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (!propertyNames) assert.ok(allowed.has(key), `forbidden v1b schema keyword: ${key}`)
    assertRestricted(child, key === 'properties')
  }
}
function semanticHold(artifact) {
  const x = artifact.clause_extraction
  if (x.lifecycle.state !== 'ready_for_handoff' && x.lifecycle.handoff !== null) return true
  if (x.lifecycle.state === 'ready_for_handoff' && x.lifecycle.handoff === null) return true
  if (x.part_count !== x.parts.length || JSON.stringify(x.parts) !== JSON.stringify(x.frozen_baseline.parts)) return true
  if (Date.parse(x.lifecycle.deadline_at) <= Date.parse('2026-09-11T00:30:00Z') && x.lifecycle.state === 'ready_for_handoff') return true
  const groups = x.payloads.map(entry => entry.group)
  if (new Set(groups).size !== 14) return true
  const slugs = x.coverage.map(row => row.slug)
  if (new Set(slugs).size !== 19) return true
  return x.parts.some(part => !part.delivered && x.coverage.some(row => row.status === 'not_present'))
}

test('uses the bounded structural validator without outbound scheduling authority', () => {
assert.equal(agent.version, '1.0.13', 'v2.2 fixture and release schema require the current exact Agent version')
  assert.equal(agent.llm.routingMode, 'smart')
  assert.ok(agent.tool_permissions.denied.includes('Bash'))
  assert.ok(agent.tool_permissions.allowed.includes('StructuredFileValidate'))
  assert.ok(!agent.tool_permissions.allowed.includes('Delegate'))
  assert.ok(!agent.tool_permissions.allowed.includes('SendMessage'))
  assert.equal(agent.command_authority.enabled, false)
  assert.match(skill, /success:true.*valid:true/)
  assert.match(skill, /第二次不匹配.*handoff: null/)
  assert.match(skill, /验证成功后最终文件不可变/)
})

test('parses and validates the full v2 positive fixture with restricted Draft-07', () => {
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#')
  assert.ok(Buffer.byteLength(schemaText) <= 32 * 1024)
  assertRestricted(schema)
  const count = value => value && typeof value === 'object' ? 1 + Object.values(value).reduce((sum, child) => sum + count(child), 0) : 1
  assert.ok(count(schema) <= 1024)
  const validate = new Ajv({ strict: false }).compile(schema)
  const valid = parseYaml('valid-ready.yaml')
  assert.equal(validate(valid), true, JSON.stringify(validate.errors))
  assert.equal(semanticHold(valid), false)
})

test('rejects malformed YAML and invalid structural lifecycle fixtures', () => {
  const malformed = YAML.parseDocument(fixture('invalid-quoted-suffix.yaml'), { uniqueKeys: true, merge: false })
  assert.ok(malformed.errors.length > 0)
  const duplicate = YAML.parseDocument(fixture('invalid-duplicate-key.yaml'), { uniqueKeys: true, merge: false })
  assert.ok(duplicate.errors.length > 0)
  const validate = new Ajv({ strict: false }).compile(schema)
  assert.equal(validate(parseYaml('invalid-ready-null-handoff.yaml')), false)
})

test('rejects central v2 structural constraints under Ajv', () => {
  const validate = new Ajv({ strict: false }).compile(schema)
  const valid = parseYaml('valid-ready.yaml')
  const unknownGroup = structuredClone(valid)
  unknownGroup.clause_extraction.payloads[0].group = 'forged_group'
  assert.equal(validate(unknownGroup), false)
  const incompleteNegative = structuredClone(valid)
  incompleteNegative.clause_extraction.coverage[0].status = 'not_present'
  incompleteNegative.clause_extraction.coverage[0].exhaustive = false
  assert.equal(validate(incompleteNegative), false)
  for (const mutate of [
    evidence => { evidence.exact_quote = null },
    evidence => { evidence.positions = [] },
  ]) {
    const badPositive = structuredClone(valid)
    mutate(badPositive.clause_extraction.payloads[0].records[0].evidence[0])
    assert.equal(validate(badPositive), false)
  }
})

test('holds semantic map/count, duplicate coverage, debt, and deadline cases without calling them schema success', () => {
  const valid = parseYaml('valid-ready.yaml')
  const countMismatch = structuredClone(valid); countMismatch.clause_extraction.part_count = 2
  assert.equal(semanticHold(countMismatch), true)
  const duplicateCoverage = structuredClone(valid); duplicateCoverage.clause_extraction.coverage[18].slug = duplicateCoverage.clause_extraction.coverage[0].slug
  assert.equal(semanticHold(duplicateCoverage), true)
  const blocked = structuredClone(valid); blocked.clause_extraction.lifecycle = { ...blocked.clause_extraction.lifecycle, state: 'blocked', handoff: null, repair_attempt: 2 }
  assert.equal(semanticHold(blocked), false)
  const timeout = structuredClone(valid); timeout.clause_extraction.lifecycle.deadline_at = '2026-09-11T00:01:00Z'
  assert.equal(semanticHold(timeout), true)
})
