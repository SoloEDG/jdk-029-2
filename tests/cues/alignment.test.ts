import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GROUP_GAP,
  autoAlign,
  buildGroups,
  createCueDoc,
  distribute,
  lcsPairs,
  tokenize,
} from '../../src/features/cues/lib/alignment.ts'
import type { CueDoc, CueToken, GuideNote } from '../../src/shared/document.ts'

let sequence = 0
function makeId(): string {
  sequence += 1
  return `id-${sequence}`
}

function notes(...ranges: Array<[number, number]>): GuideNote[] {
  return ranges.map(([start, end]) => ({ start, end, midi: 60 }))
}

function range(start: number, end: number) {
  return { start, end }
}

test('tokenize 忽略标点与空白，只保留唱词字符', () => {
  assert.deepEqual(tokenize('慢慢，走…… 啊！'), ['慢', '慢', '走', '啊'])
})

test('distribute 把音数均匀分到每个字，至少一音', () => {
  assert.deepEqual(distribute(7, 3), [3, 2, 2])
  assert.deepEqual(distribute(4, 4), [1, 1, 1, 1])
})

test('一个字可跨多个音：音多字少时相邻参考音被并入同一个字', () => {
  const aligned = autoAlign(['啊', '哦'], range(0, 4), notes([0, 1], [1, 2], [2, 3], [3, 4]), makeId)
  assert.equal(aligned.length, 2)
  assert.deepEqual([aligned[0].start, aligned[0].end], [0, 2])
  assert.deepEqual([aligned[1].start, aligned[1].end], [2, 4])
  assert.ok(aligned[0].end - aligned[0].start > 1.5, '跨音长字覆盖两个参考音')
  assert.ok(aligned.every(token => token.status === 'auto'))
})

test('紧连的字可共用提示：字多音少时一个音被切给多个字', () => {
  const aligned = autoAlign(['甲', '乙', '丙'], range(0, 2), notes([0, 1], [1, 2]), makeId)
  assert.equal(aligned.length, 3)
  assert.deepEqual(aligned.map(token => token.char), ['甲', '乙', '丙'])
  assert.ok(aligned[0].end <= aligned[1].start + 1e-6)
  assert.ok(aligned[1].end <= aligned[2].start + 1e-6)
  const total = aligned[2].end - aligned[0].start
  assert.ok(Math.abs(total - 2) < 1e-6)
})

test('不均匀的字音比例下每个参考音都能分到字，且时间首尾相接', () => {
  const aligned = autoAlign(['a', 'b', 'c', 'd', 'e'], range(0, 4), notes([0, 2], [2, 4]), makeId)
  assert.equal(aligned.length, 5)
  // 5 个字均匀分给 2 个音：3 + 2，前 3 字落在第一音 [0,2]，后 2 字落在第二音 [2,4]
  assert.deepEqual(aligned.map(token => token.char), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual([aligned[0].start, aligned[2].end], [0, 2])
  assert.deepEqual([aligned[3].start, aligned[4].end], [2, 4])
  for (let index = 1; index < aligned.length; index++) {
    assert.ok(Math.abs(aligned[index].start - aligned[index - 1].end) < 1e-6)
  }
})

test('行内没有参考音时按行时长均匀铺开', () => {
  const aligned = autoAlign(['a', 'b'], range(2, 4), [], makeId)
  assert.deepEqual([aligned[0].start, aligned[0].end], [2, 3])
  assert.deepEqual([aligned[1].start, aligned[1].end], [3, 4])
})

test('空隙超过阈值的字被拆成不同分组', () => {
  const tokens: CueToken[] = [
    { id: 'a', char: '甲', start: 0, end: 0.5, status: 'auto' },
    { id: 'b', char: '乙', start: 0.5 + GROUP_GAP + 0.1, end: 1.2, status: 'auto' },
    { id: 'c', char: '丙', start: 1.21, end: 1.5, status: 'auto' },
  ]
  assert.deepEqual(buildGroups(tokens), [['a'], ['b', 'c']])
})

test('createCueDoc 生成可编辑的初始文档与分组', () => {
  const doc = createCueDoc('song', 'line', '海风', range(0, 2), notes([0, 1], [1, 2]), makeId)
  assert.equal(doc.id, 'song:line')
  assert.equal(doc.text, '海风')
  assert.equal(doc.tokens.length, 2)
  assert.equal(doc.groups.flat().length, 2)
})

test('lcsPairs 对重复字给出从左到右的确定性配对', () => {
  const pairs = lcsPairs(['慢', '慢', '走'], ['你', '慢', '慢', '慢', '走'])
  const matched = pairs.filter(pair => pair.oldIndex !== null && pair.newIndex !== null)
  assert.deepEqual(matched.map(pair => [pair.oldIndex, pair.newIndex]), [[0, 1], [1, 2], [2, 4]])
})
