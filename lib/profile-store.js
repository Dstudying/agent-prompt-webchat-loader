(function attachProfileStore(global) {
  "use strict";

  const siteModel = global.AgentSiteModel
    || (typeof module !== "undefined" && module.exports
      ? require("./site-model.js")
      : null);
  const profileModel = global.AgentProfileModel
    || (typeof module !== "undefined" && module.exports
      ? require("./profile-model.js")
      : null);
  const DATABASE_NAME = "chat-web-agent";
  const DATABASE_VERSION = 3;
  const LEGACY_STORE_NAME = "file-handles";
  const METADATA_STORE_NAME = "metadata";
  const PROFILE_STORE_NAME = "profiles";
  const SITE_STORE_NAME = "sites";
  const LEGACY_MIGRATION_KEY = "legacy-migration-v2";
  const SITE_MIGRATION_KEY = "site-registry-migration-v3";
  const SHORTCUT_INDEX_KEY = "profileShortcutIndex";
  const SHORTCUT_INDEX_REVISION_KEY = "profileShortcutIndexRevision";
  const LEGACY_IDS = {
    global: "00000000-0000-4000-8000-000000000001",
    "https://chat.deepseek.com": "00000000-0000-4000-8000-000000000002",
    "https://www.doubao.com": "00000000-0000-4000-8000-000000000003",
    "https://www.qianwen.com": "00000000-0000-4000-8000-000000000004"
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
        if (!database.objectStoreNames.contains(SITE_STORE_NAME)) {
          database.createObjectStore(SITE_STORE_NAME, { keyPath: "id" });
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

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
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

  async function getAllSites() {
    const sites = await withDatabase(async (database) => {
      const transaction = database.transaction(SITE_STORE_NAME, "readonly");
      return requestResult(transaction.objectStore(SITE_STORE_NAME).getAll());
    });
    const templateOrder = new Map(
      (siteModel?.DEFAULT_SITE_TEMPLATES || []).map((site, index) => [site.id, index])
    );
    return sites.sort((first, second) => {
      const firstOrder = templateOrder.get(first.id) ?? Number.MAX_SAFE_INTEGER;
      const secondOrder = templateOrder.get(second.id) ?? Number.MAX_SAFE_INTEGER;
      return firstOrder - secondOrder || first.name.localeCompare(second.name, "zh-CN");
    });
  }

  async function getSite(id) {
    return withDatabase(async (database) => {
      const transaction = database.transaction(SITE_STORE_NAME, "readonly");
      const result = await requestResult(transaction.objectStore(SITE_STORE_NAME).get(id));
      return result || null;
    });
  }

  async function getSiteByOrigin(origin) {
    const normalizedOrigin = siteModel.normalizeOrigin(origin);
    const sites = await getAllSites();
    return sites.find((site) => site.origin === normalizedOrigin) || null;
  }

  function createShortcutIndexRevision() {
    const randomPart = global.crypto?.randomUUID
      ? global.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    return `${Date.now()}-${randomPart}`;
  }

  function buildShortcutIndex(profiles, sites, revision) {
    const originById = new Map(sites.map((site) => [site.id, site.origin]));
    return profiles
      .filter((profile) => profile.enabled && profile.shortcut)
      .map((profile) => ({
        id: profile.id,
        revision,
        shortcut: profile.shortcut,
        sites: profile.sites.includes("*")
          ? sites.map((site) => site.origin)
          : profile.sites.map((siteId) => originById.get(siteId)).filter(Boolean)
      }))
      .filter((entry) => entry.sites.length > 0);
  }

  async function filterAuthorizedSites(sites) {
    if (typeof chrome.permissions?.contains !== "function") {
      return sites;
    }
    const states = await Promise.all(sites.map((site) => (
      chrome.permissions.contains({
        origins: [siteModel.originToMatchPattern(site.origin)]
      }).catch(() => false)
    )));
    return sites.filter((_site, index) => states[index]);
  }

  async function syncShortcutIndex(profiles = null, sites = null) {
    const [currentProfiles, currentSites] = await Promise.all([
      profiles || getAllProfiles(),
      sites || getAllSites()
    ]);
    const authorizedSites = await filterAuthorizedSites(currentSites);
    const revision = createShortcutIndexRevision();
    await chrome.storage.local.set({
      [SHORTCUT_INDEX_KEY]: buildShortcutIndex(currentProfiles, authorizedSites, revision),
      [SHORTCUT_INDEX_REVISION_KEY]: revision
    });
  }

  async function putProfile(profile) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
      transaction.objectStore(PROFILE_STORE_NAME).put(profile);
      await transactionDone(transaction);
    });
    await syncShortcutIndex();
    return profile;
  }

  async function putProfiles(profiles) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(PROFILE_STORE_NAME);
      profiles.forEach((profile) => store.put(profile));
      await transactionDone(transaction);
    });
    await syncShortcutIndex();
  }

  async function deleteProfile(id) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
      transaction.objectStore(PROFILE_STORE_NAME).delete(id);
      await transactionDone(transaction);
    });
    await syncShortcutIndex();
  }

  async function replaceProfiles(profiles) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(PROFILE_STORE_NAME);
      store.clear();
      profiles.forEach((profile) => store.put(profile));
      await transactionDone(transaction);
    });
    await syncShortcutIndex(profiles);
  }

  async function putSite(site) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(SITE_STORE_NAME, "readwrite");
      transaction.objectStore(SITE_STORE_NAME).put(site);
      await transactionDone(transaction);
    });
    await syncShortcutIndex();
    return site;
  }

  async function deleteSite(id) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(SITE_STORE_NAME, "readwrite");
      transaction.objectStore(SITE_STORE_NAME).delete(id);
      await transactionDone(transaction);
    });
    await syncShortcutIndex();
  }

  async function replaceConfiguration(profiles, sites) {
    await withDatabase(async (database) => {
      const transaction = database.transaction(
        [PROFILE_STORE_NAME, SITE_STORE_NAME],
        "readwrite"
      );
      const profileStore = transaction.objectStore(PROFILE_STORE_NAME);
      const siteStore = transaction.objectStore(SITE_STORE_NAME);
      profileStore.clear();
      siteStore.clear();
      profiles.forEach((profile) => profileStore.put(profile));
      sites.forEach((site) => siteStore.put(site));
      await transactionDone(transaction);
    });
    await syncShortcutIndex(profiles, sites);
  }

  async function refreshProfile(profile) {
    if (
      profile?.sourceType !== "file"
      || profile.contentEdited
      || !profile.handle?.getFile
    ) {
      return profile;
    }
    try {
      const file = await profile.handle.getFile();
      const content = await file.text();
      const refreshed = {
        ...profile,
        content,
        contentEdited: false,
        fileName: file.name,
        sourceContent: content,
        updatedAt: profileModel.formatLocalDateTime()
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
        metadataTransaction.objectStore(METADATA_STORE_NAME).get(LEGACY_MIGRATION_KEY)
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
      const now = profileModel.formatLocalDateTime();
      const nameByOrigin = new Map(
        siteModel.DEFAULT_SITE_TEMPLATES.map((site) => [site.origin, site.name])
      );
      const migrated = legacyBindings
        .filter((binding) => LEGACY_IDS[binding.key] && !existingIds.has(LEGACY_IDS[binding.key]))
        .map((binding, index) => {
          const isGlobal = binding.key === "global";
          const fileName = binding.name || binding.handle?.name || "AGENTS.md";
          const content = typeof binding.content === "string" ? binding.content : "";
          return {
            content,
            contentEdited: false,
            createdAt: now,
            enabled: true,
            endMarker: "",
            fileName,
            handle: binding.handle,
            id: LEGACY_IDS[binding.key],
            name: isGlobal ? `全局 · ${fileName}` : `${nameByOrigin.get(binding.key)} · ${fileName}`,
            order: existingProfiles.length + index,
            placement: "prepend",
            shortcut: null,
            sites: isGlobal ? ["*"] : [binding.key],
            sourceContent: content,
            sourceType: "file",
            startMarker: "",
            updatedAt: now
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
        key: LEGACY_MIGRATION_KEY,
        migratedAt: now
      });
      await transactionDone(transaction);
    });
  }

  async function migrateSiteRegistry() {
    await withDatabase(async (database) => {
      const migration = await requestResult(
        database.transaction(METADATA_STORE_NAME, "readonly")
          .objectStore(METADATA_STORE_NAME).get(SITE_MIGRATION_KEY)
      );
      if (migration?.completed) {
        return;
      }
      const [profiles, sites] = await Promise.all([
        requestResult(
          database.transaction(PROFILE_STORE_NAME, "readonly")
            .objectStore(PROFILE_STORE_NAME).getAll()
        ),
        requestResult(
          database.transaction(SITE_STORE_NAME, "readonly")
            .objectStore(SITE_STORE_NAME).getAll()
        )
      ]);
      const now = profileModel.formatLocalDateTime();
      const sitesByOrigin = new Map(sites.map((site) => [site.origin, site]));
      const defaultSites = siteModel.DEFAULT_SITE_TEMPLATES.map((template) => (
        sitesByOrigin.get(template.origin)
        || siteModel.createSiteFromTemplate(template, now)
      ));
      const idByOrigin = new Map(defaultSites.map((site) => [site.origin, site.id]));
      const migratedProfiles = profiles.map((profile) => ({
        ...profile,
        sites: Array.isArray(profile.sites)
          ? profile.sites.map((site) => idByOrigin.get(site) || site)
          : profile.sites
      }));
      const transaction = database.transaction(
        [PROFILE_STORE_NAME, SITE_STORE_NAME, METADATA_STORE_NAME],
        "readwrite"
      );
      const profileStore = transaction.objectStore(PROFILE_STORE_NAME);
      const siteStore = transaction.objectStore(SITE_STORE_NAME);
      migratedProfiles.forEach((profile) => profileStore.put(profile));
      defaultSites.forEach((site) => siteStore.put(site));
      transaction.objectStore(METADATA_STORE_NAME).put({
        completed: true,
        key: SITE_MIGRATION_KEY,
        migratedAt: now
      });
      await transactionDone(transaction);
    });
  }

  async function initialize() {
    await migrateLegacyBindings();
    await migrateSiteRegistry();
    await syncShortcutIndex();
  }

  global.AgentProfileStore = Object.freeze({
    SHORTCUT_INDEX_KEY,
    SHORTCUT_INDEX_REVISION_KEY,
    deleteProfile,
    deleteSite,
    getAllProfiles,
    getAllSites,
    getProfile,
    getSite,
    getSiteByOrigin,
    initialize,
    putProfile,
    putProfiles,
    putSite,
    refreshProfile,
    replaceConfiguration,
    replaceProfiles,
    syncShortcutIndex
  });
})(globalThis);
