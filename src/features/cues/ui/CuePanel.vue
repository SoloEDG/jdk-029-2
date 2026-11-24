<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CornerDownLeft,
  Ear,
  Flag,
  Hand,
  PencilLine,
  Redo2,
  Sparkles,
  Undo2,
} from '@lucide/vue'
import type { CueToken, LyricLine, Song } from '../../../shared/document'
import type { useCueEditor } from '../model/useCueEditor'

const props = defineProps<{
  editor: ReturnType<typeof useCueEditor>
  song: Song
  line: LyricLine
  position: number
}>()

const editor = computed(() => props.editor)
const draft = ref('')
const draftOpen = ref(false)
const insertChars = ref<Record<string, string>>({})
const dragPayload = ref<{ ids: string[]; fromGroup: number } | null>(null)
const dropHint = ref<{ group: number; token: string; place: 'before' | 'after' } | null>(null)
const NUDGE = 0.03

const span = computed(() => Math.max(props.line.end - props.line.start, 0.001))
const playhead = computed(() =>
  Math.min(100, Math.max(0, ((props.position - props.line.start) / span.value) * 100)),
)

function leftOf(token: CueToken): number {
  return ((token.start - props.line.start) / span.value) * 100
}
function widthOf(token: CueToken): number {
  return Math.max(2.2, ((token.end - token.start) / span.value) * 100)
}

function statusLabel(status: CueToken['status']): string {
  return status === 'confirmed' ? '已确认' : status === 'review' ? '待复核' : '自动'
}

function openDraft() {
  draft.value = props.editor.doc.value?.text ?? props.line.text
  draftOpen.value = true
}

function submitDraft() {
  if (!draft.value.trim()) return
  props.editor.reviseText(draft.value)
  draftOpen.value = false
}

function startDrag(event: DragEvent, groupIndex: number, token: CueToken) {
  dragPayload.value = { ids: [token.id], fromGroup: groupIndex }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', token.id)
  }
}

function onDragOver(event: DragEvent, groupIndex: number, token: CueToken, place: 'before' | 'after') {
  if (!dragPayload.value) return
  event.preventDefault()
  dropHint.value = { group: groupIndex, token: token.id, place }
}

function onDrop(event: DragEvent, groupIndex: number, token: CueToken, place: 'before' | 'after') {
  event.preventDefault()
  const payload = dragPayload.value
  dragPayload.value = null
  dropHint.value = null
  if (!payload) return
  try {
    props.editor.drag(groupIndex, payload.ids, token.id, place)
  } catch (error) {
    props.editor.issue.value = error instanceof Error ? error.message : '拖动失败。'
  }
}

function clearDrop() {
  dropHint.value = null
}

function submitInsert(groupIndex: number, beforeToken: CueToken) {
  const char = (insertChars.value[beforeToken.id] ?? '').trim()
  if (!char) return
  try {
    props.editor.addChar(groupIndex, beforeToken.id, char)
    insertChars.value[beforeToken.id] = ''
  } catch (error) {
    props.editor.issue.value = error instanceof Error ? error.message : '插入失败。'
  }
}

function hintClass(groupIndex: number, tokenId: string, place: 'before' | 'after'): string {
  const hint = dropHint.value
  return hint && hint.group === groupIndex && hint.token === tokenId && hint.place === place ? 'drop-hot' : ''
}
</script>

<template>
  <section class="cue-panel" aria-labelledby="cue-title">
    <div class="cue-heading">
      <div class="panel-heading"><PencilLine :size="17" /> 逐字提示</div>
      <div class="cue-actions">
        <button type="button" class="cue-tool" :disabled="!editor.canUndo.value" title="撤销" @click="editor.undo()">
          <Undo2 :size="15" />
        </button>
        <button type="button" class="cue-tool" :disabled="!editor.canRedo.value" title="重做" @click="editor.redo()">
          <Redo2 :size="15" />
        </button>
        <button type="button" class="cue-tool text-tool" @click="editor.reRecognize()">
          <Sparkles :size="14" /> 重新识别
        </button>
        <button type="button" class="cue-tool text-tool" @click="openDraft">
          <CornerDownLeft :size="14" /> 整句替换
        </button>
      </div>
    </div>

    <p v-if="editor.issue.value" class="cue-issue">{{ editor.issue.value }}</p>

    <ul class="cue-legend">
      <li><i class="dot confirmed" />已确认 <strong>{{ editor.counts.value.confirmed }}</strong></li>
      <li><i class="dot auto" />自动定位 <strong>{{ editor.counts.value.auto }}</strong></li>
      <li><i class="dot review" />待试听复核 <strong>{{ editor.counts.value.review }}</strong></li>
    </ul>

    <div class="cue-timeline">
      <div class="cue-playhead" :style="{ left: `${playhead}%` }" />
      <button
        v-for="token in editor.tokens.value"
        :key="token.id"
        type="button"
        class="cue-token"
        :class="token.status"
        :style="{ left: `${leftOf(token)}%`, width: `${widthOf(token)}%` }"
        :title="`${token.char} · ${statusLabel(token.status)} · ${token.start.toFixed(2)}s–${token.end.toFixed(2)}s`"
        @click="editor.seekToken(token.id)"
      >
        <span>{{ token.char }}</span>
      </button>
    </div>

    <div class="cue-groups">
      <div v-for="(group, groupIndex) in editor.groups.value" :key="groupIndex" class="cue-group" @dragleave="clearDrop">
        <div class="cue-group-head">
          <span class="cue-group-index mono">G{{ groupIndex + 1 }}</span>
          <span class="cue-group-time mono">{{ group[0].start.toFixed(2) }}–{{ group[group.length - 1].end.toFixed(2) }}s</span>
          <button type="button" class="cue-mini" title="循环试听这一组" @click="editor.previewRange(group[0].start, group[group.length - 1].end)">
            <Ear :size="13" /> 试听
          </button>
        </div>
        <div class="cue-token-row">
          <template v-for="(token, tokenIndex) in group" :key="token.id">
            <span
              class="drop-slot"
              :class="hintClass(groupIndex, token.id, 'before')"
              @dragover="onDragOver($event, groupIndex, token, 'before')"
              @dragleave="clearDrop"
              @drop="onDrop($event, groupIndex, token, 'before')"
            />
            <div class="cue-insert-inline">
              <input
                v-model="insertChars[token.id]"
                type="text"
                maxlength="2"
                :aria-label="`在${token.char}前插入新字`"
                placeholder="+"
                @keydown.enter="submitInsert(groupIndex, token)"
              />
              <button
                type="button"
                class="cue-mini insert-go"
                :disabled="!(insertChars[token.id] ?? '').trim()"
                title="在该字前插入"
                @click="submitInsert(groupIndex, token)"
              >
                <CornerDownLeft :size="11" />
              </button>
            </div>
            <div
              class="cue-chip"
              :class="token.status"
              draggable="true"
              @dragstart="startDrag($event, groupIndex, token)"
              @dragend="clearDrop"
            >
              <span class="cue-chip-char">{{ token.char }}</span>
              <span class="cue-chip-time mono">{{ token.start.toFixed(2) }}</span>
              <span class="cue-chip-tools">
                <button type="button" title="在当前播放位置标记该字起点" @click.stop="editor.markHere(token.id)">
                  <Flag :size="12" />
                </button>
                <button type="button" title="起点 −0.03s" @click.stop="editor.nudge(token.id, 'start', -NUDGE)">−</button>
                <button type="button" title="起点 +0.03s" @click.stop="editor.nudge(token.id, 'start', NUDGE)">+</button>
                <button type="button" title="只听这个字" @click.stop="editor.previewToken(token.id)">
                  <Ear :size="12" />
                </button>
                <button
                  type="button"
                  class="cue-confirm"
                  :class="{ done: token.status === 'confirmed' }"
                  title="确认该字定位"
                  @click.stop="editor.confirm(token.id)"
                >
                  <Hand :size="12" />
                </button>
              </span>
            </div>
            <span
              v-if="tokenIndex === group.length - 1"
              class="drop-slot tail"
              :class="hintClass(groupIndex, token.id, 'after')"
              @dragover="onDragOver($event, groupIndex, token, 'after')"
              @dragleave="clearDrop"
              @drop="onDrop($event, groupIndex, token, 'after')"
            />
          </template>
        </div>
      </div>
    </div>

    <form v-if="draftOpen" class="cue-draft" @submit.prevent="submitDraft">
      <label for="cue-draft-input">粘贴修订后的整句歌词（标点与空格会被忽略）</label>
      <textarea id="cue-draft-input" v-model="draft" rows="2" />
      <div class="cue-draft-actions">
        <button type="button" class="cue-mini" @click="draftOpen = false">取消</button>
        <button type="submit" class="cue-mini primary" :disabled="!draft.trim()">应用并重新对齐</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.cue-panel {
  border: 1px solid var(--rule);
  background: #20241d;
  border-radius: 7px;
  margin-top: 16px;
  padding: 12px 16px 14px;
}
.cue-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.cue-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.cue-tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid #575648;
  border-radius: 5px;
  background: #272b22;
  color: var(--muted);
  font-size: 11px;
}
.cue-tool:not(:disabled):hover { background: #3a3d30; color: var(--paper); }
.cue-issue { margin-top: 8px; color: #ffac98; font-size: 12px; }
.cue-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin: 10px 0 4px;
  color: var(--muted);
  font-size: 11px;
}
.cue-legend li { display: flex; align-items: center; gap: 5px; }
.cue-legend strong { color: var(--paper); }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.dot.confirmed { background: var(--green); }
.dot.auto { background: var(--gold); }
.dot.review { background: var(--coral); }

.cue-timeline {
  position: relative;
  height: 58px;
  margin: 8px 0 6px;
  border-radius: 5px;
  background: #1a1e17;
  border: 1px solid #2d3127;
  overflow: hidden;
}
.cue-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--paper);
  opacity: 0.85;
  z-index: 3;
  pointer-events: none;
}
.cue-token {
  position: absolute;
  top: 9px;
  height: 40px;
  padding: 0 2px;
  border: 1px solid transparent;
  border-radius: 5px;
  display: grid;
  place-items: center;
  font-size: 15px;
  font-weight: 700;
  color: #241e12;
  z-index: 2;
}
.cue-token.confirmed { background: var(--green); }
.cue-token.auto { background: var(--gold); }
.cue-token.review {
  background: var(--coral);
  box-shadow: inset 0 0 0 2px #ffd9cf;
}
.cue-token:hover { filter: brightness(1.08); }

.cue-groups { display: grid; gap: 9px; margin-top: 10px; }
.cue-group {
  border: 1px solid #33372d;
  border-radius: 6px;
  padding: 8px 10px;
  background: #1c2019;
}
.cue-group-head {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 7px;
  color: var(--soft);
  font-size: 10px;
}
.cue-group-index { color: var(--gold); }
.cue-group-time { color: var(--muted); }
.cue-group-head .cue-mini { margin-left: auto; }
.cue-mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid #575648;
  border-radius: 4px;
  background: #272b22;
  color: var(--muted);
  font-size: 11px;
}
.cue-mini:not(:disabled):hover { color: var(--paper); background: #3a3d30; }
.cue-mini.primary { color: #241e12; background: var(--gold); border-color: transparent; font-weight: 700; }
.cue-token-row { display: flex; align-items: stretch; flex-wrap: wrap; gap: 4px; }
.drop-slot {
  width: 10px;
  min-height: 64px;
  align-self: stretch;
  border-radius: 3px;
  border: 1px dashed transparent;
  transition: background-color 120ms, border-color 120ms;
}
.drop-slot.drop-hot { border-color: var(--gold); background: rgba(229, 189, 112, 0.18); }
.cue-chip {
  position: relative;
  min-width: 46px;
  border-radius: 6px;
  padding: 6px 6px 5px;
  border: 1px solid #41453a;
  background: #262a22;
  cursor: grab;
  display: grid;
  gap: 2px;
  justify-items: center;
}
.cue-chip:active { cursor: grabbing; }
.cue-chip.confirmed { border-color: rgba(184, 220, 157, 0.75); }
.cue-chip.auto { border-color: rgba(229, 189, 112, 0.55); }
.cue-chip.review { border-color: rgba(240, 153, 130, 0.85); background: #33251f; }
.cue-chip-char { font-size: 18px; font-weight: 700; }
.cue-chip.confirmed .cue-chip-char { color: var(--green); }
.cue-chip.auto .cue-chip-char { color: var(--gold); }
.cue-chip.review .cue-chip-char { color: var(--coral); }
.cue-chip-time { color: var(--soft); font-size: 9px; }
.cue-chip-tools { display: flex; gap: 2px; }
.cue-chip-tools button {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}
.cue-chip-tools button:hover { background: #3a3d30; color: var(--paper); }
.cue-chip-tools .cue-confirm.done { color: var(--green); }
.cue-insert-inline { display: flex; flex-direction: column; align-items: center; gap: 2px; align-self: center; }
.cue-insert-inline input {
  width: 30px;
  height: 26px;
  text-align: center;
  border: 1px solid #474c3d;
  border-radius: 4px;
  background: var(--inset);
  color: var(--paper);
}
.insert-go { min-height: 20px; height: 20px; padding: 0 5px; }
.cue-draft {
  margin-top: 12px;
  display: grid;
  gap: 7px;
  border-top: 1px solid #33372d;
  padding-top: 10px;
}
.cue-draft label { color: var(--muted); font-size: 11px; }
.cue-draft textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid #474c3d;
  border-radius: 5px;
  background: var(--inset);
  color: var(--paper);
  padding: 8px 10px;
}
.cue-draft-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
