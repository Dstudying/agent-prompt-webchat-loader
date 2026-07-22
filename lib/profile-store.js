(function attachProfileStore(global) {
  "use strict";

  const DATABASE_NAME = "chat-web-agent";
  const DATABASE_VERSION = 2;
  const LEGACY_STORE_NAME = "file-handles";
  const METADATA_STORE_NAME = "metadata";
  const PROFILE_STORE_NAME = "profiles";
  const MIGRATION_KEY = "legacy-migration-v2";
  const SHORTCUT_INDEX_KEY = "profileShortcutIndex";
  const LEGACY_IDS = {
    "global": "00000000-0000-4000-8000-000000000001",
    "https://chat.deepseek.com": "00000000-0000-4000-8000-000000000002",
    "https://www.doubao.com": "00000000-0000-4000-8000-000000000003",
    "https://www.qianwen.com": "00000000-0000-4000-8000-000000000004"
  };
  const SITE_NAMES = {
    "https://chat.deepseek.com": "DeepSeek",
    "https://www.doubao.com": "豆包",
    "https://www.qianwen.com": "千问"
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
          database.createObjectStore(LEGACY_STORE_NAME, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(PROFILE_STORE_NAME)) {
          database.createObjectStore(PROFILE_STORE_NAME, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(METADATA_STORE_NAME)) {
          database.createObjectStore(METADATA_STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withDatabase(operation) {
    const database = await openDatabase();
    try {
      return await operation(database);
    } finally {
      database.close();
    }
  }

  async function getAllProfiles() {
    const profiles = await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readonly");
      return requestResult(transaction.objectStore(PROFILE_STORE_NAME).getAll());
    });
    return profiles.sort((first, second) => first.order - second.order);
  }

  async function getProfile(id) {
    return withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readonly");
      const result = await requestResult(transaction.objectStore(PROFILE_STORE_NAME).get(id));
      return result || null;
    });
  }

  function buildShortcutIndex(profiles) {
    return profiles
      .filter((profile) => profile.enabled && profile.shortcut)
      .map((profile) => ({
        id: profile.id,
        shortcut: profile.shortcut,
        sites: profile.sites
      }));
  }

  async function syncShortcutIndex(profiles) {
    const currentProfiles = profiles || await getAllProfiles();
    await chrome.storage.local.set({
      [SHORTCUT_INDEX_KEY]: buildShortcutIndex(currentProfiles)
    });
  }

  async function putProfile(profile) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
      transaction.objectStore(PROFILE_STORE_NAME).put(profile);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
    await syncShortcutIndex();
    return profile;
  }

  async function putProfiles(profiles) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(PROFILE_STORE_NAME);
      profiles.forEach((profile) => store.put(profile));
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
    await syncShortcutIndex();
  }

  async function deleteProfile(id) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
      transaction.objectStore(PROFILE_STORE_NAME).delete(id);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
    await syncShortcutIndex();
  }

  async function replaceProfiles(profiles) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(PROFILE_STORE_NAME);
      store.clear();
      profiles.forEach((profile) => store.put(profile));
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
    await syncShortcutIndex(profiles);
  }

  async function refreshProfile(profile) {
    if (profile?.sourceType !== "file" || !profile.handle?.getFile) {
      return profile;
    }

    try {
      const file = await profile.handle.getFile();
      const refreshed = {
        ...profile,
        content: await file.text(),
        fileName: file.name,
        updatedAt: new Date().toISOString()
      };
      await putProfile(refreshed);
      return refreshed;
    } catch (_error) {
      return profile;
    }
  }

  async function readLegacyBindings(database) {
    if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
      return [];
    }
    const transaction = database.transaction(LEGACY_STORE_NAME, "readonly");
    return requestResult(transaction.objectStore(LEGACY_STORE_NAME).getAll());
  }

  async function migrateLegacyBindings() {
    await withDatabase(async (database) => {
      const metadataTransaction = database.transaction(METADATA_STORE_NAME, "readonly");
      const migration = await requestResult(
        metadataTransaction.objectStore(METADATA_STORE_NAME).get(MIGRATION_KEY)
      );
      if (migration?.completed) {
        return;
      }

      const [legacyBindings, existingProfiles] = await Promise.all([
        readLegacyBindings(database),
        requestResult(
          database.transaction(PROFILE_STORE_NAME, "readonly")
            .objectStore(PROFILE_STORE_NAME).getAll()
        )
      ]);
      const existingIds = new Set(existingProfiles.map((profile) => profile.id));
      const now = new Date().toISOString();
      const migrated = legacyBindings
        .filter((binding) => LEGACY_IDS[binding.key] && !existingIds.has(LEGACY_IDS[binding.key]))
        .map((binding, index) => {
          const isGlobal = binding.key === "global";
          const fileName = binding.name || binding.handle?.name || "AGENTS.md";
          return {
            content: typeof binding.content === "string" ? binding.content : "",
            createdAt: binding.updatedAt || now,
            enabled: true,
            fileName,
            handle: binding.handle,
            id: LEGACY_IDS[binding.key],
            name: isGlobal ? `全局 · ${fileName}` : `${SITE_NAMES[binding.key]} · ${fileName}`,
            order: existingProfiles.length + index,
            placement: "prepend",
            shortcut: null,
            sites: isGlobal ? ["*"] : [binding.key],
            sourceType: "file",
            updatedAt: binding.updatedAt || now
          };
        });

      const transaction = database.transaction(
        [PROFILE_STORE_NAME, METADATA_STORE_NAME],
        "readwrite"
      );
      const profileStore = transaction.objectStore(PROFILE_STORE_NAME);
      migrated.forEach((profile) => profileStore.put(profile));
      transaction.objectStore(METADATA_STORE_NAME).put({
        completed: true,
        key: MIGRATION_KEY,
        migratedAt: now
      });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
  }

  async function initialize() {
    await migrateLegacyBindings();
    await syncShortcutIndex();
  }

  global.AgentProfileStore = Object.freeze({
    SHORTCUT_INDEX_KEY,
    deleteProfile,
    getAllProfiles,
    getProfile,
    initialize,
    putProfile,
    putProfiles,
    refreshProfile,
    replaceProfiles,
    syncShortcutIndex
  });
})(globalThis);
