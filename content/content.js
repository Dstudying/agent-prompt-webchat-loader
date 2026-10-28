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
  const PALETTE_SHORTCUT_KEY = "paletteShortcut";
  const GENERIC_SELECTORS = [
    "textarea:not([disabled]):not([readonly])",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true'][data-lexical-editor='true']",
    "[contenteditable='true'][data-slate-editor='true']",
    "[contenteditable='true']"
  ];
  let shortcutIndex = [];
  let paletteShortcut = globalThis.AgentProfileModel?.normalizePaletteShortcut(null) || {
    altKey: false,
    code: "Backquote",
    ctrlKey: true,
    metaKey: false,
    shiftKey: true
  };
  let palette = null;
  let paletteLoading = false;
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
      let matches;
      try {
        matches = Array.from(document.querySelectorAll(selector)).filter(isVisibleEditor);
      } catch (_error) {
        continue;
      }
      if (matches.length === 1) {
        return { editor: matches[0], matchCount: 1, selector };
      }
    }
    return null;
  }

  function findComposer(site = {}) {
    const configured = findUniqueEditor(site.editorSelectors || []);
    if (configured || site.autoDetect === false) {
      return configured;
    }
    return findUniqueEditor(GENERIC_SELECTORS);
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

  function injectProfiles(profiles, site) {
    if (!globalThis.AgentInstructions) {
      return {
        code: "UTILITIES_UNAVAILABLE",
        message: "扩展组件未正确加载，请刷新页面后重试。",
        ok: false
      };
    }

    const match = findComposer(site);
    if (!match) {
      return {
        code: "COMPOSER_NOT_FOUND",
        message: "没有找到唯一可用的聊天输入框，请刷新页面或打开一个对话后重试。",
        ok: false
      };
    }

    try {
      const mergedText = AgentInstructions.mergeProfileBlocks(getEditorText(match.editor), profiles);
      setEditorText(match.editor, mergedText);
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

  async function loadShortcutState() {
    const result = await chrome.storage.local.get([
      SHORTCUT_INDEX_KEY,
      PALETTE_SHORTCUT_KEY
    ]);
    if (disposed) {
      return;
    }
    shortcutIndex = Array.isArray(result[SHORTCUT_INDEX_KEY])
      ? result[SHORTCUT_INDEX_KEY]
      : [];
    paletteShortcut = AgentProfileModel.normalizePaletteShortcut(
      result[PALETTE_SHORTCUT_KEY]
    );
  }

  function shortcutLabel(shortcut) {
    return shortcut ? AgentProfileModel.formatShortcut(shortcut) : "";
  }

  function filterPaletteProfiles() {
    const query = palette.query.trim().toLocaleLowerCase();
    if (!query) {
      return palette.profiles;
    }
    return palette.profiles.filter((profile) => (
      profile.name.toLocaleLowerCase().includes(query)
    ));
  }

  function updatePaletteSelection() {
    if (!palette) {
      return;
    }
    palette.list.querySelectorAll(".palette-item").forEach((item, index) => {
      const selected = index === palette.selected;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) {
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function renderPaletteList() {
    if (!palette) {
      return;
    }
    const filtered = filterPaletteProfiles();
    palette.filtered = filtered;
    palette.list.replaceChildren();
    const countText = filtered.length === palette.profiles.length
      ? `${palette.profiles.length} 条`
      : `${filtered.length} / ${palette.profiles.length} 条`;
    palette.count.textContent = palette.siteName
      ? `${palette.siteName} · ${countText}`
      : countText;

    if (palette.profiles.length === 0) {
      const empty = document.createElement("div");
      empty.className = "palette-empty";
      empty.textContent = "当前网站没有已启用的配置。";
      const openOptions = document.createElement("button");
      openOptions.type = "button";
      openOptions.textContent = "打开设置页";
      openOptions.addEventListener("click", () => {
        closePalette();
        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }).catch(() => {});
      });
      empty.append(document.createElement("br"), openOptions);
      palette.list.append(empty);
      return;
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "palette-empty";
      empty.textContent = `没有匹配“${palette.query.trim()}”的配置。`;
      palette.list.append(empty);
      return;
    }

    filtered.forEach((profile, index) => {
      const item = document.createElement("div");
      item.className = "palette-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");

      const name = document.createElement("span");
      name.className = "palette-name";
      name.textContent = profile.name;

      const meta = document.createElement("span");
      meta.className = "palette-meta";
      const label = shortcutLabel(profile.shortcut);
      if (label) {
        const badge = document.createElement("span");
        badge.className = "palette-badge";
        badge.textContent = label;
        meta.append(badge);
      } else {
        const noShortcut = document.createElement("span");
        noShortcut.className = "palette-no-shortcut";
        noShortcut.textContent = "无快捷键";
        meta.append(noShortcut);
      }
      const placement = document.createElement("span");
      placement.className = "palette-placement";
      placement.textContent = profile.placement === "append" ? "末尾" : "首行";
      meta.append(placement);

      item.append(name, meta);
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => insertPaletteProfile(profile.id));
      palette.list.append(item);
    });

    palette.selected = Math.min(palette.selected, filtered.length - 1);
    updatePaletteSelection();
  }

  function handlePaletteInput() {
    if (!palette) {
      return;
    }
    palette.query = palette.input.value;
    palette.selected = 0;
    renderPaletteList();
  }

  function handlePaletteKeydown(event) {
    if (!palette) {
      return;
    }
    if (event.isComposing) {
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (palette.query) {
        palette.input.value = "";
        palette.query = "";
        palette.selected = 0;
        renderPaletteList();
        return;
      }
      closePalette();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (palette.filtered.length === 0) {
        return;
      }
      const offset = event.key === "ArrowDown" ? 1 : -1;
      palette.selected = (
        palette.selected + offset + palette.filtered.length
      ) % palette.filtered.length;
      updatePaletteSelection();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const target = palette.filtered[palette.selected];
      if (target) {
        insertPaletteProfile(target.id);
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // 其余按键保留输入框默认输入行为，但不再冒泡给页面。
    event.stopPropagation();
  }

  function createPalette(profiles, siteName) {
    closePalette();
    const host = document.createElement("div");
    host.id = "chat-web-agent-palette";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; }
      .palette-backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 12vh 16px 16px;
        background: rgba(15, 23, 42, 0.28);
        font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .palette-panel {
        display: flex;
        width: min(520px, 100%);
        max-height: 70vh;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 12px;
        background: #ffffff;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.32);
        color: #172033;
      }
      .palette-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px 10px;
      }
      .palette-title {
        display: block;
        font-size: 14px;
        font-weight: 700;
      }
      .palette-subtitle {
        display: block;
        margin-top: 3px;
        color: #667085;
        font-size: 11px;
      }
      .palette-close {
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid #e4e7ec;
        border-radius: 6px;
        background: #ffffff;
        color: #667085;
        cursor: pointer;
        font: 18px/1 system-ui, sans-serif;
      }
      .palette-close:hover { background: #f2f4f7; color: #344054; }
      .palette-search {
        margin: 0 16px 10px;
        padding: 9px 11px;
        border: 1px solid #d0d5dd;
        border-radius: 7px;
        outline: none;
        background: #ffffff;
        color: #172033;
        font: inherit;
      }
      .palette-search:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      }
      .palette-list {
        flex: 1;
        overflow-y: auto;
        padding: 0 8px 8px;
      }
      .palette-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 10px;
        border-radius: 7px;
        cursor: pointer;
      }
      .palette-item.selected {
        background: #eff6ff;
        box-shadow: inset 0 0 0 1px #bfdbfe;
      }
      .palette-name {
        overflow: hidden;
        color: #172033;
        font-size: 13px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .palette-meta {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 8px;
        color: #667085;
        font-size: 10px;
      }
      .palette-badge {
        padding: 2px 6px;
        border: 1px solid #e4e7ec;
        border-radius: 4px;
        background: #f9fafb;
        color: #344054;
        font-size: 10px;
        font-weight: 700;
      }
      .palette-no-shortcut { color: #98a2b3; }
      .palette-placement { color: #98a2b3; }
      .palette-empty {
        padding: 26px 12px;
        color: #667085;
        font-size: 12px;
        text-align: center;
      }
      .palette-empty button {
        margin-top: 8px;
        padding: 6px 10px;
        border: 1px solid #cfd6df;
        border-radius: 6px;
        background: #ffffff;
        color: #344054;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
      }
      .palette-footer {
        padding: 9px 16px 11px;
        border-top: 1px solid #eaecf0;
        color: #667085;
        font-size: 10px;
      }
    `;

    const backdrop = document.createElement("div");
    backdrop.className = "palette-backdrop";
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) {
        closePalette();
      }
    });

    const panel = document.createElement("div");
    panel.className = "palette-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "选择要插入的配置");
    panel.addEventListener("keydown", handlePaletteKeydown);

    const header = document.createElement("div");
    header.className = "palette-header";
    const heading = document.createElement("div");
    const title = document.createElement("strong");
    title.className = "palette-title";
    title.textContent = "选择配置";
    const count = document.createElement("span");
    count.className = "palette-subtitle";
    heading.append(title, count);
    const close = document.createElement("button");
    close.className = "palette-close";
    close.type = "button";
    close.setAttribute("aria-label", "关闭");
    close.textContent = "×";
    close.addEventListener("mousedown", (event) => event.preventDefault());
    close.addEventListener("click", () => closePalette());
    header.append(heading, close);

    const input = document.createElement("input");
    input.className = "palette-search";
    input.type = "text";
    input.placeholder = "输入名称筛选…";
    input.setAttribute("aria-label", "筛选配置");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", handlePaletteInput);

    const list = document.createElement("div");
    list.className = "palette-list";
    list.setAttribute("role", "listbox");

    const footer = document.createElement("div");
    footer.className = "palette-footer";
    footer.textContent = "↑↓ 选择 · Enter 插入 · Esc 关闭 · 也可直接按配置快捷键";

    panel.append(header, input, list, footer);
    backdrop.append(panel);
    shadow.append(style, backdrop);
    document.documentElement.appendChild(host);

    palette = {
      backdrop,
      count,
      filtered: profiles,
      host,
      input,
      list,
      previousFocus: document.activeElement,
      profiles,
      query: "",
      selected: 0,
      shadow,
      siteName
    };
    renderPaletteList();
    input.focus();
  }

  function closePalette() {
    if (!palette) {
      return;
    }
    const { host, previousFocus } = palette;
    palette = null;
    host.remove();
    if (
      previousFocus
      && previousFocus !== document.body
      && previousFocus.isConnected
      && typeof previousFocus.focus === "function"
    ) {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch (_error) {
        // 页面元素可能已被框架移除，忽略焦点恢复失败。
      }
    }
  }

  async function openPalette() {
    if (disposed) {
      return;
    }
    if (palette) {
      closePalette();
      return;
    }
    if (paletteLoading) {
      return;
    }
    paletteLoading = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_PALETTE_PROFILES"
      });
      if (disposed) {
        return;
      }
      if (!response?.ok) {
        showToast(response?.message || "无法读取当前网站的配置。", "error");
        return;
      }
      createPalette(
        Array.isArray(response.profiles) ? response.profiles : [],
        response.siteName || ""
      );
    } catch (_error) {
      if (!disposed) {
        showToast("扩展后台未响应，请重新加载扩展后重试。", "error");
      }
    } finally {
      paletteLoading = false;
    }
  }

  function insertPaletteProfile(profileId) {
    closePalette();
    chrome.runtime.sendMessage({
      profileId,
      type: "IMPORT_PROFILE"
    }).catch(() => {
      showToast("扩展后台未响应，请重新加载扩展后重试。", "error");
    });
  }

  function handleShortcut(event) {
    if (
      event.defaultPrevented
      || event.isComposing
      || !globalThis.AgentProfileModel
    ) {
      return;
    }
    const eventKey = AgentProfileModel.shortcutKey(
      AgentProfileModel.shortcutFromEvent(event)
    );

    if (palette) {
      if (event.repeat) {
        return;
      }
      if (eventKey === AgentProfileModel.shortcutKey(paletteShortcut)) {
        event.preventDefault();
        event.stopPropagation();
        closePalette();
        return;
      }
      const matched = palette.profiles.find((entry) => (
        entry.shortcut
        && AgentProfileModel.shortcutKey(entry.shortcut) === eventKey
      ));
      if (matched) {
        event.preventDefault();
        event.stopPropagation();
        insertPaletteProfile(matched.id);
      }
      return;
    }

    if (event.repeat) {
      return;
    }
    if (eventKey === AgentProfileModel.shortcutKey(paletteShortcut)) {
      event.preventDefault();
      event.stopPropagation();
      openPalette().catch(() => {});
      return;
    }
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
    if (changes[PALETTE_SHORTCUT_KEY]) {
      paletteShortcut = AgentProfileModel.normalizePaletteShortcut(
        changes[PALETTE_SHORTCUT_KEY].newValue
      );
    }
    if (changes[SHORTCUT_INDEX_REVISION_KEY]) {
      loadShortcutState().catch(() => {});
    }
  }

  function highlightEditor(editor) {
    const previousOutline = editor.style.outline;
    const previousOutlineOffset = editor.style.outlineOffset;
    editor.style.outline = "3px solid #2563eb";
    editor.style.outlineOffset = "3px";
    editor.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      editor.style.outline = previousOutline;
      editor.style.outlineOffset = previousOutlineOffset;
    }, 2200);
  }

  function testSiteSelectors(site) {
    const selectors = Array.isArray(site?.editorSelectors) ? site.editorSelectors : [];
    const results = [];
    for (const selector of selectors) {
      try {
        const allMatches = Array.from(document.querySelectorAll(selector));
        const visibleMatches = allMatches.filter(isVisibleEditor);
        results.push({
          matchCount: allMatches.length,
          selector,
          visibleCount: visibleMatches.length
        });
        if (visibleMatches.length === 1) {
          highlightEditor(visibleMatches[0]);
          return {
            element: visibleMatches[0].tagName.toLowerCase(),
            matchCount: allMatches.length,
            ok: true,
            results,
            selector,
            usedAutoDetect: false,
            visible: true
          };
        }
      } catch (_error) {
        return {
          code: "INVALID_SITE_SELECTOR",
          message: `选择器语法无效：${selector}`,
          ok: false,
          results
        };
      }
    }
    if (site?.autoDetect !== false) {
      const automatic = findUniqueEditor(GENERIC_SELECTORS);
      if (automatic) {
        highlightEditor(automatic.editor);
        return {
          element: automatic.editor.tagName.toLowerCase(),
          matchCount: automatic.matchCount,
          ok: true,
          results,
          selector: automatic.selector,
          usedAutoDetect: true,
          visible: true
        };
      }
    }
    return {
      code: "COMPOSER_NOT_FOUND",
      message: "没有找到唯一可见且可编辑的输入框。",
      ok: false,
      results
    };
  }

  function handleWindowFocus() {
    loadShortcutState().catch(() => {});
  }

  function handleVisibilityChange() {
    if (!document.hidden) {
      loadShortcutState().catch(() => {});
    }
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "INJECT_PROFILES") {
      const result = injectProfiles(message.profiles || [], message.site || {});
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
    if (message?.type === "TEST_SITE_SELECTORS") {
      sendResponse(testSiteSelectors(message.site || {}));
      return false;
    }
    if (message?.type === "RELOAD_SHORTCUT_INDEX") {
      loadShortcutState()
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
    closePalette();
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
  loadShortcutState().catch(() => {});
})();
