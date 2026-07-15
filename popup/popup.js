"use strict";

const SUPPORTED_SITES = {
  "https://chat.deepseek.com": "DeepSeek",
  "https://www.doubao.com": "豆包",
  "https://www.qianwen.com": "千问"
};

const state = {
  bindings: new Map(),
  tabId: null,
  origin: null,
  supported: false
};

const elements = {
  feedback: document.getElementById("feedback"),
  global: {
    choose: document.getElementById("global-choose"),
    clear: document.getElementById("global-clear"),
    file: document.getElementById("global-file"),
    status: document.getElementById("global-storage")
  },
  importButton: document.getElementById("import-button"),
  shortcutSettings: document.getElementById("shortcut-settings"),
  shortcutValue: document.getElementById("shortcut-value"),
  site: {
    card: document.getElementById("site-card"),
    choose: document.getElementById("site-choose"),
    clear: document.getElementById("site-clear"),
    description: document.getElementById("site-description"),
    file: document.getElementById("site-file"),
    status: document.getElementById("site-storage")
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

async function renderBinding(key, controls) {
  const storedBinding = await AgentFileStore.getBinding(key);
  const binding = await AgentFileStore.refreshBinding(storedBinding);
  if (!binding) {
    state.bindings.delete(key);
    controls.file.textContent = "尚未选择文件";
    controls.file.title = "";
    controls.status.textContent = "未保存";
    controls.status.className = "status-pill";
    controls.choose.textContent = "选择文件";
    controls.clear.disabled = true;
    return;
  }

  const hasCachedContent = typeof binding.content === "string";
  const name = binding.name || binding.handle?.name || "AGENTS.md";
  state.bindings.set(key, binding);
  controls.file.textContent = name;
  controls.file.title = name;
  controls.status.textContent = hasCachedContent ? "已保存" : "需重新选择";
  controls.status.className = `status-pill ${hasCachedContent ? "stored" : "stale"}`;
  controls.choose.textContent = hasCachedContent ? "替换文件" : "选择文件";
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
    const file = await handle.getFile();
    const content = await file.text();

    await AgentFileStore.putBinding(key, handle, file.name, content);
    if (file.name.toLowerCase() !== "agents.md") {
      showFeedback(`已保存 ${file.name}；建议使用标准文件名 AGENTS.md。`, "info");
    } else {
      showFeedback("AGENTS.md 已保存到扩展本地。", "success");
    }
    await render();
  } catch (error) {
    if (error?.name !== "AbortError") {
      showFeedback("选择文件失败，请重试。", "error");
    }
  }
}

async function clearBinding(key) {
  clearFeedback();
  await AgentFileStore.deleteBinding(key);
  state.bindings.delete(key);
  showFeedback("本地保存的文件已清除。", "success");
  await render();
}

function ensureEffectiveBindings() {
  const keys = ["global", state.origin];
  const bindings = keys
    .map((key) => ({ key, binding: state.bindings.get(key) }))
    .filter((entry) => entry.binding);

  if (bindings.length === 0) {
    showFeedback("请先选择并保存全局或当前网站的 AGENTS.md。", "error");
    return false;
  }

  const unavailable = bindings.find(({ binding }) => typeof binding.content !== "string");
  if (unavailable) {
    const name = unavailable.binding.name
      || unavailable.binding.handle?.name
      || "AGENTS.md";
    showFeedback(`${name} 尚未保存正文，请重新选择该文件。`, "error");
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
    if (!ensureEffectiveBindings()) {
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
    showFeedback("无法读取扩展本地保存的文件，请重新加载扩展。", "error");
  }
}

initialize();
