"use strict";

importScripts(
  "../lib/site-model.js",
  "../lib/profile-model.js",
  "../lib/profile-store.js",
  "../lib/instruction-block.js"
);

const DYNAMIC_SCRIPT_ID = "configured-model-sites";

class ImportFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ImportFailure";
    this.code = code;
  }
}

function resultFromError(error) {
  return {
    code: error.code || "UNKNOWN_ERROR",
    message: error.message || "操作失败，请稍后重试。",
    ok: false
  };
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (_error) {
    return null;
  }
}

async function hasSitePermission(site) {
  return chrome.permissions.contains({
    origins: [AgentSiteModel.originToMatchPattern(site.origin)]
  });
}

async function getAuthorizedSites() {
  const sites = await AgentProfileStore.getAllSites();
  const permissionStates = await Promise.all(sites.map(hasSitePermission));
  return sites.filter((_site, index) => permissionStates[index]);
}

async function syncRegisteredContentScripts() {
  const sites = await getAuthorizedSites();
  const matches = [...new Set(sites.map((site) => (
    AgentSiteModel.originToMatchPattern(site.origin)
  )))];
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [DYNAMIC_SCRIPT_ID]
  });
  if (matches.length === 0) {
    if (registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
    }
    return;
  }
  const definition = {
    allFrames: false,
    id: DYNAMIC_SCRIPT_ID,
    js: [
      "lib/site-model.js",
      "lib/profile-model.js",
      "lib/instruction-block.js",
      "content/content.js"
    ],
    matches,
    persistAcrossSessions: true,
    runAt: "document_idle"
  };
  if (registered.length > 0) {
    await chrome.scripting.updateContentScripts([definition]);
  } else {
    await chrome.scripting.registerContentScripts([definition]);
  }
}

async function getTargetTab(tabId) {
  if (Number.isInteger(tabId)) {
    return chrome.tabs.get(tabId);
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function ensureSupportedTab(tab) {
  if (!tab || !Number.isInteger(tab.id)) {
    throw new ImportFailure("NO_ACTIVE_TAB", "没有找到当前活动标签页。");
  }
  const origin = getOrigin(tab.url);
  if (!origin) {
    throw new ImportFailure("SITE_NOT_CONFIGURED", "当前页面不是可配置的网页。");
  }
  const site = await AgentProfileStore.getSiteByOrigin(origin);
  if (!site) {
    throw new ImportFailure(
      "SITE_NOT_CONFIGURED",
      "当前网站尚未添加，请先在扩展设置页的网站管理中配置。"
    );
  }
  if (!await hasSitePermission(site)) {
    throw new ImportFailure(
      "SITE_PERMISSION_REQUIRED",
      `“${site.name}”尚未获得网站访问权限，请在设置页中授权。`
    );
  }
  return site;
}

async function resolveProfile(profile) {
  const refreshed = await AgentProfileStore.refreshProfile(profile);
  if (typeof refreshed.content !== "string" || !refreshed.content.trim()) {
    throw new ImportFailure(
      "EMPTY_PROFILE",
      `${refreshed.name} 的规范正文为空，请先在设置页中补充内容。`
    );
  }
  return {
    content: refreshed.content,
    endMarker: refreshed.endMarker,
    id: refreshed.id,
    name: refreshed.name,
    placement: refreshed.placement,
    startMarker: refreshed.startMarker
  };
}

async function getProfilesForSite(siteId, profileId = null) {
  const profiles = await AgentProfileStore.getAllProfiles();
  const matches = profiles.filter((profile) => (
    profile.enabled
    && AgentProfileModel.matchesSite(profile.sites, siteId)
    && (!profileId || profile.id === profileId)
  ));
  if (profileId && matches.length === 0) {
    throw new ImportFailure(
      "PROFILE_UNAVAILABLE",
      "该配置不存在、未启用或不适用于当前网站。"
    );
  }
  if (!profileId && matches.length === 0) {
    throw new ImportFailure(
      "NO_PROFILES",
      "当前网站没有可用配置，请先在扩展设置页中添加。"
    );
  }
  return Promise.all(matches.map(resolveProfile));
}

async function installContentScript(tabId) {
  await chrome.scripting.executeScript({
    files: [
      "lib/site-model.js",
      "lib/profile-model.js",
      "lib/instruction-block.js",
      "content/content.js"
    ],
    target: { tabId }
  });
}

async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_error) {
    await installContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function reloadTabShortcutIndex(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "RELOAD_SHORTCUT_INDEX"
    });
    if (response === undefined || response?.ok) {
      return;
    }
  } catch (_error) {
    // 页面没有可用内容脚本时，在下方重新安装。
  }
  await installContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "RELOAD_SHORTCUT_INDEX"
  });
  if (!response?.ok) {
    throw new Error(response?.message || "快捷键索引同步失败。");
  }
}

async function refreshShortcutContexts() {
  const sites = await getAuthorizedSites();
  const patterns = [...new Set(sites.map((site) => (
    AgentSiteModel.originToMatchPattern(site.origin)
  )))];
  if (patterns.length === 0) {
    return;
  }
  const tabs = await chrome.tabs.query({ url: patterns });
  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => reloadTabShortcutIndex(tab.id))
  );
}

async function showBadge(tabId, text, title) {
  await chrome.action.setBadgeBackgroundColor({ color: "#C2410C", tabId });
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: "导入 AGENTS.md" }).catch(() => {});
  }, 4000);
}

async function showPageToast(tabId, message, kind = "error") {
  try {
    await sendToContentScript(tabId, { kind, message, type: "SHOW_TOAST" });
  } catch (_error) {
    await showBadge(tabId, "!", message);
  }
}

async function executeUserCodeOnPage(tabId, code, profiles) {
  let oldText = "";
  try {
    const readFunc = function(userCode) {
      eval(userCode);
      if (typeof platformRead !== "function") return { error: "自定义代码未定义 platformRead 函数。" };
      try {
        return { error: null, text: String(platformRead() ?? "") };
      } catch (e) {
        return { error: "platformRead 执行失败：" + e.message };
      }
    };

    const [readResult] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [code],
      func: readFunc
    });
    const result = readResult?.result;
    if (result?.error) throw new ImportFailure("CODE_EXEC_ERROR", result.error);
    oldText = result?.text || "";
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure("CODE_INJECTION_FAILED", `代码注入页面失败：${error.message}`);
  }

  const mergedText = AgentInstructions.mergeProfileBlocks(oldText, profiles);

  try {
    const writeFunc = function(userCode, text) {
      eval(userCode);
      if (typeof platformWrite !== "function") return { error: "自定义代码未定义 platformWrite 函数。" };
      try {
        platformWrite(text);
        return { ok: true };
      } catch (e) {
        return { error: "platformWrite 执行失败：" + e.message };
      }
    };

    const [writeResult] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [code, mergedText],
      func: writeFunc
    });
    const result = writeResult?.result;
    if (result?.error) throw new ImportFailure("CODE_EXEC_ERROR", result.error);
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure("CODE_INJECTION_FAILED", `代码写入页面失败：${error.message}`);
  }
}

async function importProfiles({ profileId = null, tabId = null } = {}) {
  let tab = null;
  try {
    await AgentProfileStore.initialize();
    tab = await getTargetTab(tabId);
    const site = await ensureSupportedTab(tab);
    const profiles = await getProfilesForSite(site.id, profileId);

    if (site.code) {
      await executeUserCodeOnPage(tab.id, site.code, profiles);
      const names = profiles.map((p) => p.name).join("、");
      await showPageToast(tab.id, `已通过自定义代码写入“${names}”，请检查后手动发送。`, "success");
      await chrome.storage.local.set({
        lastImport: {
          at: new Date().toISOString(),
          origin: site.origin,
          profiles: profiles.map((p) => p.id)
        }
      });
      return {
        code: "IMPORTED",
        message: `已写入“${names}”，请检查后手动发送。`,
        ok: true
      };
    }

    const response = await sendToContentScript(tab.id, {
      profiles,
      site: {
        autoDetect: site.autoDetect,
        editorSelectors: site.editorSelectors
      },
      type: "INJECT_PROFILES"
    });
    if (!response?.ok) {
      throw new ImportFailure(
        response?.code || "INJECTION_FAILED",
        response?.message || "写入输入框失败。"
      );
    }
    await chrome.storage.local.set({
      lastImport: {
        at: new Date().toISOString(),
        origin: site.origin,
        profiles: profiles.map((profile) => profile.id)
      }
    });
    return {
      code: "IMPORTED",
      message: profiles.length === 1
        ? `已写入“${profiles[0].name}”，请检查后手动发送。`
        : `已写入 ${profiles.length} 条配置，请检查后手动发送。`,
      ok: true
    };
  } catch (error) {
    const result = resultFromError(error);
    if (tab && Number.isInteger(tab.id)) {
      try {
        const origin = getOrigin(tab.url);
        const site = origin ? await AgentProfileStore.getSiteByOrigin(origin) : null;
        if (site && await hasSitePermission(site)) {
          await showPageToast(tab.id, result.message);
        } else {
          await showBadge(tab.id, "!", result.message);
        }
      } catch (_error) {
        await showBadge(tab.id, "!", result.message);
      }
    }
    return result;
  }
}

async function testSiteSelectors(message) {
  try {
    const origin = AgentSiteModel.normalizeOrigin(message.origin);
    const pattern = AgentSiteModel.originToMatchPattern(origin);
    if (!await chrome.permissions.contains({ origins: [pattern] })) {
      throw new ImportFailure(
        "SITE_PERMISSION_REQUIRED",
        "测试前需要先授予该网站的访问权限。"
      );
    }
    const tabs = await chrome.tabs.query({ url: [pattern] });
    const candidates = tabs.filter((tab) => (
      Number.isInteger(tab.id) && getOrigin(tab.url) === origin
    ));
    candidates.sort((first, second) => (second.lastAccessed || 0) - (first.lastAccessed || 0));
    const tab = candidates[0];
    if (!tab) {
      throw new ImportFailure(
        "SITE_TAB_NOT_FOUND",
        "没有找到已打开的目标网站标签页，请先打开该网站。"
      );
    }
    return await sendToContentScript(tab.id, {
      site: {
        autoDetect: Boolean(message.autoDetect),
        editorSelectors: AgentSiteModel.normalizeEditorSelectors(message.editorSelectors)
      },
      type: "TEST_SITE_SELECTORS"
    });
  } catch (error) {
    return resultFromError(error);
  }
}

async function testSiteCode(message) {
  try {
    const origin = AgentSiteModel.normalizeOrigin(message.origin);
    const pattern = AgentSiteModel.originToMatchPattern(origin);
    if (!await chrome.permissions.contains({ origins: [pattern] })) {
      throw new ImportFailure(
        "SITE_PERMISSION_REQUIRED",
        "测试前需要先授予该网站的访问权限。"
      );
    }
    const tabs = await chrome.tabs.query({ url: [pattern] });
    const candidates = tabs.filter((tab) => (
      Number.isInteger(tab.id) && getOrigin(tab.url) === origin
    ));
    candidates.sort((first, second) => (second.lastAccessed || 0) - (first.lastAccessed || 0));
    const tab = candidates[0];
    if (!tab) {
      throw new ImportFailure(
        "SITE_TAB_NOT_FOUND",
        "没有找到已打开的目标网站标签页，请先打开该网站。"
      );
    }
    const testFunc = function(userCode) {
      eval(userCode);
      if (typeof platformRead !== "function") return { ok: false, message: "自定义代码未定义 platformRead 函数。" };
      try {
        var __text = platformRead();
        return { ok: true, text: String(__text ?? "") };
      } catch (e) {
        return { ok: false, message: "platformRead 执行失败：" + e.message };
      }
    };

    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [message.code],
      func: testFunc
    });
    return execResult?.result || { ok: false, message: "代码执行无返回值。" };
  } catch (error) {
    return resultFromError(error);
  }
}

async function handleSiteRegistryChanged() {
  await AgentProfileStore.syncShortcutIndex();
  await syncRegisteredContentScripts();
  await refreshShortcutContexts();
  return { ok: true };
}

async function initializeRuntime() {
  await AgentProfileStore.initialize();
  await syncRegisteredContentScripts();
  await refreshShortcutContexts();
}

chrome.runtime.onInstalled.addListener(() => {
  initializeRuntime().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  initializeRuntime().catch(() => {});
});

chrome.permissions.onAdded.addListener(() => {
  handleSiteRegistryChanged().catch(() => {});
});

chrome.permissions.onRemoved.addListener(() => {
  handleSiteRegistryChanged().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local"
    && changes[AgentProfileStore.SHORTCUT_INDEX_REVISION_KEY]
  ) {
    refreshShortcutContexts().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "IMPORT_PROFILE" || message?.type === "IMPORT_ALL") {
    importProfiles({
      profileId: message.type === "IMPORT_PROFILE" ? message.profileId : null,
      tabId: message.tabId ?? sender.tab?.id ?? null
    }).then(sendResponse);
    return true;
  }
  if (message?.type === "SITE_REGISTRY_CHANGED") {
    handleSiteRegistryChanged()
      .then(sendResponse)
      .catch((error) => sendResponse(resultFromError(error)));
    return true;
  }
  if (message?.type === "TEST_SITE_SELECTORS") {
    testSiteSelectors(message).then(sendResponse);
    return true;
  }
  if (message?.type === "TEST_SITE_CODE") {
    testSiteCode(message).then(sendResponse);
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "inject-agents") {
    importProfiles().catch(() => {});
  }
});
