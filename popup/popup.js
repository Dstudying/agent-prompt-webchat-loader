"use strict";

const state = {
  origin: null,
  profiles: [],
  site: null,
  supported: false,
  tabId: null
};

const elements = {
  emptyAdd: document.getElementById("empty-add"),
  emptyState: document.getElementById("empty-state"),
  feedback: document.getElementById("feedback"),
  importAll: document.getElementById("import-all"),
  openOptions: document.getElementById("open-options"),
  profileCount: document.getElementById("profile-count"),
  profileList: document.getElementById("profile-list"),
  shortcutSettings: document.getElementById("shortcut-settings"),
  shortcutValue: document.getElementById("shortcut-value"),
  siteStatus: document.getElementById("site-status")
};

function getShortcutSettingsUrl() {
  return navigator.userAgent.includes("Edg/")
    ? "edge://extensions/shortcuts"
    : "chrome://extensions/shortcuts";
}

function showFeedback(message, kind = "info") {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback visible ${kind}`;
}

function clearFeedback() {
  elements.feedback.textContent = "";
  elements.feedback.className = "feedback";
}

async function renderShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((entry) => entry.name === "inject-agents");
    elements.shortcutValue.textContent = command?.shortcut || "未设置";
  } catch (_error) {
    elements.shortcutValue.textContent = "查看设置";
  }
}

function renderProfiles() {
  elements.profileList.replaceChildren();
  elements.profileCount.textContent = `${state.profiles.length} 条`;
  elements.emptyState.hidden = state.profiles.length > 0;
  elements.importAll.disabled = !state.supported || state.profiles.length === 0;

  state.profiles.forEach((profile) => {
    const item = document.createElement("div");
    item.className = "profile-item";
    const info = document.createElement("div");
    info.className = "profile-info";
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const detail = document.createElement("span");
    detail.textContent = profile.placement === "append" ? "插入末尾" : "插入首行";
    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "profile-actions";
    const shortcut = AgentProfileModel.formatShortcut(profile.shortcut);
    if (shortcut) {
      const shortcutLabel = document.createElement("span");
      shortcutLabel.className = "shortcut-label";
      shortcutLabel.textContent = shortcut;
      actions.append(shortcutLabel);
    }
    const insert = document.createElement("button");
    insert.className = "button primary insert-one";
    insert.type = "button";
    insert.textContent = "插入";
    insert.addEventListener("click", () => importProfiles("IMPORT_PROFILE", profile.id, insert));
    actions.append(insert);
    item.append(info, actions);
    elements.profileList.append(item);
  });
}

async function importProfiles(type, profileId = null, trigger = elements.importAll) {
  clearFeedback();
  if (!state.supported) {
    showFeedback("当前网站不受支持。", "error");
    return;
  }
  trigger.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      profileId,
      tabId: state.tabId,
      type
    });
    if (!response?.ok) {
      showFeedback(response?.message || "插入失败，请重试。", "error");
      return;
    }
    showFeedback(response.message, "success");
    setTimeout(() => window.close(), 350);
  } catch (_error) {
    showFeedback("扩展后台未响应，请重新加载扩展后重试。", "error");
  } finally {
    trigger.disabled = false;
  }
}

async function openOptions() {
  await chrome.runtime.openOptionsPage();
  window.close();
}

async function openShortcutSettings() {
  try {
    await chrome.tabs.create({ url: getShortcutSettingsUrl() });
    window.close();
  } catch (_error) {
    showFeedback("无法打开浏览器快捷键设置页。", "error");
  }
}

async function initialize() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  state.tabId = tab?.id ?? null;
  try {
    state.origin = new URL(tab?.url).origin;
  } catch (_error) {
    state.origin = null;
  }
  await AgentProfileStore.initialize();
  const [profiles, sites] = await Promise.all([
    AgentProfileStore.getAllProfiles(),
    AgentProfileStore.getAllSites()
  ]);
  state.site = sites.find((site) => site.origin === state.origin) || null;
  const permitted = state.site
    ? await chrome.permissions.contains({
      origins: [AgentSiteModel.originToMatchPattern(state.site.origin)]
    })
    : false;
  state.supported = Boolean(state.site && permitted);
  if (state.supported) {
    elements.siteStatus.textContent = `当前网站：${state.site.name}`;
  } else if (state.site) {
    elements.siteStatus.textContent = `${state.site.name} 已配置但未授权`;
    elements.siteStatus.classList.add("unsupported");
  } else {
    elements.siteStatus.textContent = "当前网站尚未添加";
    elements.siteStatus.classList.add("unsupported");
  }
  state.profiles = state.supported
    ? profiles.filter((profile) => (
      profile.enabled && AgentProfileModel.matchesSite(profile.sites, state.site.id)
    ))
    : [];
  renderProfiles();
  await renderShortcut();
}

elements.importAll.addEventListener("click", () => importProfiles("IMPORT_ALL"));
elements.openOptions.addEventListener("click", openOptions);
elements.emptyAdd.addEventListener("click", openOptions);
elements.shortcutSettings.addEventListener("click", openShortcutSettings);

initialize().catch(() => {
  showFeedback("无法读取扩展配置，请重新加载扩展。", "error");
});
