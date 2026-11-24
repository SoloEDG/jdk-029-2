import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import type { CueDoc, GuideNote, LyricLine, Song } from '../../../shared/document'
import {
  autoAlign,
  buildGroups,
  confirmToken,
  createCueDoc,
  insertToken,
  markBoundary,
  moveTokens,
  nudgeBoundary,
  replaceText,
  uid,
} from '../lib/alignment'
import { CueHistory } from '../lib/history'
import { readCues, writeCue } from '../lib/store'

interface EditorActions {
  seek: (seconds: number) => void
  playRange: (range: { start: number; end: number }) => void
}

export function useCueEditor(
  song: Ref<Song>,
  line: Ref<LyricLine | null>,
  position: Ref<number>,
  actions: EditorActions,
) {
  const doc = shallowRef<CueDoc | null>(null)
  const canUndo = ref(false)
  const canRedo = ref(false)
  const issue = ref('')
  let history: CueHistory | null = null
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  const cache = new Map<string, CueDoc>()
  let loadedKey = ''

  const tokens = computed(() => doc.value?.tokens ?? [])
  const groups = computed(() => {
    const current = doc.value
    if (!current) return []
    const byId = new Map(current.tokens.map(token => [token.id, token]))
    return current.groups
      .map(ids => ids.map(id => byId.get(id)).filter((token): token is NonNullable<typeof token> => Boolean(token)))
      .filter(group => group.length > 0)
  })
  const counts = computed(() => {
    const summary = { confirmed: 0, review: 0, auto: 0 }
    for (const token of tokens.value) summary[token.status] += 1
    return summary
  })

  function notes(): GuideNote[] {
    return song.value.notes
  }

  function publish(next: CueDoc, remember: boolean) {
    if (!history) return
    const current = remember ? history.commit(next) : next
    doc.value = current
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    schedulePersist(current)
  }

  function schedulePersist(current: CueDoc) {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      void persist(current)
    }, 300)
  }

  async function persist(current: CueDoc) {
    issue.value = ''
    try {
      await writeCue(current)
      cache.set(current.id, current)
    } catch {
      issue.value = '逐字提示暂存失败，请检查浏览器存储权限。'
    }
  }

  async function flush() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    if (doc.value) await persist(doc.value)
  }

  async function load(target: LyricLine) {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    const id = `${song.value.id}:${target.id}`
    loadedKey = id
    issue.value = ''
    let current = cache.get(id)
    if (!current) {
      try {
        const stored = await readCues()
        for (const entry of stored) cache.set(entry.id, entry)
        current = cache.get(id)
      } catch {
        issue.value = '无法读取本机逐字提示存档，已使用自动识别结果。'
      }
    }
    if (loadedKey !== id) return
    if (!current) {
      current = createCueDoc(song.value.id, target.id, target.text, target, notes())
      cache.set(id, current)
    }
    history = new CueHistory(current)
    doc.value = current
    canUndo.value = false
    canRedo.value = false
  }

  function requireDoc(): CueDoc {
    const current = doc.value
    if (!current || !line.value) throw new Error('当前没有可编辑的歌词行。')
    return current
  }

  function reviseText(nextText: string) {
    const current = requireDoc()
    publish(replaceText(current, nextText, line.value!), true)
  }

  function reRecognize() {
    const target = line.value
    const current = requireDoc()
    if (!target) return
    const regenerated = autoAlign(current.tokens.map(token => token.char), target, notes())
    publish({ ...current, tokens: regenerated, groups: buildGroups(regenerated), revision: current.revision + 1, updatedAt: Date.now() }, true)
  }

  function drag(groupIndex: number, draggedIds: string[], anchorTokenId: string, place: 'before' | 'after') {
    publish(moveTokens(requireDoc(), draggedIds, groupIndex, anchorTokenId, place), true)
  }

  function addChar(groupIndex: number, beforeTokenId: string, char: string) {
    publish(insertToken(requireDoc(), groupIndex, beforeTokenId, char, line.value!), true)
  }

  function markHere(tokenId: string) {
    publish(markBoundary(requireDoc(), tokenId, position.value), true)
  }

  function nudge(tokenId: string, side: 'start' | 'end', delta: number) {
    publish(nudgeBoundary(requireDoc(), tokenId, side, delta), true)
  }

  function confirm(tokenId: string) {
    publish(confirmToken(requireDoc(), tokenId), true)
  }

  function undo() {
    if (!history) return
    const current = history.undo()
    doc.value = current
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    schedulePersist(current)
  }

  function redo() {
    if (!history) return
    const current = history.redo()
    doc.value = current
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    schedulePersist(current)
  }

  function previewRange(start: number, end: number) {
    actions.playRange({ start, end })
  }

  function previewToken(tokenId: string) {
    const token = doc.value?.tokens.find(entry => entry.id === tokenId)
    if (token) actions.playRange({ start: token.start, end: token.end })
  }

  function seekToken(tokenId: string) {
    const token = doc.value?.tokens.find(entry => entry.id === tokenId)
    if (token) actions.seek(Math.max(0, token.start - 0.05))
  }

  watch(
    () => line.value?.id,
    id => {
      if (id && line.value) void load(line.value)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    if (persistTimer) clearTimeout(persistTimer)
  })

  return {
    doc,
    tokens,
    groups,
    counts,
    canUndo,
    canRedo,
    issue,
    flush,
    reviseText,
    reRecognize,
    drag,
    addChar,
    markHere,
    nudge,
    confirm,
    undo,
    redo,
    previewRange,
    previewToken,
    seekToken,
    makeId: uid,
  }
}
