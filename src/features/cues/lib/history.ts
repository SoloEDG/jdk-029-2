import type { CueDoc } from '../../../shared/document'

/**
 * 不依赖 Vue 的编辑历史。每次提交都会压入快照；
 * 撤销/重做直接返回当时的完整快照，因此预览与写入存档的内容天然一致。
 */
export class CueHistory {
  private past: CueDoc[] = []
  private present: CueDoc
  private future: CueDoc[] = []

  constructor(initial: CueDoc) {
    this.present = initial
  }

  get current(): CueDoc {
    return this.present
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  commit(next: CueDoc): CueDoc {
    this.past.push(this.present)
    this.present = next
    this.future = []
    return this.present
  }

  undo(): CueDoc {
    const previous = this.past.pop()
    if (!previous) return this.present
    this.future.push(this.present)
    this.present = previous
    return this.present
  }

  redo(): CueDoc {
    const next = this.future.pop()
    if (!next) return this.present
    this.past.push(this.present)
    this.present = next
    return this.present
  }
}
