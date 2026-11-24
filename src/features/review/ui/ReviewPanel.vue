<script setup lang="ts">
import { computed } from 'vue'
import { AudioLines, GitCompareArrows, Headphones, Play, Square } from '@lucide/vue'
import type { GuideNote, LyricLine, Take } from '../../../shared/document'
import { clockLabel } from '../../../shared/time'
import { accuracy } from '../lib/summary'

const props = defineProps<{
  takes: Take[]
  slots: (Take | undefined)[]
  activeId: string | null
  selected: LyricLine | null
  notes: GuideNote[]
  issue: string
  replayPosition: number | null
}>()
const emit = defineEmits<{ listen: [Take]; choose: [0 | 1, string] }>()
const slotIndices = [0, 1] as const

const activeTake = computed(() => props.takes.find(take => take.id === props.activeId) ?? null)
const activeCue = computed(() => activeTake.value?.cueSnapshot ?? null)
const activeTokenId = computed(() => {
  const doc = activeCue.value
  const time = props.replayPosition
  if (!doc || time === null) return null
  const current = doc.tokens.find(token => time >= token.start && time < token.end)
  return current?.id ?? null
})
</script>

<template>
  <section class="review" aria-labelledby="review-title">
    <h2 class="rail-title" id="review-title"><Headphones :size="17" /> 练习回顾 <span class="mono">{{ takes.length }}</span></h2>
    <div class="review-line">{{ selected?.text ?? '未选择练习句' }}</div>
    <div v-if="!takes.length" class="empty-takes"><AudioLines :size="23" /><span>本句暂无录音</span></div>
    <ol v-else class="take-list">
      <li v-for="(take, index) in takes" :key="take.id">
        <button class="icon-button listen-button" :aria-label="`${activeId === take.id ? '停止' : '播放'}录音 ${takes.length - index}`"
          @click="emit('listen', take)">
          <Square v-if="activeId === take.id" :size="13" fill="currentColor" /><Play v-else :size="13" fill="currentColor" />
        </button>
        <div class="take-info"><strong>录音 {{ takes.length - index }}</strong>
          <small class="mono">{{ clockLabel(take.start, true) }}–{{ clockLabel(take.end, true) }}</small></div>
        <span class="mono take-score" title="检测到的音高中命中参考音的占比">{{ accuracy(take, notes) ?? '—' }}<template v-if="accuracy(take, notes) !== null">%</template></span>
      </li>
    </ol>

    <div v-if="activeTake" class="take-cue">
      <p class="take-cue-title">录音时的原逐字提示 <span class="mono">v{{ activeTake.cueSnapshot?.revision ?? '—' }}</span></p>
      <div v-if="activeCue" class="take-cue-row">
        <span
          v-for="token in activeCue.tokens"
          :key="token.id"
          class="take-cue-char"
          :class="[token.status, { singing: token.id === activeTokenId }]"
          :title="`${token.start.toFixed(2)}s–${token.end.toFixed(2)}s`"
        >{{ token.char }}</span>
      </div>
      <p v-else class="take-cue-empty subdued">该录音保存时还没有逐字提示。</p>
    </div>

    <div v-if="takes.length" class="compare-tools">
      <p><GitCompareArrows :size="16" /> 音高对比</p>
      <label v-for="slot in slotIndices" :key="slot"><span :class="slot === 0 ? 'slot-a' : 'slot-b'">{{ slot === 0 ? 'A' : 'B' }}</span>
        <select :aria-label="slot === 0 ? '对比录音 A' : '对比录音 B'" :value="slots[slot]?.id ?? ''"
          @change="emit('choose', slot, ($event.target as HTMLSelectElement).value)">
          <option value="">未选择</option>
          <option v-for="(take, index) in takes" :key="take.id" :value="take.id">录音 {{ takes.length - index }}</option>
        </select>
      </label>
    </div>
    <p v-if="issue" class="inline-error" role="alert">{{ issue }}</p>
  </section>
</template>

<style scoped>
.take-cue {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
}
.take-cue-title {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
  margin-bottom: 8px;
}
.take-cue-title span { color: var(--soft); }
.take-cue-row { display: flex; flex-wrap: wrap; gap: 4px; }
.take-cue-char {
  min-width: 24px;
  padding: 4px 5px;
  border-radius: 4px;
  text-align: center;
  font-weight: 700;
  font-size: 14px;
  background: #2a2e25;
  border: 1px solid transparent;
  color: var(--muted);
}
.take-cue-char.confirmed { border-color: rgba(184, 220, 157, 0.6); }
.take-cue-char.auto { border-color: rgba(229, 189, 112, 0.5); }
.take-cue-char.review { border-color: rgba(240, 153, 130, 0.7); }
.take-cue-char.singing {
  background: var(--gold);
  color: #241e12;
  transform: translateY(-2px);
}
.take-cue-empty { font-size: 11px; }
.subdued { color: var(--muted); }
</style>
