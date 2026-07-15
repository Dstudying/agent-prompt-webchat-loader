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

  async function putBinding(key, handle) {
    return runTransaction("readwrite", (store) => {
      store.put({
        key,
        handle,
        updatedAt: new Date().toISOString()
      });
    });
  }

  async function deleteBinding(key) {
    return runTransaction("readwrite", (store) => {
      store.delete(key);
    });
  }

  async function queryReadPermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") {
      return "denied";
    }

    try {
      return await handle.queryPermission({ mode: "read" });
    } catch (_error) {
      return "denied";
    }
  }

  async function requestReadPermission(handle) {
    const currentPermission = await queryReadPermission(handle);
    if (currentPermission === "granted") {
      return currentPermission;
    }

    if (!handle || typeof handle.requestPermission !== "function") {
      return "denied";
    }

    try {
      return await handle.requestPermission({ mode: "read" });
    } catch (_error) {
      return "denied";
    }
  }

  global.AgentFileStore = Object.freeze({
    deleteBinding,
    getBinding,
    putBinding,
    queryReadPermission,
    requestReadPermission
  });
})(globalThis);
