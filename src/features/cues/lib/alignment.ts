import type { CueDoc, CueStatus, CueToken, GuideNote, TimeRange } from '../../../shared/document'

/** 相邻两字的提示首尾空隙超过该阈值（秒）即视为两个分组。 */
export const GROUP_GAP = 0.18

/** 新建提示时未分配的占位时间，等待自动识别或人工定位。 */
export const PLACEHOLDER_TIME = -1

const PUNCTUATION = new Set([
  ' ', '\t', '\n', '\r', '，', '。', '！', '？', '、', '；', '：', '“', '”', '‘', '’',
  '（', '）', '《', '》', '—', '…', '·', ',', '.', '!', '?', ';', ':', '"', "'",
  '(', ')', '[', ']', '{', '}', '-', '~', '、', '　',
])

export function isSungChar(char: string): boolean {
  return char.length > 0 && !PUNCTUATION.has(char)
}

export function tokenize(text: string): string[] {
  return Array.from(text).filter(isSungChar)
}

export function uid(): string {
  return crypto.randomUUID()
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end
}

/** 首尾相接（end === start）不算重叠，不需要试听复核。 */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return overlaps(a, b)
}

export function notesInRange(notes: readonly GuideNote[], range: TimeRange): GuideNote[] {
  return notes.filter(note => overlaps(note, range))
}

/**
 * 参考音自动识别：
 * - 字数少于音数时，相邻音被并入同一个字（允许一个字跨多个音）；
 * - 字数多于音数时，一个音按时长切给多个紧连的字共用提示；
 * - 行内没有参考音时，按行时长均匀铺开。
 * 所有自动结果均为 auto 状态，等待人工确认。
 */
export function autoAlign(
  chars: string[],
  range: TimeRange,
  notes: readonly GuideNote[],
  makeId: () => string = uid,
): CueToken[] {
  if (chars.length === 0) return []
  const local = notesInRange(notes, range)
  const spans: TimeRange[] = []

  if (local.length === 0) {
    const step = (range.end - range.start) / chars.length
    chars.forEach((_, index) => {
      spans.push({ start: range.start + step * index, end: range.start + step * (index + 1) })
    })
  } else if (local.length <= chars.length) {
    // 音少字多：把字数均匀分到每个音，一个音切给多个紧连的字共用提示。
    const charsPerNote = distribute(chars.length, local.length)
    let cursor = 0
    local.forEach((note, noteIndex) => {
      const take = charsPerNote[noteIndex]
      const piece = (note.end - note.start) / take
      for (let offset = 0; offset < take; offset++) {
        spans.push({
          start: note.start + piece * offset,
          end: note.start + piece * (offset + 1),
        })
        cursor++
      }
    })
    while (cursor < chars.length) {
      const tail = spans[spans.length - 1] ?? range
      spans.push({ start: tail.end, end: range.end })
      cursor++
    }
  } else {
    // 音多字少：把连续的参考音并组，一个字可跨多个音。
    const groupCount = chars.length
    const sizes = distribute(local.length, groupCount)
    let noteCursor = 0
    sizes.forEach(size => {
      const part = local.slice(noteCursor, noteCursor + size)
      noteCursor += size
      spans.push({ start: part[0].start, end: part[part.length - 1].end })
    })
  }

  return chars.map((char, index) => ({
    id: makeId(),
    char,
    start: round(spans[index].start),
    end: round(Math.max(spans[index].end, spans[index].start + 0.001)),
    status: 'auto' satisfies CueStatus,
  }))
}

/** 把 total 个元素尽量均匀地分到 groups 个桶里，每个桶至少 1 个。 */
export function distribute(total: number, groups: number): number[] {
  const base = Math.floor(total / groups)
  const extra = total % groups
  return Array.from({ length: groups }, (_, index) => base + (index < extra ? 1 : 0))
}

export function buildGroups(tokens: readonly CueToken[]): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1]
    if (current.length > 0 && previous && token.start - previous.end > GROUP_GAP) {
      groups.push(current)
      current = []
    }
    current.push(token.id)
  })
  if (current.length) groups.push(current)
  return groups
}

export function createCueDoc(
  songId: string,
  lineId: string,
  text: string,
  range: TimeRange,
  notes: readonly GuideNote[],
  makeId: () => string = uid,
): CueDoc {
  const chars = tokenize(text)
  const tokens = autoAlign(chars, range, notes, makeId)
  return {
    id: `${songId}:${lineId}`,
    songId,
    lineId,
    text: chars.join(''),
    tokens,
    groups: buildGroups(tokens),
    revision: 1,
    updatedAt: Date.now(),
  }
}

interface LcsPair {
  oldIndex: number | null
  newIndex: number | null
}

/** 最长公共子序列配对；重复字按从左到右的确定性顺序配对。 */
export function lcsPairs(oldChars: string[], newChars: string[]): LcsPair[] {
  const rows = oldChars.length
  const cols = newChars.length
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = oldChars[i] === newChars[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const pairs: LcsPair[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (oldChars[i] === newChars[j]) {
      pairs.push({ oldIndex: i, newIndex: j })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pairs.push({ oldIndex: i, newIndex: null })
      i++
    } else {
      pairs.push({ oldIndex: null, newIndex: j })
      j++
    }
  }
  while (i < rows) pairs.push({ oldIndex: i++, newIndex: null })
  while (j < cols) pairs.push({ oldIndex: null, newIndex: j++ })
  return pairs
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** 在两个已锚定的字之间，按空隙均匀分配临时时间。 */
function fillProvisional(
  tokens: CueToken[],
  start: number,
  end: number,
  left: CueToken | undefined,
  right: CueToken | undefined,
  fallback: TimeRange,
) {
  const count = end - start
  if (count === 0) return
  const anchorStart = left?.end ?? fallback.start
  const anchorEnd = right?.start ?? fallback.end
  const span = Math.max(anchorEnd - anchorStart, 0.001)
  const step = span / count
  for (let k = 0; k < count; k++) {
    const tokenStart = anchorStart + step * k
    tokens[start + k] = {
      ...tokens[start + k],
      start: round(tokenStart),
      end: round(Math.max(tokenStart + step, tokenStart + 0.001)),
    }
  }
}

function markOverlaps(tokens: CueToken[]) {
  for (const token of tokens) {
    if (token.start > token.end && token.status === 'confirmed') token.status = 'review'
  }
  for (let i = 1; i < tokens.length; i++) {
    if (overlaps(tokens[i - 1], tokens[i])) {
      if (tokens[i - 1].status === 'confirmed') tokens[i - 1] = { ...tokens[i - 1], status: 'review' }
      if (tokens[i].status === 'confirmed') tokens[i] = { ...tokens[i], status: 'review' }
    }
  }
}

/**
 * 整句粘贴修订后的文字。
 * 沿用 LCS 配对：配对成功的字（包括重复字）带着人工时点一起移动；
 * 未配对的新字先给临时时间并标 auto；迁移后与目的位置内部重叠的已确认字降级为 review。
 */
export function replaceText(doc: CueDoc, nextText: string, fallback: TimeRange): CueDoc {
  const oldChars = doc.tokens.map(token => token.char)
  const newChars = tokenize(nextText)
  const pairs = lcsPairs(oldChars, newChars)
  const tokens: CueToken[] = []

  for (const pair of pairs) {
    if (pair.newIndex === null) continue
    const char = newChars[pair.newIndex]
    if (pair.oldIndex !== null) {
      const previous = doc.tokens[pair.oldIndex]
      tokens.push({ ...previous, char })
    } else {
      tokens.push({ id: uid(), char, start: PLACEHOLDER_TIME, end: PLACEHOLDER_TIME, status: 'auto' })
    }
  }

  let runStart = -1
  for (let index = 0; index <= tokens.length; index++) {
    const placed = index < tokens.length && tokens[index].start !== PLACEHOLDER_TIME
    if (!placed && runStart === -1) runStart = index
    if (placed && runStart !== -1) {
      fillProvisional(tokens, runStart, index, tokens[runStart - 1], tokens[index], fallback)
      runStart = -1
    }
  }
  if (runStart !== -1) fillProvisional(tokens, runStart, tokens.length, tokens[runStart - 1], undefined, fallback)

  markOverlaps(tokens)
  return {
    ...doc,
    text: newChars.join(''),
    tokens,
    groups: buildGroups(tokens),
    revision: doc.revision + 1,
    updatedAt: Date.now(),
  }
}

function groupIndexOf(groups: string[][], tokenId: string): number {
  return groups.findIndex(group => group.includes(tokenId))
}

/**
 * 把源分组内连续的一段字拖到目标分组的锚点字旁。
 * 字的已确认时点原样跟随；落点内部重叠的已确认字降级 review；
 * 源分组中未被拖走的已确认字保持原序、原时间、原状态，不会被重排。
 */
export function moveTokens(
  doc: CueDoc,
  draggedIds: string[],
  targetGroupIndex: number,
  anchorTokenId: string,
  place: 'before' | 'after',
): CueDoc {
  const dragged = new Set(draggedIds)
  const sourceGroupIndex = groupIndexOf(doc.groups, draggedIds[0])
  if (sourceGroupIndex === -1 || !draggedIds.every(id => doc.groups[sourceGroupIndex].includes(id))) {
    throw new RangeError('只能拖走同一分组内连续的一段字。')
  }
  const sourceGroup = doc.groups[sourceGroupIndex]
  const first = sourceGroup.indexOf(draggedIds[0])
  const last = sourceGroup.indexOf(draggedIds[draggedIds.length - 1])
  if (last < first || draggedIds.some((id, index) => sourceGroup[first + index] !== id)) {
    throw new RangeError('拖走的字必须在源分组内连续。')
  }
  const targetGroup = doc.groups[targetGroupIndex]
  if (!targetGroup) throw new RangeError('目标分组不存在。')
  const anchorIndex = targetGroup.indexOf(anchorTokenId)
  if (anchorIndex === -1) throw new RangeError('锚点字不在目标分组内。')

  const remainingSource = sourceGroup.filter(id => !dragged.has(id))
  const nextGroups = doc.groups
    .map((group, index) => (index === sourceGroupIndex ? remainingSource : group))
    .filter(group => group.length > 0)

  const shiftedTarget = groupIndexOf(nextGroups, anchorTokenId)
  const target = [...nextGroups[shiftedTarget]]
  const insertAt = target.indexOf(anchorTokenId) + (place === 'after' ? 1 : 0)
  target.splice(insertAt, 0, ...draggedIds)
  nextGroups[shiftedTarget] = target

  const order = nextGroups.flat()
  const byId = new Map(doc.tokens.map(token => [token.id, token]))
  const tokens = order.map(id => ({ ...byId.get(id)! }))
  markOverlaps(tokens)

  return {
    ...doc,
    text: tokens.map(token => token.char).join(''),
    tokens,
    groups: buildGroups(tokens),
    revision: doc.revision + 1,
    updatedAt: Date.now(),
  }
}

/** 在指定分组中间插入一个新字（验证“在分组中间插入新字”）。 */
export function insertToken(
  doc: CueDoc,
  groupIndex: number,
  beforeTokenId: string,
  char: string,
  fallback: TimeRange,
): CueDoc {
  const sung = tokenize(char)
  if (sung.length !== 1) throw new RangeError('一次只能插入一个字。')
  const group = doc.groups[groupIndex]
  if (!group) throw new RangeError('分组不存在。')
  const beforeIndex = group.indexOf(beforeTokenId)
  if (beforeIndex === -1) throw new RangeError('锚点字不在该分组内。')

  const fresh: CueToken = {
    id: uid(),
    char: sung[0],
    start: PLACEHOLDER_TIME,
    end: PLACEHOLDER_TIME,
    status: 'auto',
  }
  const nextGroupIds = [...group.slice(0, beforeIndex), fresh.id, ...group.slice(beforeIndex)]
  const byId = new Map(doc.tokens.map(token => [token.id, token]))
  const groupTokens: CueToken[] = nextGroupIds.map(id => (id === fresh.id ? fresh : { ...byId.get(id)! }))
  const missingIndex = groupTokens.findIndex(token => token.id === fresh.id)
  fillProvisional(
    groupTokens,
    missingIndex,
    missingIndex + 1,
    groupTokens[missingIndex - 1],
    groupTokens[missingIndex + 1],
    fallback,
  )

  const nextGroups = doc.groups.map((entry, index) =>
    index === groupIndex ? groupTokens.map(token => token.id) : entry,
  )
  const tokenById = new Map([
    ...doc.tokens.map(token => [token.id, token] as const),
    ...groupTokens.map(token => [token.id, token] as const),
  ])
  const allTokens = nextGroups.flat().map(id => ({ ...tokenById.get(id)! }))
  markOverlaps(allTokens)

  return {
    ...doc,
    text: allTokens.map(token => token.char).join(''),
    tokens: allTokens,
    groups: buildGroups(allTokens),
    revision: doc.revision + 1,
    updatedAt: Date.now(),
  }
}

/** 在播放位置标记字的开始边界；前一字在该位置收尾，边界可反复重标。 */
export function markBoundary(doc: CueDoc, tokenId: string, time: number): CueDoc {
  const index = doc.tokens.findIndex(token => token.id === tokenId)
  if (index === -1) throw new RangeError('提示字不存在。')
  const tokens: CueToken[] = doc.tokens.map(token => ({ ...token }))
  if (index > 0) tokens[index - 1].end = round(time)
  tokens[index].start = round(time)
  if (index > 0) tokens[index - 1].status = 'confirmed'
  tokens[index].status = 'confirmed'
  markOverlaps(tokens)
  return { ...doc, tokens, groups: buildGroups(tokens), revision: doc.revision + 1, updatedAt: Date.now() }
}

/** 微调边界（秒），用于反复听参考音后对齐。 */
export function nudgeBoundary(doc: CueDoc, tokenId: string, side: 'start' | 'end', delta: number): CueDoc {
  const index = doc.tokens.findIndex(token => token.id === tokenId)
  if (index === -1) throw new RangeError('提示字不存在。')
  const tokens: CueToken[] = doc.tokens.map(token => ({ ...token }))
  if (side === 'start') {
    tokens[index].start = round(tokens[index].start + delta)
    if (index > 0) tokens[index - 1].end = tokens[index].start
  } else {
    tokens[index].end = round(tokens[index].end + delta)
    if (index < tokens.length - 1) tokens[index + 1].start = tokens[index].end
  }
  tokens[index].status = 'confirmed'
  if (side === 'start' && index > 0) tokens[index - 1].status = 'confirmed'
  if (side === 'end' && index < tokens.length - 1) tokens[index + 1].status = 'confirmed'
  markOverlaps(tokens)
  return { ...doc, tokens, groups: buildGroups(tokens), revision: doc.revision + 1, updatedAt: Date.now() }
}

/** 人工确认一个字的定位。 */
export function confirmToken(doc: CueDoc, tokenId: string): CueDoc {
  const tokens: CueToken[] = doc.tokens.map(token =>
    token.id === tokenId ? { ...token, status: 'confirmed' satisfies CueStatus } : token,
  )
  return { ...doc, tokens, revision: doc.revision + 1, updatedAt: Date.now() }
}
