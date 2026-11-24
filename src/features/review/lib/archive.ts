import type { Take } from '../../../shared/document'
import { transact } from '../../../shared/database'

const table = 'takes' as const

export const readTakes = () => transact<Take[]>(table, 'readonly', store => store.getAll())
export const writeTake = (take: Take) => transact(table, 'readwrite', store => store.put(take))
