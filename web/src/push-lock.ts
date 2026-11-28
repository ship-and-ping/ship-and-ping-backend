const name = "ship-and-ping-push";

// IndexedDB queues opens and deletions across tabs. Hold the creating connection
// for the lifetime of the localStorage token, including while a tab is suspended.
// Closing/crashing releases the connection and unblocks the queued deletion.
async function withStorageToken<T>(action: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID();
  for (;;) {
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        try { localStorage.setItem(name, token); }
        catch { open.transaction?.abort(); }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const deletion = indexedDB.deleteDatabase(name);
    try {
      if (localStorage.getItem(name) === token) {
        try { return await action(); }
        finally { localStorage.removeItem(name); }
      }
    } finally { connection.close(); }
    await new Promise<void>((resolve, reject) => {
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
    });
  }
}

export async function withPushLock<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks
    ? navigator.locks.request(name, action)
    : withStorageToken(action);
}
