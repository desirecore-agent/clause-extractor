import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const agent = JSON.parse(readFileSync(new URL('agent.json', root), 'utf8'))
const principles = readFileSync(new URL('principles.md', root), 'utf8')
const skill = readFileSync(new URL('skills/clause-extraction/SKILL.md', root), 'utf8')
const batchStart = skill.indexOf('### 原生 `Grep.literals` 批量核验')
const batchEnd = skill.indexOf('\n## 启动前置条件', batchStart)
assert.ok(batchStart >= 0 && batchEnd > batchStart, 'batch verification section must be delimited')
const batch = skill.slice(batchStart, batchEnd)

test('releases the bounded-literal rule as 1.0.7 without changing routing or tool authority', () => {
  assert.equal(agent.version, '1.0.7')
  assert.equal(agent.llm.routingMode, 'smart')
  assert.equal(agent.llm.smart.profile.reasoning, 'high')
  assert.deepEqual(agent.tool_permissions.allowed, [
    'Read', 'Ls', 'Glob', 'Grep', 'Write', 'Edit', 'Skill', 'MathCalc',
    'GenerateUUID', 'UnderstandImage', 'AskUserQuestion', 'Delegate',
    'SendMessage', 'FileDigest',
  ])
  assert.ok(agent.tool_permissions.denied.includes('Bash'))
  assert.match(skill, /^version: 1\.0\.7$/m)
})

test('requires native literals and every documented Grep batch budget', () => {
  for (const requirement of ['1–64', '2 KiB', '16 KiB', '5 MiB', '64 MiB']) {
    assert.match(batch, new RegExp(requirement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(batch, /原生 `literals` 数组/)
  assert.match(batch, /不得传 JSON-array 字符串/)
  assert.match(batch, /继续拆成下一有界批/)
  assert.match(batch, /不得因总量过大就把全部 quote 清空/)
})

test('binds each positive quote to the frozen source SHA and preserves incomplete positive evidence only', () => {
  assert.match(batch, /返回 SHA-256 与 `frozen_sha256` 相同/)
  assert.match(batch, /只有 `matched` 且有返回的精确位置，才能写入该 quote/)
  assert.match(batch, /`incomplete` 但已返回精确 locations 时，可以保留该条/)
  assert.match(batch, /不得说它已列尽全部位置/)
  assert.match(batch, /不得据它填 `not_found`、`not_present`/)
  assert.match(batch, /同一冻结来源的相关 literals 都在完整返回中得到 `not_found`/)
  assert.match(skill, /quote_verification_incomplete/)
  assert.match(skill, /quote_verification_failed/)
  assert.match(principles, /SHA-256 与该部件冻结摘要相同/)
})

test('records unsupported or unfinished source work as debt without narrowing scope', () => {
  assert.match(batch, /超过 5 MiB 的源文件是工具能力限制，不是范围缩减理由/)
  assert.match(batch, /不缩小合同范围来换取阴性结论/)
  assert.match(batch, /到 8 分钟时不再发起下一批或新的 Grep/)
  assert.match(skill, /10 分钟后不得发起新的分析工具调用/)
  assert.match(principles, /`blank`\/`blocked` 和 `failure_marks`/)
})

test('keeps extraction artifacts unique to the clause workspace', () => {
  assert.match(batch, /本 Agent 已用 `Ls` 确认的 `workspace` 下创建唯一的 `<extraction_id>\.extraction\.yaml`/)
  assert.match(batch, /不得写入、覆盖或要求 lead workspace、共享 `clauses\.yaml` 或其他 Agent 的路径/)
  assert.match(batch, /lead 只能消费最终交接返回的 `artifact_path`/)
  assert.match(principles, /不得写入、覆盖或要求共享的 lead 工作区、`clauses\.yaml` 或其他 Agent 的产物/)
})
