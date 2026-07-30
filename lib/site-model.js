(function attachSiteModel(global) {
  "use strict";

  const DEFAULT_SITE_TEMPLATES = Object.freeze([
    Object.freeze({
      autoDetect: true,
      editorSelectors: Object.freeze([
        "textarea#chat-input",
        "textarea[placeholder*='DeepSeek']",
        "textarea[placeholder*='发送消息']",
        "[contenteditable='true'][data-lexical-editor='true']",
        "[contenteditable='true'][role='textbox']"
      ]),
      id: "10000000-0000-4000-8000-000000000001",
      name: "DeepSeek",
      origin: "https://chat.deepseek.com"
    }),
    Object.freeze({
      autoDetect: true,
      editorSelectors: Object.freeze([
        "[data-testid*='chat_input'] [contenteditable='true']",
        "[data-testid*='chat-input'] [contenteditable='true']",
        "[contenteditable='true'][data-slate-editor='true']",
        "[contenteditable='true'][role='textbox']",
        "textarea[placeholder*='发送']"
      ]),
      id: "10000000-0000-4000-8000-000000000002",
      name: "豆包",
      origin: "https://www.doubao.com"
    }),
    Object.freeze({
      autoDetect: true,
      editorSelectors: Object.freeze([
        "[data-chat-input-body='true'] [data-slate-editor='true']",
        "[data-testid='chat-input-content-measure'] [contenteditable='true']",
        "[data-chat-input-shell='true'] [contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-slate-editor='true']"
      ]),
      id: "10000000-0000-4000-8000-000000000003",
      name: "千问",
      origin: "https://www.qianwen.com"
    }),
    Object.freeze({
      autoDetect: true,
      editorSelectors: Object.freeze([
        "#prompt-textarea[contenteditable='true']",
        "div#prompt-textarea",
        "[data-testid='composer'] [contenteditable='true']",
        "form textarea[placeholder]"
      ]),
      id: "10000000-0000-4000-8000-000000000004",
      name: "ChatGPT",
      origin: "https://chatgpt.com"
    })
  ]);
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isValidLocalDateTime(value) {
    if (typeof value !== "string") {
      return false;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
      return false;
    }
    const [year, month, day, hours, minutes, seconds] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day, hours, minutes, seconds);
    return date.getFullYear() === year
      && date.getMonth() === month - 1
      && date.getDate() === day
      && date.getHours() === hours
      && date.getMinutes() === minutes
      && date.getSeconds() === seconds;
  }

  function normalizeOrigin(value) {
    let parsed;
    try {
      parsed = new URL(String(value || "").trim());
    } catch (_error) {
      throw new Error("网站地址必须是有效的 HTTP 或 HTTPS 地址。");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("网站地址只支持 HTTP 或 HTTPS 协议。");
    }
    if (parsed.username || parsed.password) {
      throw new Error("网站地址不能包含用户名或密码。");
    }
    return parsed.origin;
  }

  function normalizeEditorSelectors(value) {
    const source = Array.isArray(value)
      ? value
      : String(value || "").split(/\r?\n/);
    const selectors = [];
    const seen = new Set();
    source.forEach((entry) => {
      if (typeof entry !== "string") {
        throw new Error("输入框选择器必须是文本。");
      }
      const selector = entry.trim();
      if (!selector || seen.has(selector)) {
        return;
      }
      if (/\r|\n/.test(selector)) {
        throw new Error("每条输入框选择器必须独占一行。");
      }
      seen.add(selector);
      selectors.push(selector);
    });
    return selectors;
  }

  function normalizeSite(site, index = 0, selectorValidator = null) {
    if (!site || typeof site !== "object") {
      throw new Error(`第 ${index + 1} 条网站配置格式无效。`);
    }
    const id = String(site.id || "");
    if (!UUID_PATTERN.test(id)) {
      throw new Error(`第 ${index + 1} 条网站配置缺少有效 UUID。`);
    }
    const name = String(site.name || "").trim();
    if (!name) {
      throw new Error(`第 ${index + 1} 条网站配置缺少名称。`);
    }
    if (/\r|\n/.test(name)) {
      throw new Error(`${name} 的名称不能包含换行。`);
    }
    if (typeof site.autoDetect !== "boolean") {
      throw new Error(`${name} 的自动识别状态必须是布尔值。`);
    }
    const code = typeof site.code === "string" ? site.code.trim() : "";
    const editorSelectors = normalizeEditorSelectors(site.editorSelectors);
    if (!site.autoDetect && editorSelectors.length === 0 && !code) {
      throw new Error(`${name} 至少需要一个输入框选择器，或开启自动识别，或提供自定义 JS 代码。`);
    }
    if (selectorValidator) {
      editorSelectors.forEach((selector) => selectorValidator(selector, name));
    }
    const fallbackTime = typeof global.AgentProfileModel?.formatLocalDateTime === "function"
      ? global.AgentProfileModel.formatLocalDateTime()
      : "1970-01-01 00:00:00";
    const createdAt = String(site.createdAt || fallbackTime);
    const updatedAt = String(site.updatedAt || site.createdAt || fallbackTime);
    if (!isValidLocalDateTime(createdAt) || !isValidLocalDateTime(updatedAt)) {
      throw new Error(`${name} 的网站时间格式无效，应为 YYYY-MM-DD HH:mm:ss。`);
    }
    return {
      autoDetect: site.autoDetect,
      code,
      createdAt,
      editorSelectors,
      id,
      name,
      origin: normalizeOrigin(site.origin),
      updatedAt
    };
  }

  function validateSites(sites, selectorValidator = null) {
    if (!Array.isArray(sites)) {
      throw new Error("网站配置列表格式无效。");
    }
    const normalized = sites.map((site, index) => normalizeSite(site, index, selectorValidator));
    const ids = new Set();
    const origins = new Set();
    normalized.forEach((site) => {
      if (ids.has(site.id)) {
        throw new Error(`网站配置 ID 重复：${site.name}。`);
      }
      if (origins.has(site.origin)) {
        throw new Error(`网站地址重复：${site.origin}。`);
      }
      ids.add(site.id);
      origins.add(site.origin);
    });
    return normalized;
  }

  function createSiteFromTemplate(template, dateTime, id = template.id) {
    return {
      autoDetect: template.autoDetect,
      code: "",
      createdAt: dateTime,
      editorSelectors: [...template.editorSelectors],
      id,
      name: template.name,
      origin: template.origin,
      updatedAt: dateTime
    };
  }

  function getTemplateByOrigin(origin) {
    const normalized = normalizeOrigin(origin);
    return DEFAULT_SITE_TEMPLATES.find((template) => template.origin === normalized) || null;
  }

  function originToMatchPattern(origin) {
    const parsed = new URL(normalizeOrigin(origin));
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }

  const api = Object.freeze({
    DEFAULT_SITE_TEMPLATES,
    UUID_PATTERN,
    createSiteFromTemplate,
    getTemplateByOrigin,
    isValidLocalDateTime,
    normalizeEditorSelectors,
    normalizeOrigin,
    normalizeSite,
    originToMatchPattern,
    validateSites
  });

  global.AgentSiteModel = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
