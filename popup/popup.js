"use strict";

const SUPPORTED_SITES = {
  "https://chat.deepseek.com": "DeepSeek",
  "https://www.doubao.com": "豆包"
};

const state = {
  tabId: null,
  origin: null,
  supported: false
};

const elements = {
  feedback: document.getElementById("feedback"),
  global: {
    authorize: document.getElementById("global-authorize"),
    choose: document.getElementById("global-choose"),
    clear: document.getElementById("global-clear"),
    file: document.getElementById("global-file"),
    permission: document.getElementById("global-permission")
  },
  importButton: document.getElementById("import-button"),
  shortcutSettings: document.getElementById("shortcut-settings"),
  shortcutValue: document.getElementById("shortcut-value"),
  site: {
    authorize: document.getElementById("site-authorize"),
    card: document.getElementById("site-card"),
    choose: document.getElementById("site-choose"),
    clear: document.getElementById("site-clear"),
    description: document.getElementById("site-description"),
    file: document.getElementById("site-file"),
    permission: document.getElementById("site-permission")
  },
  siteStatus: document.getElementById("site-status")
};

function getShortcutSettingsUrl() {
  return navigator.userAgent.includes("Edg/")
    ? "edge://extensions/shortcuts"
    : "chrome://extensions/shortcuts";
}

async function renderShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const importCommand = commands.find((command) => command.name === "inject-agents");
    elements.shortcutValue.textContent = importCommand?.shortcut || "未设置";
  } catch (_error) {
    elements.shortcutValue.textContent = "查看设置";
  }
}

async function openShortcutSettings() {
  clearFeedback();

  try {
    await chrome.tabs.create({ url: getShortcutSettingsUrl() });
    window.close();
  } catch (_error) {
    showFeedback("无法打开快捷键设置页，请在扩展管理页面中手动打开。", "error");
  }
}

function showFeedback(message, kind = "info") {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback visible ${kind}`;
}

function clearFeedback() {
  elements.feedback.textContent = "";
  elements.feedback.className = "feedback";
}

function permissionLabel(permission) {
  if (permission === "granted") {
    return "已授权";
  }
  if (permission === "prompt") {
    return "需授权";
  }
  return "权限失效";
}

async function renderBinding(key, controls) {
  const binding = await AgentFileStore.getBinding(key);
  if (!binding) {
    controls.file.textContent = "尚未选择文件";
    controls.file.title = "";
    controls.permission.textContent = "未绑定";
    controls.permission.className = "status-pill";
    controls.authorize.disabled = true;
    controls.clear.disabled = true;
    return;
  }

  const permission = await AgentFileStore.queryReadPermission(binding.handle);
  controls.file.textContent = binding.handle.name;
  controls.file.title = binding.handle.name;
  controls.permission.textContent = permissionLabel(permission);
  controls.permission.className = `status-pill ${permission}`;
  controls.authorize.disabled = permission === "granted";
  controls.clear.disabled = false;
}

async function render() {
  await renderBinding("global", elements.global);

  if (state.supported) {
    elements.site.card.hidden = false;
    elements.site.description.textContent = `仅在 ${SUPPORTED_SITES[state.origin]} 追加导入`;
    await renderBinding(state.origin, elements.site);
  } else {
    elements.site.card.hidden = true;
  }

  elements.importButton.disabled = !state.supported;
}

async function chooseFile(key) {
  clearFeedback();
  if (typeof globalThis.showOpenFilePicker !== "function") {
    showFeedback("当前浏览器不支持本地文件句柄，请使用最新版 Chrome 或 Edge。", "error");
    return;
  }

  try {
    const handles = await showOpenFilePicker({
      multiple: false,
      types: [{
        description: "Markdown 文件",
        accept: {
          "text/markdown": [".md"],
          "text/plain": [".txt"]
        }
      }]
    });
    const handle = handles[0];
    const permission = await AgentFileStore.requestReadPermission(handle);
    if (permission !== "granted") {
      showFeedback("未获得文件读取权限，文件没有被绑定。", "error");
      return;
    }

    await AgentFileStore.putBinding(key, handle);
    if (handle.name.toLowerCase() !== "agents.md") {
      showFeedback(`已绑定 ${handle.name}；建议使用标准文件名 AGENTS.md。`, "info");
    } else {
      showFeedback("AGENTS.md 已绑定。", "success");
    }
    await render();
  } catch (error) {
    if (error?.name !== "AbortError") {
      showFeedback("选择文件失败，请重试。", "error");
    }
  }
}

async function authorizeFile(key) {
  clearFeedback();
  const binding = await AgentFileStore.getBinding(key);
  if (!binding) {
    showFeedback("请先选择一个 AGENTS.md。", "error");
    return false;
  }

  const permission = await AgentFileStore.requestReadPermission(binding.handle);
  await render();
  if (permission !== "granted") {
    showFeedback("没有获得文件读取权限。", "error");
    return false;
  }

  showFeedback(`${binding.handle.name} 已重新授权。`, "success");
  return true;
}

async function clearBinding(key) {
  clearFeedback();
  await AgentFileStore.deleteBinding(key);
  showFeedback("文件绑定已清除。", "success");
  await render();
}

async function ensureEffectivePermissions() {
  const keys = ["global", state.origin];
  let bindingCount = 0;

  for (const key of keys) {
    const binding = await AgentFileStore.getBinding(key);
    if (!binding) {
      continue;
    }
    bindingCount += 1;

    const permission = await AgentFileStore.requestReadPermission(binding.handle);
    if (permission !== "granted") {
      showFeedback(`${binding.handle.name} 需要重新授权后才能导入。`, "error");
      return false;
    }
  }

  if (bindingCount === 0) {
    showFeedback("请先绑定全局或当前网站的 AGENTS.md。", "error");
    return false;
  }
  return true;
}

async function importAgents() {
  clearFeedback();
  if (!state.supported) {
    showFeedback("当前网站不受支持。", "error");
    return;
  }

  elements.importButton.disabled = true;
  try {
    if (!await ensureEffectivePermissions()) {
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "IMPORT_AGENTS",
      tabId: state.tabId
    });
    if (!response?.ok) {
      showFeedback(response?.message || "导入失败，请重试。", "error");
      return;
    }

    showFeedback(response.message, "success");
    setTimeout(() => window.close(), 350);
  } catch (_error) {
    showFeedback("扩展后台未响应，请重新加载扩展后重试。", "error");
  } finally {
    elements.importButton.disabled = !state.supported;
  }
}

function bindControls(key, controls) {
  controls.choose.addEventListener("click", () => chooseFile(key));
  controls.authorize.addEventListener("click", () => authorizeFile(key));
  controls.clear.addEventListener("click", () => clearBinding(key));
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
  state.supported = Boolean(SUPPORTED_SITES[state.origin]);

  if (state.supported) {
    elements.siteStatus.textContent = `当前网站：${SUPPORTED_SITES[state.origin]}`;
  } else {
    elements.siteStatus.textContent = "当前网站不受支持，可在此管理全局文件";
    elements.siteStatus.classList.add("unsupported");
  }

  bindControls("global", elements.global);
  if (state.supported) {
    bindControls(state.origin, elements.site);
  }
  elements.importButton.addEventListener("click", importAgents);
  elements.shortcutSettings.addEventListener("click", openShortcutSettings);

  try {
    await Promise.all([render(), renderShortcut()]);
  } catch (_error) {
    showFeedback("无法读取本地文件绑定，请重新加载扩展。", "error");
  }
}

initialize();
