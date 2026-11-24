import type { CueDoc } from '../../../shared/document'
import { transact } from '../../../shared/database'

const table = 'cues' as const

export const readCues = () => transact<CueDoc[]>(table, 'readonly', store => store.getAll())
export const writeCue = (doc: CueDoc) => transact(table, 'readwrite', store => store.put(doc))
export const deleteCue = (id: string) =>
  transact(table, 'readwrite', store => store.delete(id))
