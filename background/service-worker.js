"use strict";

importScripts("../lib/file-store.js", "../lib/instruction-block.js");

const SUPPORTED_ORIGINS = new Set([
  "https://chat.deepseek.com",
  "https://www.doubao.com",
  "https://www.qianwen.com"
]);

class ImportFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ImportFailure";
    this.code = code;
  }
}

function resultFromError(error) {
  return {
    ok: false,
    code: error.code || "UNKNOWN_ERROR",
    message: error.message || "导入失败，请稍后重试。"
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

async function readBoundFile(key, scope, origin) {
  const storedBinding = await AgentFileStore.getBinding(key);
  if (!storedBinding) {
    return null;
  }

  const binding = await AgentFileStore.refreshBinding(storedBinding);
  if (typeof binding.content !== "string") {
    const name = binding.name || binding.handle?.name || "AGENTS.md";
    throw new ImportFailure(
      "FILE_RESELECTION_REQUIRED",
      `${name} 尚未保存正文，请打开扩展并重新选择该文件。`
    );
  }

  return {
    scope,
    origin,
    name: binding.name || binding.handle?.name || "AGENTS.md",
    content: binding.content
  };
}

async function readEffectiveSources(origin) {
  const sources = [];
  const globalSource = await readBoundFile("global", "global", origin);
  if (globalSource) {
    sources.push(globalSource);
  }

  const siteSource = await readBoundFile(origin, "site", origin);
  if (siteSource) {
    sources.push(siteSource);
  }

  if (sources.length === 0) {
    throw new ImportFailure(
      "NO_BINDING",
      "尚未保存 AGENTS.md，请先在扩展弹窗中选择文件。"
    );
  }

  return sources;
}

async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/instruction-block.js", "content/content.js"]
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function showPageToast(tabId, message, kind = "error") {
  try {
    await sendToContentScript(tabId, {
      type: "SHOW_TOAST",
      message,
      kind
    });
  } catch (_error) {
    await showBadge(tabId, "!", message);
  }
}

async function showBadge(tabId, text, title) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#C2410C" });
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setTitle({ tabId, title });

  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: "导入 AGENTS.md" }).catch(() => {});
  }, 4000);
}

async function importAgents(tabId) {
  let tab = null;

  try {
    tab = await getTargetTab(tabId);
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

    const sources = await readEffectiveSources(origin);
    const block = AgentInstructions.buildInstructionBlock(sources);
    if (!block) {
      throw new ImportFailure("EMPTY_FILES", "已保存的 AGENTS.md 内容为空。");
    }

    const response = await sendToContentScript(tab.id, {
      type: "INJECT_AGENTS",
      block
    });

    if (!response || !response.ok) {
      throw new ImportFailure(
        response?.code || "INJECTION_FAILED",
        response?.message || "未能写入聊天输入框。"
      );
    }

    await chrome.storage.local.set({
      lastImport: {
        origin,
        at: new Date().toISOString(),
        files: sources.map((source) => source.name)
      }
    });

    return {
      ok: true,
      code: "IMPORTED",
      message: "AGENTS.md 已写入输入框，请检查后手动发送。"
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "IMPORT_AGENTS") {
    return false;
  }

  importAgents(message.tabId).then(sendResponse);
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "inject-agents") {
    importAgents().catch(() => {});
  }
});
