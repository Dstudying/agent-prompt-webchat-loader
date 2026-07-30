"use strict";

importScripts(
  "../lib/profile-model.js",
  "../lib/profile-store.js",
  "../lib/instruction-block.js"
);

const SUPPORTED_ORIGINS = new Set(AgentProfileModel.SUPPORTED_ORIGINS);
const SUPPORTED_URL_PATTERNS = AgentProfileModel.SUPPORTED_ORIGINS.map(
  (origin) => `${origin}/*`
);

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
    message: error.message || "导入失败，请稍后重试。",
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

async function getTargetTab(tabId) {
  if (Number.isInteger(tabId)) {
    return chrome.tabs.get(tabId);
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function ensureSupportedTab(tab) {
  if (!tab || !Number.isInteger(tab.id)) {
    throw new ImportFailure("NO_ACTIVE_TAB", "没有找到当前活动标签页。");
  }
  const origin = getOrigin(tab.url);
  if (!SUPPORTED_ORIGINS.has(origin)) {
    throw new ImportFailure(
      "UNSUPPORTED_SITE",
      "当前网站暂不支持，仅可在 DeepSeek、豆包和千问中使用。"
    );
  }
  return origin;
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

async function getProfilesForOrigin(origin, profileId = null) {
  const profiles = await AgentProfileStore.getAllProfiles();
  const matches = profiles.filter((profile) => (
    profile.enabled
    && AgentProfileModel.matchesOrigin(profile.sites, origin)
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
  const tabs = await chrome.tabs.query({ url: SUPPORTED_URL_PATTERNS });
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

async function importProfiles({ profileId = null, tabId = null } = {}) {
  let tab = null;
  try {
    await AgentProfileStore.initialize();
    tab = await getTargetTab(tabId);
    const origin = ensureSupportedTab(tab);
    const profiles = await getProfilesForOrigin(origin, profileId);
    const response = await sendToContentScript(tab.id, {
      profiles,
      type: "INJECT_PROFILES"
    });
    if (!response?.ok) {
      throw new ImportFailure(
        response?.code || "INJECTION_FAILED",
        response?.message || "未能写入聊天输入框。"
      );
    }

    await chrome.storage.local.set({
      lastImport: {
        at: new Date().toISOString(),
        origin,
        profiles: profiles.map((profile) => profile.id)
      }
    });
    return {
      code: "IMPORTED",
      message: profileId
        ? "配置已写入输入框，请检查后手动发送。"
        : `已写入 ${profiles.length} 条配置，请检查后手动发送。`,
      ok: true
    };
  } catch (error) {
    const result = resultFromError(error);
    if (tab && Number.isInteger(tab.id) && SUPPORTED_ORIGINS.has(getOrigin(tab.url))) {
      await showPageToast(tab.id, result.message);
    } else if (tab && Number.isInteger(tab.id)) {
      await showBadge(tab.id, "!", result.message);
    }
    return result;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  AgentProfileStore.initialize().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  AgentProfileStore.initialize().catch(() => {});
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
  if (message?.type !== "IMPORT_PROFILE" && message?.type !== "IMPORT_ALL") {
    return false;
  }

  importProfiles({
    profileId: message.type === "IMPORT_PROFILE" ? message.profileId : null,
    tabId: message.tabId ?? sender.tab?.id ?? null
  }).then(sendResponse);
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "inject-agents") {
    importProfiles().catch(() => {});
  }
});
