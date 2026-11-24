export interface TimeRange { start: number; end: number }

export interface LyricLine extends TimeRange {
  id: string
  text: string
}

export interface GuideNote extends TimeRange { midi: number }

export interface Song {
  id: string
  title: string
  artist: string
  bpm: number
  key: string
  duration: number
  audio: string
  cover: string
  lines: LyricLine[]
  notes: GuideNote[]
}

export interface PitchPoint {
  time: number
  midi: number | null
}

export interface Take extends TimeRange {
  id: string
  songId: string
  lineId: string
  createdAt: number
  audio: Blob
  pitch: PitchPoint[]
  /** 录音当时的逐字提示快照，旧录音始终可用原提示复听。 */
  cueSnapshot?: CueDoc
}

export interface PcmFrame {
  inputTime: number
  samples: Float32Array
}

export type CueStatus = 'confirmed' | 'auto' | 'review'

export interface CueToken {
  id: string
  char: string
  start: number
  end: number
  status: CueStatus
}

export interface CueDoc {
  id: string
  songId: string
  lineId: string
  text: string
  tokens: CueToken[]
  groups: string[][]
  revision: number
  updatedAt: number
}
