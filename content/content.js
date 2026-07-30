(function installContentScript() {
  "use strict";

  const previousInstallation = globalThis.__chatWebAgentInstalled;
  if (previousInstallation && typeof previousInstallation.cleanup === "function") {
    try {
      previousInstallation.cleanup();
    } catch (_error) {
      // 旧扩展上下文可能已经失效，继续安装当前实例。
    }
  }

  const SHORTCUT_INDEX_KEY = "profileShortcutIndex";
  const SHORTCUT_INDEX_REVISION_KEY = "profileShortcutIndexRevision";
  const SITE_SELECTORS = {
    "https://chat.deepseek.com": [
      "textarea#chat-input",
      "textarea[placeholder*='DeepSeek']",
      "textarea[placeholder*='发送消息']",
      "[contenteditable='true'][data-lexical-editor='true']",
      "[contenteditable='true'][role='textbox']"
    ],
    "https://www.doubao.com": [
      "[data-testid*='chat_input'] [contenteditable='true']",
      "[data-testid*='chat-input'] [contenteditable='true']",
      "[contenteditable='true'][data-slate-editor='true']",
      "[contenteditable='true'][role='textbox']",
      "textarea[placeholder*='发送']"
    ],
    "https://www.qianwen.com": [
      "[data-chat-input-body='true'] [data-slate-editor='true']",
      "[data-testid='chat-input-content-measure'] [contenteditable='true']",
      "[data-chat-input-shell='true'] [contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-slate-editor='true']"
    ]
  };
  const GENERIC_SELECTORS = [
    "textarea:not([disabled]):not([readonly])",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true'][data-lexical-editor='true']",
    "[contenteditable='true'][data-slate-editor='true']",
    "[contenteditable='true']"
  ];
  let shortcutIndex = [];
  let disposed = false;

  function isVisibleEditor(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = getComputedStyle(element);
    const rectangle = element.getBoundingClientRect();
    const disabled = element.matches(":disabled, [aria-disabled='true']");
    const readOnly = "readOnly" in element && element.readOnly;
    return !disabled
      && !readOnly
      && style.display !== "none"
      && style.visibility !== "hidden"
      && rectangle.width >= 100
      && rectangle.height >= 20;
  }

  function findUniqueEditor(selectors) {
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(isVisibleEditor);
      if (matches.length === 1) {
        return matches[0];
      }
    }
    return null;
  }

  function findComposer() {
    return findUniqueEditor(SITE_SELECTORS[location.origin] || [])
      || findUniqueEditor(GENERIC_SELECTORS);
  }

  function getEditorText(editor) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return editor.value;
    }
    return editor.innerText || editor.textContent || "";
  }

  function dispatchEditorEvents(editor) {
    try {
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: null,
        inputType: "insertText"
      }));
    } catch (_error) {
      editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setTextControlValue(editor, value) {
    const prototype = editor instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) {
      setter.call(editor, value);
    } else {
      editor.value = value;
    }
    dispatchEditorEvents(editor);
    editor.focus();
    editor.setSelectionRange(value.length, value.length);
    editor.scrollTop = editor.scrollHeight;
  }

  function placeCaretAtEnd(editor) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function setContentEditableValue(editor, value) {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, value);
    } catch (_error) {
      inserted = false;
    }
    if (!inserted) {
      editor.replaceChildren(document.createTextNode(value));
    }
    dispatchEditorEvents(editor);
    placeCaretAtEnd(editor);
    editor.scrollTop = editor.scrollHeight;
  }

  function setEditorText(editor, value) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      setTextControlValue(editor, value);
      return;
    }
    setContentEditableValue(editor, value);
  }

  function showToast(message, kind = "info") {
    document.getElementById("chat-web-agent-toast")?.remove();
    const host = document.createElement("div");
    host.id = "chat-web-agent-toast";
    host.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .toast {
        max-width: 520px;
        padding: 11px 16px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.2);
        color: #ffffff;
        font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
        word-break: break-word;
      }
      .info { background: #2563eb; }
      .success { background: #15803d; }
      .error { background: #c2410c; }
    `;
    const toast = document.createElement("div");
    toast.className = `toast ${kind}`;
    toast.textContent = message;
    shadow.append(style, toast);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 3500);
  }

  function injectProfiles(profiles) {
    if (!globalThis.AgentInstructions) {
      return {
        code: "UTILITIES_UNAVAILABLE",
        message: "扩展组件未正确加载，请刷新页面后重试。",
        ok: false
      };
    }
    const composer = findComposer();
    if (!composer) {
      return {
        code: "COMPOSER_NOT_FOUND",
        message: "没有找到唯一可用的聊天输入框，请刷新页面或打开一个对话后重试。",
        ok: false
      };
    }

    try {
      const mergedText = AgentInstructions.mergeProfileBlocks(getEditorText(composer), profiles);
      setEditorText(composer, mergedText);
      const names = profiles.map((p) => p.name).join("、");
      showToast(`已写入“${names}”，请检查后手动发送。`, "success");
      return { code: "INJECTED", message: "配置已写入输入框。", ok: true };
    } catch (_error) {
      return {
        code: "EDITOR_UPDATE_FAILED",
        message: "找到了输入框，但网页编辑器拒绝写入，请刷新页面后重试。",
        ok: false
      };
    }
  }

  async function loadShortcutIndex() {
    const result = await chrome.storage.local.get(SHORTCUT_INDEX_KEY);
    if (disposed) {
      return;
    }
    shortcutIndex = Array.isArray(result[SHORTCUT_INDEX_KEY])
      ? result[SHORTCUT_INDEX_KEY]
      : [];
  }

  function handleShortcut(event) {
    if (
      event.defaultPrevented
      || event.repeat
      || event.isComposing
      || !globalThis.AgentProfileModel
    ) {
      return;
    }
    const eventKey = AgentProfileModel.shortcutKey(
      AgentProfileModel.shortcutFromEvent(event)
    );
    const match = shortcutIndex.find((entry) => (
      AgentProfileModel.matchesOrigin(entry.sites, location.origin)
      && AgentProfileModel.shortcutKey(entry.shortcut) === eventKey
    ));
    if (!match) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    chrome.runtime.sendMessage({
      profileId: match.id,
      type: "IMPORT_PROFILE"
    }).catch(() => {
      showToast("扩展后台未响应，请重新加载扩展后重试。", "error");
    });
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") {
      return;
    }
    if (changes[SHORTCUT_INDEX_KEY]) {
      shortcutIndex = Array.isArray(changes[SHORTCUT_INDEX_KEY].newValue)
        ? changes[SHORTCUT_INDEX_KEY].newValue
        : [];
    }
    if (changes[SHORTCUT_INDEX_REVISION_KEY]) {
      loadShortcutIndex().catch(() => {});
    }
  }

  function handleWindowFocus() {
    loadShortcutIndex().catch(() => {});
  }

  function handleVisibilityChange() {
    if (!document.hidden) {
      loadShortcutIndex().catch(() => {});
    }
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "INJECT_PROFILES") {
      const result = injectProfiles(message.profiles || []);
      if (!result.ok) {
        showToast(result.message, "error");
      }
      sendResponse(result);
      return false;
    }
    if (message?.type === "SHOW_TOAST") {
      showToast(message.message, message.kind || "info");
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "RELOAD_SHORTCUT_INDEX") {
      loadShortcutIndex()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({
          message: "快捷键索引读取失败。",
          ok: false
        }));
      return true;
    }
    return false;
  }

  function cleanup() {
    disposed = true;
    document.removeEventListener("keydown", handleShortcut, true);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("focus", handleWindowFocus);
    try {
      chrome.storage.onChanged.removeListener(handleStorageChanged);
    } catch (_error) {
      // 扩展重新加载后旧上下文无法再访问 Chrome API。
    }
    try {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    } catch (_error) {
      // 扩展重新加载后旧上下文无法再访问 Chrome API。
    }
    if (globalThis.__chatWebAgentInstalled?.cleanup === cleanup) {
      delete globalThis.__chatWebAgentInstalled;
    }
  }

  chrome.storage.onChanged.addListener(handleStorageChanged);
  document.addEventListener("keydown", handleShortcut, true);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleWindowFocus);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  globalThis.__chatWebAgentInstalled = { cleanup };
  loadShortcutIndex().catch(() => {});
})();
