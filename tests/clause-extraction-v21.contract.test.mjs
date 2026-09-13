import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createHash } from 'node:crypto'

const root = new URL('..', import.meta.url)
const platformRequire = createRequire(new URL('../../package.json', root))
const YAML = platformRequire('yaml')
const Ajv = platformRequire('ajv')
const agent = JSON.parse(readFileSync(new URL('agent.json', root), 'utf8'))
const skill = readFileSync(new URL('skills/clause-extraction/SKILL.md', root), 'utf8')
const legacyContracts = readFileSync(new URL('skills/clause-extraction/references/legacy-v2-v21-contracts.md', root), 'utf8')
const schemaText = readFileSync(new URL('schemas/clause-extraction-artifact-v21.schema.json', root), 'utf8')
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

test('retains v2.1 evidence rules while structural validation cannot schedule children', () => {
  assert.equal(agent.llm.routingMode, 'smart')
  assert.ok(agent.tool_permissions.denied.includes('Bash'))
  assert.ok(agent.tool_permissions.allowed.includes('StructuredFileValidate'))
  assert.ok(!agent.tool_permissions.allowed.includes('Delegate'))
  assert.ok(!agent.tool_permissions.allowed.includes('SendMessage'))
  assert.equal(agent.command_authority.enabled, false)
  assert.match(legacyContracts, /Draft-07 document deliberately validates only bounded syntax and field shape/)
  assert.match(skill, /只有处理既存 v2\.0\/v2\.1 产物时才读取/)
})

test('parses and validates the full v2.1 positive fixture with restricted Draft-07', () => {
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#')
  assert.ok(Buffer.byteLength(schemaText) <= 32 * 1024)
  assertRestricted(schema)
  const count = value => value && typeof value === 'object' ? 1 + Object.values(value).reduce((sum, child) => sum + count(child), 0) : 1
  assert.ok(count(schema) <= 1024)
  const validate = new Ajv({ strict: false }).compile(schema)
  const valid = parseYaml('valid-ready-v21.yaml')
  assert.equal(valid.clause_extraction.skill, 'clause-extraction@1.0.9')
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
  const valid = parseYaml('valid-ready-v21.yaml')
  const unknownGroup = structuredClone(valid)
  unknownGroup.clause_extraction.payloads[0].group = 'forged_group'
  assert.equal(validate(unknownGroup), false)
  const incompleteNegative = structuredClone(valid)
  incompleteNegative.clause_extraction.coverage[0].status = 'not_present'
  incompleteNegative.clause_extraction.coverage[0].exhaustive = false
  assert.equal(validate(incompleteNegative), false)
  for (const mutate of [
    evidence => { evidence.exact_quote = null },
    evidence => { evidence.utf16_offsets = [] },
  ]) {
    const badPositive = structuredClone(valid)
    mutate(badPositive.clause_extraction.payloads[0].records[0].evidence[0])
    assert.equal(validate(badPositive), false)
  }
})

const extractionProperties = schema.properties.clause_extraction.properties
const evidenceSchemas = [
  extractionProperties.payloads.items.properties.records.items.properties.evidence.items,
  extractionProperties.coverage.items.properties.evidence.items,
]
const baselineEvidence = () => structuredClone(parseYaml('valid-ready-v21.yaml').clause_extraction.payloads[0].records[0].evidence[0])
const catalogBytes = readFileSync(new URL('resources/absence-method-catalog/catalog.json', root))
const catalog = JSON.parse(catalogBytes)
const catalogHash = createHash('sha256').update(catalogBytes).digest('hex')
const assessment = (conclusion = 'not_present') => ({
  conclusion,
  semantic_method: { catalog_version: catalog.catalog_version, catalog_sha256: catalogHash, id: catalog.methods[0] },
  claimed_searched_sources: [{ part_id: 'body', source_name: 'part_0', sha256: 'a'.repeat(64) }],
  coverage_scope: 'complete_frozen_set',
  semantic_rationale: 'The submitted body was assessed using the released field taxonomy.',
  confidence: conclusion === 'not_present' ? 'high' : 'low',
  human_confirmation_required: true,
  debt_codes: conclusion === 'not_present' ? [] : ['SEMANTIC_UNCERTAIN'],
})

test('allows empty locators for null evidence and requires real numeric locators for positive evidence', () => {
  for (const evidenceSchema of evidenceSchemas) {
    const validate = new Ajv({ strict: false }).compile(evidenceSchema)
    const positive = baselineEvidence()
    assert.equal(validate(positive), true, JSON.stringify(validate.errors))
    for (const grep_state of ['not_found', 'unavailable']) {
      const absent = { ...positive, exact_quote: null, grep_state, utf16_offsets: [], exhaustive: grep_state === 'not_found' }
      assert.equal(validate(absent), true, JSON.stringify(validate.errors))
      assert.equal(validate({ ...absent, utf16_offsets: [0] }), false)
    }
    for (const offsets of [[], ['0'], [-1], [0.5]]) {
      assert.equal(validate({ ...positive, utf16_offsets: offsets }), false, JSON.stringify(offsets))
    }
  }
})

test('binds the actual released method catalog and rejects fabricated method identity', () => {
  const validate = new Ajv({ strict: false }).compile(extractionProperties.coverage.items.properties.absence_assessment)
  const valid = assessment()
  assert.equal(validate(valid), true, JSON.stringify(validate.errors))
  assert.equal(readFileSync(new URL('resources/absence-method-catalog/catalog.sha256', root), 'utf8').trim().split(/\s+/)[0].toLowerCase(), catalogHash)
  for (const field of ['catalog_version', 'catalog_sha256', 'id']) {
    const invalid = structuredClone(valid)
    invalid.semantic_method[field] = field === 'catalog_sha256' ? '0'.repeat(64) : 'invented'
    assert.equal(validate(invalid), false, field)
  }
  assert.equal(validate({ ...valid, claimed_searched_sources: [] }), false)
})

test('couples absence conclusions and debt to coverage states without blocking uncertain reports', () => {
  const validate = new Ajv({ strict: false }).compile(extractionProperties.coverage.items)
  const original = parseYaml('valid-ready-v21.yaml').clause_extraction.coverage[0]
  const missingEvidence = { ...baselineEvidence(), exact_quote: null, grep_state: 'not_found', exhaustive: true, utf16_offsets: [] }
  const missing = { ...original, status: 'not_present', exhaustive: true, evidence: [missingEvidence], debt_codes: [], absence_assessment: assessment() }
  assert.equal(validate(missing), true, JSON.stringify(validate.errors))
  const uncertain = { ...missing, status: 'blank', exhaustive: false, debt_codes: ['SEMANTIC_UNCERTAIN'], absence_assessment: assessment('not_established') }
  assert.equal(validate(uncertain), true, JSON.stringify(validate.errors))
  for (const invalid of [
    { ...missing, debt_codes: ['MISSING_SOURCE'] },
    { ...missing, absence_assessment: assessment('not_established') },
    { ...missing, absence_assessment: { ...assessment(), confidence: 'low' } },
    { ...missing, absence_assessment: { ...assessment(), coverage_scope: 'partial' } },
    { ...uncertain, absence_assessment: assessment() },
    { ...original, absence_assessment: assessment() },
    { ...original, status: 'blocked', debt_codes: ['MISSING_SOURCE'], absence_assessment: assessment() },
  ]) assert.equal(validate(invalid), false, JSON.stringify(invalid))
})

test('validates ambiguity evidence locators on the actual third selector path', () => {
  const candidateSchema = extractionProperties.ambiguities.items.properties.candidate_evidence.items
  const validate = new Ajv({ strict: false }).compile(candidateSchema)
  const candidate = { part: 'body', page: '1', source_sha256: 'a'.repeat(64), exact_quote: 'Example clause text.', grep_state: 'matched', utf16_offsets: [0] }
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors))
  for (const offsets of [[], ['line:1'], [-1]]) assert.equal(validate({ ...candidate, utf16_offsets: offsets }), false)
})

test('verifies every preserved v2 fixture against its immutable byte manifest', () => {
  const lines = fixture('v2-fixtures.sha256').trim().split(/\r?\n/)
  const names = new Set()
  for (const line of lines) {
    const match = /^(\S+) ([a-fA-F0-9]{64})$/.exec(line)
    assert.ok(match, `invalid manifest entry: ${line}`)
    const [, name, hash] = match
    assert.ok(!names.has(name), `duplicate manifest entry: ${name}`)
    names.add(name)
    assert.equal(createHash('sha256').update(readFileSync(new URL(`fixtures/structured-contract/${name}`, root))).digest('hex'), hash.toLowerCase(), name)
  }
  for (const { file } of expectations.fixtures) assert.ok(names.has(file), `unprotected original fixture: ${file}`)
  assert.ok(names.has('expectations.json'))
})

test('holds semantic map/count, duplicate coverage, debt, and deadline cases without calling them schema success', () => {
  const valid = parseYaml('valid-ready-v21.yaml')
  const countMismatch = structuredClone(valid); countMismatch.clause_extraction.part_count = 2
  assert.equal(semanticHold(countMismatch), true)
  const duplicateCoverage = structuredClone(valid); duplicateCoverage.clause_extraction.coverage[18].slug = duplicateCoverage.clause_extraction.coverage[0].slug
  assert.equal(semanticHold(duplicateCoverage), true)
  const blocked = structuredClone(valid); blocked.clause_extraction.lifecycle = { ...blocked.clause_extraction.lifecycle, state: 'blocked', handoff: null, repair_attempt: 2 }
  assert.equal(semanticHold(blocked), false)
  const timeout = structuredClone(valid); timeout.clause_extraction.lifecycle.deadline_at = '2026-09-11T00:01:00Z'
  assert.equal(semanticHold(timeout), true)
})
