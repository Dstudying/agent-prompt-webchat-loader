(function installContentScript() {
  "use strict";

  if (globalThis.__chatWebAgentInstalled) {
    return;
  }
  globalThis.__chatWebAgentInstalled = true;

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
      const matches = Array.from(document.querySelectorAll(selector))
        .filter(isVisibleEditor);
      if (matches.length === 1) {
        return matches[0];
      }
    }
    return null;
  }

  function findComposer() {
    const siteEditor = findUniqueEditor(SITE_SELECTORS[location.origin] || []);
    return siteEditor || findUniqueEditor(GENERIC_SELECTORS);
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
        inputType: "insertText",
        data: null
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
    const endPosition = value.length;
    editor.setSelectionRange(endPosition, endPosition);
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
    host.style.cssText = [
      "position:fixed",
      "top:20px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:2147483647"
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .toast {
        max-width: 520px;
        padding: 11px 16px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 10px;
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

  function injectInstructions(block) {
    if (!globalThis.AgentInstructions) {
      return {
        ok: false,
        code: "UTILITIES_UNAVAILABLE",
        message: "扩展组件未正确加载，请刷新页面后重试。"
      };
    }

    const composer = findComposer();
    if (!composer) {
      return {
        ok: false,
        code: "COMPOSER_NOT_FOUND",
        message: "没有找到唯一可用的聊天输入框，请刷新页面或打开一个对话后重试。"
      };
    }

    try {
      const existingText = getEditorText(composer);
      const mergedText = AgentInstructions.mergeInstructionBlock(existingText, block);
      setEditorText(composer, mergedText);
      showToast("AGENTS.md 已写入输入框，请检查后手动发送。", "success");
      return {
        ok: true,
        code: "INJECTED",
        message: "AGENTS.md 已写入输入框。"
      };
    } catch (_error) {
      return {
        ok: false,
        code: "EDITOR_UPDATE_FAILED",
        message: "找到了输入框，但网页编辑器拒绝写入，请刷新页面后重试。"
      };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "INJECT_AGENTS") {
      const result = injectInstructions(message.block);
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

    return false;
  });
})();
