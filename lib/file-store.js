(function attachFileStore(global) {
  "use strict";

  const DATABASE_NAME = "chat-web-agent";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "file-handles";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function runTransaction(mode, operation) {
    const database = await openDatabase();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let operationResult;

        transaction.oncomplete = () => resolve(operationResult);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);

        try {
          operationResult = operation(store);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      });
    } finally {
      database.close();
    }
  }

  async function getBinding(key) {
    const database = await openDatabase();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(key);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  async function putBinding(key, handle, name, content) {
    const binding = {
      key,
      handle,
      name,
      content,
      updatedAt: new Date().toISOString()
    };

    await runTransaction("readwrite", (store) => {
      store.put(binding);
    });
    return binding;
  }

  async function deleteBinding(key) {
    return runTransaction("readwrite", (store) => {
      store.delete(key);
    });
  }

  async function refreshBinding(binding) {
    if (!binding?.handle || typeof binding.handle.getFile !== "function") {
      return binding;
    }

    try {
      const file = await binding.handle.getFile();
      const content = await file.text();
      return putBinding(binding.key, binding.handle, file.name, content);
    } catch (_error) {
      return binding;
    }
  }

  global.AgentFileStore = Object.freeze({
    deleteBinding,
    getBinding,
    putBinding,
    refreshBinding
  });
})(globalThis);
