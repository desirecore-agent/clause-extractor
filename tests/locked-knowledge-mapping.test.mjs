import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
test('locked extractor tables and corrective actions remain live and mapped', async()=>{
 const skill=await readFile(path.join(root,'skills/clause-extraction/SKILL.md'),'utf8'); const persona=await readFile(path.join(root,'persona.md'),'utf8'); const principles=await readFile(path.join(root,'principles.md'),'utf8'); const map=await readFile(path.join(root,'skills/clause-extraction/LOCKED-KNOWLEDGE-MAP.md'),'utf8')
 for(const p of [/忠实/, /unknown/, /条款编号/, /页码/, /附件/, /金额/, /checkpoint|检查点/, /contract-review-lead/]) assert.match(skill+'\n'+persona+'\n'+principles,p)
 for(const row of ['忠实转写','十类固定事实','页码与证据锚点','金额、期限、主体、附件反例','最小 checkpoint','下游边界']) assert.match(map,new RegExp(row))
})
test('platform-equivalent frontmatter and live instructions encode O2 Lead handoff once', async()=>{
 const text=await readFile(path.join(root,'skills/clause-extraction/SKILL.md'),'utf8')
 const match=text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/); assert.ok(match)
 assert.equal((text.match(/^---\s*\nname:/gm)??[]).length,1,'exactly one frontmatter-shaped metadata block')
 const frontmatter=parse(match[1]); assert.equal(frontmatter.metadata.pipeline_stage,'O2'); assert.equal(frontmatter.metadata.upstream,'contract-review-lead'); assert.deepEqual(frontmatter.metadata.downstream,['contract-review-lead'])
 assert.doesNotMatch(match[2],/上游 contract-intake|两个?次有界调用|共同输入|三个下游 Agent/)
})
