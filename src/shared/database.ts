const name = 'night-session'
const version = 2
const stores = ['takes', 'cues'] as const

export type StoreName = (typeof stores)[number]

let opening: Promise<IDBDatabase> | null = null

function connect(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      const database = request.result
      for (const store of stores) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      opening = null
      reject(request.error)
    }
  })
  return opening
}

export async function transact<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await connect()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = operation(transaction.objectStore(storeName))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}
