import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  confirmToken,
  insertToken,
  markBoundary,
  moveTokens,
  nudgeBoundary,
  rangesOverlap,
  replaceText,
} from '../../src/features/cues/lib/alignment.ts'
import { CueHistory } from '../../src/features/cues/lib/history.ts'
import type { CueDoc, CueToken } from '../../src/shared/document.ts'

let sequence = 100
function makeId(): string {
  sequence += 1
  return `t-${sequence}`
}

function token(char: string, start: number, end: number, status: CueToken['status'] = 'auto', id = makeId()): CueToken {
  return { id, char, start, end, status }
}

/** 用紧凑的 [字,起,止,状态,id?] 列表造文档，分组按实际空隙重算由调用方通过 buildGroups 得到，这里直接给单组。 */
function doc(chars: Array<[string, number, number, CueToken['status']?]>, groups?: string[][]): CueDoc {
  const tokens = chars.map(([char, start, end, status]) => token(char, start, end, status ?? 'auto'))
  return {
    id: 'song:line',
    songId: 'song',
    lineId: 'line',
    text: tokens.map(entry => entry.char).join(''),
    tokens,
    groups: groups ?? [tokens.map(entry => entry.id)],
    revision: 1,
    updatedAt: 0,
  }
}

function byChar(current: CueDoc, char: string, occurrence = 0): CueToken {
  const matches = current.tokens.filter(entry => entry.char === char)
  assert.ok(matches[occurrence], `找不到第 ${occurrence + 1} 个“${char}”`)
  return matches[occurrence]
}

test('整句替换：重复字“慢慢”的人工时点随字迁移，可信定位保持已确认', () => {
  // 两个“慢慢”都人工标过：慢1 慢2 ... 慢3 慢4，全部 confirmed
  const initial = doc([
    ['慢', 1.0, 1.4, 'confirmed'],
    ['慢', 1.4, 1.8, 'confirmed'],
    ['走', 2.0, 2.4, 'confirmed'],
    ['啊', 2.4, 2.8, 'auto'],
    ['慢', 4.0, 4.4, 'confirmed'],
    ['慢', 4.4, 4.8, 'confirmed'],
  ])
  const firstMan = initial.tokens[0]
  const secondMan = initial.tokens[1]

  // 1) 剪出后一次的第一个“慢”（第 5 个字，id 固定），插到第一组第二个“慢”之后
  const moved = moveTokens(initial, [initial.tokens[4].id], 0, initial.tokens[1].id, 'after')

  // 源组原地未动的已确认字保持原序、原时间、原状态
  const stayFirst = moved.tokens.find(entry => entry.id === firstMan.id)!
  const staySecond = moved.tokens.find(entry => entry.id === secondMan.id)!
  assert.equal(stayFirst.start, 1.0)
  assert.equal(stayFirst.end, 1.4)
  assert.equal(stayFirst.status, 'confirmed')
  assert.equal(staySecond.status, 'confirmed')

  const dragged = moved.tokens.find(entry => entry.id === initial.tokens[4].id)!
  assert.equal(dragged.start, 4.0, '人工时点跟着被拖走的字')
  assert.equal(dragged.end, 4.4)

  // 2) 整句替换为含四个“慢”的版本（旧文档里只有三个带历史时点的慢）
  const replaced = replaceText(moved, '慢慢慢慢走啊', { start: 0.8, end: 5 })
  assert.equal(replaced.text, '慢慢慢慢走啊')

  // 三个有历史时点的“慢”被 LCS 配对沿用；多出的第 4 个“慢”无旧字可配，走自动分支
  const carriedIds = new Set(
    replaced.tokens.filter(entry => entry.status === 'confirmed').map(entry => entry.id),
  )
  assert.ok(carriedIds.has(firstMan.id), '第一个“慢”的定位仍可信')
  assert.ok(carriedIds.has(secondMan.id), '第二个“慢”的定位仍可信')
  assert.ok(carriedIds.has(dragged.id), '拖来的“慢”带着原时点被沿用')
  const autoMans = replaced.tokens.filter(entry => entry.char === '慢' && entry.status === 'auto')
  assert.equal(autoMans.length, 1, '新增且无历史时点的“慢”标为自动，等待人工确认')
  assert.equal(replaced.tokens.filter(entry => entry.char === '慢' && entry.status === 'confirmed').length, 3)

  // 再验证无配对的新字一定走自动分支：删到只剩两个“慢”，再插入一个全新的“慢”
  const shorter = replaceText(moved, '慢慢走啊', { start: 0.8, end: 5 })
  assert.equal(shorter.tokens.filter(entry => entry.char === '慢').length, 2)
  const insertedMan = insertToken(shorter, 0, shorter.tokens[1].id, '慢', { start: 0.8, end: 5 })
  const freshMan = insertedMan.tokens.find(entry => entry.char === '慢' && entry.status === 'auto')
  assert.ok(freshMan, '没有历史时点的新“慢”必须标为自动，等待人工确认')
})

test('迁移后与目的位置内部重叠的已确认字降级为待复核，首尾相接不降级', () => {
  const initial = doc([
    ['甲', 0.0, 1.0, 'confirmed'],
    ['乙', 1.0, 2.0, 'confirmed'],
    ['丙', 3.0, 4.0, 'confirmed'],
  ])
  // 重建两组：[甲,乙] 与 [丙]
  initial.groups = [[initial.tokens[0].id, initial.tokens[1].id], [initial.tokens[2].id]]
  // 让“丙”与落点内部重叠：丙 3.0–4.0 插到“甲”后，甲 0–1，乙 1–2，不重叠 → 保持确认
  const moved = moveTokens(initial, [initial.tokens[2].id], 0, initial.tokens[0].id, 'after')
  const bing = moved.tokens.find(entry => entry.char === '丙')!
  assert.equal(bing.status, 'confirmed', '无内部重叠时保持已确认')

  // 再造一个真正重叠的场景：把丙的时间改成与乙交叠
  const overlapping = doc([
    ['甲', 0.0, 1.0, 'confirmed'],
    ['乙', 1.0, 2.0, 'confirmed'],
    ['丙', 1.5, 2.2, 'confirmed'],
  ])
  overlapping.groups = [[overlapping.tokens[0].id, overlapping.tokens[1].id], [overlapping.tokens[2].id]]
  const result = moveTokens(overlapping, [overlapping.tokens[2].id], 0, overlapping.tokens[0].id, 'after')
  const yi = result.tokens.find(entry => entry.char === '乙')!
  const bing2 = result.tokens.find(entry => entry.char === '丙')!
  assert.equal(yi.status, 'review')
  assert.equal(bing2.status, 'review')
  assert.ok(rangesOverlap(yi, bing2))
})

test('在分组中间插入新字：原已确认字不被重排，新字为自动并获得临时时间', () => {
  const initial = doc([
    ['甲', 0.0, 1.0, 'confirmed'],
    ['乙', 2.0, 3.0, 'confirmed'],
    ['丙', 3.0, 4.0, 'confirmed'],
  ])
  const jia = initial.tokens[0]
  const bing = initial.tokens[2]
  const next = insertToken(initial, 0, initial.tokens[1].id, '新', { start: 0, end: 4 })

  assert.equal(next.text, '甲新乙丙')
  assert.equal(next.tokens[1].char, '新')
  assert.equal(next.tokens[1].status, 'auto')
  assert.ok(next.tokens[1].start >= jia.end)
  assert.ok(next.tokens[1].end <= next.tokens[2].start + 1e-6)

  // 原已确认字保持原时间、原状态、原相对顺序（仅位置下标平移）
  const nextJia = next.tokens.find(entry => entry.id === jia.id)!
  const nextBing = next.tokens.find(entry => entry.id === bing.id)!
  assert.deepEqual([nextJia.start, nextJia.end, nextJia.status], [0.0, 1.0, 'confirmed'])
  assert.deepEqual([nextBing.start, nextBing.end, nextBing.status], [3.0, 4.0, 'confirmed'])
})

test('标记边界会确认人工触达的字，产生重叠则降级待复核，且可反复重标', () => {
  const initial = doc([
    ['甲', 0.0, 1.0, 'auto'],
    ['乙', 1.0, 2.0, 'auto'],
  ])
  let next = markBoundary(initial, initial.tokens[1].id, 1.25)
  assert.equal(next.tokens[0].end, 1.25)
  assert.equal(next.tokens[1].start, 1.25)
  assert.equal(next.tokens[0].status, 'confirmed')
  assert.equal(next.tokens[1].status, 'confirmed')

  // 反复重标到与后字交叠的位置（把乙的 end 固定，起点被推过 end）
  next = markBoundary(next, next.tokens[1].id, 2.5)
  assert.equal(next.tokens[1].start, 2.5)
  assert.ok(next.tokens[1].start > next.tokens[1].end)
  assert.equal(next.tokens[1].status, 'review', '边界越过自身终点 → 待复核')

  // nudge 微调后重新确认
  const nudged = nudgeBoundary(next, next.tokens[1].id, 'start', -0.6)
  assert.equal(nudged.tokens[1].start, 1.9)
  assert.equal(nudged.tokens[0].end, 1.9)
  assert.equal(nudged.tokens[1].status, 'confirmed')
})

test('confirmToken 只确认指定字，不影响相邻字', () => {
  const initial = doc([['甲', 0, 1], ['乙', 1, 2]])
  const next = confirmToken(initial, initial.tokens[0].id)
  assert.equal(next.tokens[0].status, 'confirmed')
  assert.equal(next.tokens[1].status, 'auto')
})

test('moveTokens 拒绝跨组或非连续的选择', () => {
  const initial = doc([['甲', 0, 1], ['乙', 1, 2], ['丙', 3, 4]])
  initial.groups = [[initial.tokens[0].id], [initial.tokens[1].id, initial.tokens[2].id]]
  assert.throws(
    () => moveTokens(initial, [initial.tokens[0].id, initial.tokens[2].id], 1, initial.tokens[1].id, 'before'),
    RangeError,
  )
})

test('撤销/重做返回完整快照：撤销后预览与存档内容一致', () => {
  const initial = doc([['甲', 0, 1, 'confirmed'], ['乙', 1, 2, 'confirmed']])
  const history = new CueHistory(initial)
  const inserted = history.commit(insertToken(initial, 0, initial.tokens[1].id, '新', { start: 0, end: 2 }))
  assert.equal(history.current.text, '甲新乙')
  assert.equal(history.canUndo, true)

  const undone = history.undo()
  assert.equal(undone.text, '甲乙')
  // 存档若写入 undone 快照，与预览拿到的是同一个对象引用，内容必然一致
  const archived = structuredClone(undone)
  assert.deepEqual(archived.tokens.map(entry => entry.char), ['甲', '乙'])

  const redone = history.redo()
  assert.equal(redone.text, '甲新乙')
})
