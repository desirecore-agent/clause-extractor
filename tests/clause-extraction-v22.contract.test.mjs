import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const platformRequire = createRequire(new URL('../../package.json', root))
const YAML = platformRequire('yaml')
const Ajv = platformRequire('ajv')
const agent = JSON.parse(readFileSync(new URL('agent.json', root), 'utf8'))
const skill = readFileSync(new URL('skills/clause-extraction/SKILL.md', root), 'utf8')
const frontmatterVersion = /^version:\s*([^\r\n]+)$/m.exec(skill)?.[1].trim()
const metadataVersion = /^  version:\s*([^\r\n]+)$/m.exec(skill)?.[1].trim()
assert.ok(frontmatterVersion, 'clause-extraction frontmatter version is required')
assert.equal(metadataVersion, frontmatterVersion, 'metadata.version must match the top-level frontmatter version')
const v22SkillIdentity = `clause-extraction@${frontmatterVersion}`
const read = name => readFileSync(new URL('fixtures/structured-contract/' + name, root), 'utf8')
const parse = name => {
  const doc = YAML.parseDocument(read(name), { uniqueKeys: true, merge: false })
  assert.equal(doc.errors.length, 0, name + ': ' + doc.errors.map(error => error.message).join('; '))
  return doc.toJS()
}
const bytes = readFileSync(new URL('schemas/clause-extraction-artifact-v22.schema.json', root))
const skillSchemaBytes = readFileSync(new URL('skills/clause-extraction/references/clause-extraction-artifact-v22.schema.json', root))
const v22Template = readFileSync(new URL('templates/clause-extraction-artifact-v22.yaml', root), 'utf8')
const schema = JSON.parse(bytes)
const allowed = new Set(['$schema', 'title', 'description', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'allOf', 'anyOf', 'oneOf', 'not'])
function checkSchemaShape(value, propertyNames = false) {
  if (Array.isArray(value)) return value.forEach(item => checkSchemaShape(item))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (!propertyNames) assert.ok(allowed.has(key), 'forbidden schema keyword: ' + key)
    checkSchemaShape(child, key === 'properties')
  }
}
function productionBoundedStats(node, depth = 0, state = { nodes: 0, maxDepth: 0 }) {
  state.nodes += 1
  state.maxDepth = Math.max(state.maxDepth, depth)
  if (typeof node === 'boolean') return state
  assert.equal(Array.isArray(node), false, 'schema node is an object or boolean')
  assert.equal(typeof node, 'object')
  for (const child of Object.values(node.properties ?? {})) productionBoundedStats(child, depth + 1, state)
  for (const key of ['additionalProperties', 'items', 'not']) {
    if (Object.hasOwn(node, key)) productionBoundedStats(node[key], depth + 1, state)
  }
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    for (const child of node[key] ?? []) productionBoundedStats(child, depth + 1, state)
  }
  return state
}
function representationTupleConsistent(artifact) {
  const x = artifact.clause_extraction
  const delivered = x.parts.filter(part => part.delivered)
  if (x.source_representations.length !== delivered.length) return false
  const ids = new Set()
  for (const entry of x.source_representations) {
    if (ids.has(entry.part_id)) return false
    ids.add(entry.part_id)
    const part = x.parts.find(candidate => candidate.id === entry.part_id)
    const frozen = x.frozen_baseline.parts.find(candidate => candidate.id === entry.part_id)
    if (!part || !frozen || !part.delivered || !frozen.delivered) return false
    if (entry.source_name !== part.source_name || entry.source_name !== frozen.source_name) return false
    if (entry.format !== part.format || entry.format !== frozen.format) return false
    if (entry.source_sha256 !== part.sha256 || entry.source_sha256 !== frozen.sha256) return false
    if (entry.source_size_bytes !== part.size_bytes || entry.source_size_bytes !== frozen.size_bytes) return false
    const representation = entry.representation
    if (entry.format === 'docx') {
      if (representation?.kind !== 'canonical_text' || typeof representation.derived_text_sha256 !== 'string' || representation.text_offset_codec !== 'utf16_code_unit' || !Number.isInteger(representation.derived_text_utf16_code_units)) return false
    } else if (entry.format !== 'text' || representation?.kind !== 'original_text' || Object.keys(representation).length !== 1) return false
  }
  return true
}
test('v2.2 keeps bounded Draft-07 syntax while declaring a DOCX canonical representation', () => {
  const stats = productionBoundedStats(schema)
  assert.ok(Buffer.byteLength(bytes) <= 32 * 1024)
  assert.ok(stats.nodes <= 1024)
  assert.ok(stats.maxDepth <= 16)
  checkSchemaShape(schema)
  const validate = new Ajv({ strict: false }).compile(schema)
  const fixture = parse('valid-ready-v22-docx.yaml')
  assert.equal(agent.version, frontmatterVersion)
  assert.equal(schema.properties.clause_extraction.properties.skill.const, v22SkillIdentity)
  assert.equal(fixture.clause_extraction.skill, v22SkillIdentity)
  assert.match(v22Template, new RegExp(`skill: "${v22SkillIdentity}"`))
  assert.equal(fixture.clause_extraction.contract_schema.version, 22)
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors))
  assert.equal(representationTupleConsistent(fixture), true)
  const x = fixture.clause_extraction
  assert.equal(x.source_representations[0].format, 'docx')
  assert.equal(x.source_representations[0].representation.kind, 'canonical_text')
  assert.equal(x.source_representations[0].source_sha256, x.parts[0].sha256)
  const paths = [x.payloads[0].records[0].evidence[0], x.coverage[0].evidence[0], x.ambiguities[0].candidate_evidence[0]]
  for (const evidence of paths) {
    assert.equal(evidence.source_sha256, x.parts[0].sha256)
    assert.equal(evidence.exact_quote, 'Example clause text.')
    assert.deepEqual(evidence.utf16_offsets, [0])
  }
})
test('uses the byte-pinned enabled-Skill schema and returns only to the synchronous Lead caller', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'eefb5fdd4e38e0aafb5527b69fbfa203d76a37b6caadf8831fa7408f9768a439')
  assert.deepEqual(skillSchemaBytes, bytes)
  assert.ok(agent.tool_permissions.allowed.includes('StructuredFileValidate'))
  assert.ok(!agent.tool_permissions.allowed.includes('StructuredFileValidateCompose'))
  assert.ok(!agent.tool_permissions.allowed.includes('Delegate'))
  assert.ok(!agent.tool_permissions.allowed.includes('SendMessage'))
  assert.equal(agent.command_authority.enabled, false)
  assert.match(skill, /\$\{SKILL_DIR\}\/references\/clause-extraction-artifact-v22\.schema\.json/)
  assert.match(skill, /512 KiB, 8,000 nodes and depth 64/)
  assert.match(skill, /不得把返回 hash、模型自述或 `valid` 字段写进业务产物/)
  assert.match(skill, /Lead 必须仍按 O2 同调用 Compose 和既有 RC\/HG 验收/)
  assert.match(skill, /members\/clause-extractor\/<case_id>\/<extraction_id>\/artifact\/<extraction_id>\.extraction\.yaml/)
  assert.match(skill, /不得猜测 member binding、从 task\/文件名推断 case、写入 Lead 的 `contract-review\/\*\*`/)
  assert.match(skill, /独立非 Team 运行保持自己的已确认 `workspace` 路径/)
})
test('v2.2 rejects null positive evidence and makes declaration tuple failures unavailable for admission', () => {
  const validate = new Ajv({ strict: false }).compile(schema)
  assert.equal(validate(parse('invalid-v22-null-positive.yaml')), false)
  const allUndelivered = parse('valid-v22-all-undelivered-hold.yaml')
  assert.equal(validate(allUndelivered), true, JSON.stringify(validate.errors))
  assert.equal(allUndelivered.clause_extraction.source_representations.length, 0)
  assert.equal(representationTupleConsistent(allUndelivered), true)
  assert.equal(allUndelivered.clause_extraction.lifecycle.state, 'blocked')
  assert.equal(allUndelivered.clause_extraction.lifecycle.handoff, null)
  const deliveredEmpty = parse('valid-ready-v22-docx.yaml')
  deliveredEmpty.clause_extraction.source_representations = []
  assert.equal(validate(deliveredEmpty), true, JSON.stringify(validate.errors))
  assert.equal(representationTupleConsistent(deliveredEmpty), false)
  for (const name of ['invalid-v22-extra-source-representation.yaml', 'invalid-v22-derived-source-mismatch.yaml', 'invalid-v22-undelivered-derived.yaml']) {
    const artifact = parse(name)
    assert.equal(validate(artifact), true, name + ': ' + JSON.stringify(validate.errors))
    assert.equal(representationTupleConsistent(artifact), false, name)
  }
})
test('v2.2 preserves v2.1 bytes and the v2 fixture manifest rather than rewriting old evidence', () => {
  const v21 = {
    'schemas/clause-extraction-artifact-v21.schema.json': 'a5ffb1525f027f878ab9c89adaf6a4fc8d3255d5bd47f0d25b807df83c46c671',
    'fixtures/structured-contract/valid-ready-v21.yaml': '52a90ffb3f96a05b2c246817f27fe1b2fd387f5f187924abd591c1e7c9b91ae5',
  }
  for (const [name, expected] of Object.entries(v21)) {
    const actual = createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex')
    assert.equal(actual, expected, name)
  }
  for (const line of read('v2-fixtures.sha256').trim().split(/\r?\n/)) {
    const match = /^(\S+) ([a-fA-F0-9]{64})$/.exec(line)
    assert.ok(match, 'manifest entry')
    const actual = createHash('sha256').update(readFileSync(new URL('fixtures/structured-contract/' + match[1], root))).digest('hex')
    assert.equal(actual, match[2].toLowerCase(), match[1])
  }
})
