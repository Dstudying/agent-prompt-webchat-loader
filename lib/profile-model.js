(function attachProfileModel(global) {
  "use strict";

  const BACKUP_FORMAT = "agent-prompt-webchat-loader";
  const BACKUP_SCHEMA_VERSION = 1;
  const SUPPORTED_ORIGINS = Object.freeze([
    "https://chat.deepseek.com",
    "https://www.doubao.com",
    "https://www.qianwen.com"
  ]);
  const MODIFIER_CODES = new Set([
    "AltLeft",
    "AltRight",
    "ControlLeft",
    "ControlRight",
    "MetaLeft",
    "MetaRight",
    "ShiftLeft",
    "ShiftRight"
  ]);

  function normalizeShortcut(shortcut) {
    if (!shortcut) {
      return null;
    }

    return {
      altKey: Boolean(shortcut.altKey),
      code: String(shortcut.code || ""),
      ctrlKey: Boolean(shortcut.ctrlKey),
      metaKey: Boolean(shortcut.metaKey),
      shiftKey: Boolean(shortcut.shiftKey)
    };
  }

  function shortcutFromEvent(event) {
    return normalizeShortcut({
      altKey: event.altKey,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    });
  }

  function isValidShortcut(shortcut) {
    const normalized = normalizeShortcut(shortcut);
    return Boolean(
      normalized
      && normalized.code
      && !MODIFIER_CODES.has(normalized.code)
      && (normalized.altKey || normalized.ctrlKey || normalized.metaKey)
    );
  }

  function shortcutKey(shortcut) {
    const normalized = normalizeShortcut(shortcut);
    if (!normalized) {
      return "";
    }

    return [
      normalized.ctrlKey ? "C" : "-",
      normalized.altKey ? "A" : "-",
      normalized.shiftKey ? "S" : "-",
      normalized.metaKey ? "M" : "-",
      normalized.code
    ].join(":");
  }

  function displayCode(code) {
    const replacements = {
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      ArrowUp: "↑",
      Backquote: "`",
      Backslash: "\\",
      BracketLeft: "[",
      BracketRight: "]",
      Comma: ",",
      Equal: "=",
      Minus: "-",
      Period: ".",
      Quote: "'",
      Semicolon: ";",
      Slash: "/",
      Space: "Space"
    };

    if (replacements[code]) {
      return replacements[code];
    }
    if (/^Key[A-Z]$/.test(code)) {
      return code.slice(3);
    }
    if (/^Digit[0-9]$/.test(code)) {
      return code.slice(5);
    }
    if (/^Numpad[0-9]$/.test(code)) {
      return `Num ${code.slice(6)}`;
    }
    return code;
  }

  function formatShortcut(shortcut) {
    const normalized = normalizeShortcut(shortcut);
    if (!normalized) {
      return "";
    }

    const parts = [];
    if (normalized.ctrlKey) {
      parts.push("Ctrl");
    }
    if (normalized.altKey) {
      parts.push("Alt");
    }
    if (normalized.shiftKey) {
      parts.push("Shift");
    }
    if (normalized.metaKey) {
      parts.push("Meta");
    }
    parts.push(displayCode(normalized.code));
    return parts.join("+");
  }

  function matchesOrigin(sites, origin) {
    return Array.isArray(sites) && (sites.includes("*") || sites.includes(origin));
  }

  function sitesOverlap(firstSites, secondSites) {
    if (firstSites.includes("*") || secondSites.includes("*")) {
      return true;
    }
    return firstSites.some((site) => secondSites.includes(site));
  }

  function validateSites(sites) {
    if (!Array.isArray(sites) || sites.length === 0) {
      throw new Error("每条配置至少需要选择一个适用网站。");
    }
    if (sites.includes("*") && sites.length !== 1) {
      throw new Error("“全部网站”不能与单独网站同时保存。");
    }
    if (sites.some((site) => site !== "*" && !SUPPORTED_ORIGINS.includes(site))) {
      throw new Error("配置中包含不受支持的网站。");
    }
  }

  function normalizeProfile(profile, index) {
    if (!profile || typeof profile !== "object") {
      throw new Error(`第 ${index + 1} 条配置格式无效。`);
    }

    const id = String(profile.id || "");
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      throw new Error(`第 ${index + 1} 条配置缺少有效 UUID。`);
    }

    const name = String(profile.name || "").trim();
    if (!name) {
      throw new Error(`第 ${index + 1} 条配置缺少名称。`);
    }
    if (/[\r\n]/.test(name)) {
      throw new Error(`${name} 的名称不能包含换行。`);
    }
    if (profile.sourceType !== "file" && profile.sourceType !== "text") {
      throw new Error(`${name} 的来源类型无效。`);
    }
    if (typeof profile.enabled !== "boolean") {
      throw new Error(`${name} 的启用状态必须是布尔值。`);
    }
    if (typeof profile.content !== "string") {
      throw new Error(`${name} 的正文必须是文本。`);
    }
    if (profile.placement !== "prepend" && profile.placement !== "append") {
      throw new Error(`${name} 的插入位置无效。`);
    }

    validateSites(profile.sites);
    const shortcut = normalizeShortcut(profile.shortcut);
    if (shortcut && !isValidShortcut(shortcut)) {
      throw new Error(`${name} 的快捷键无效。`);
    }

    return {
      content: profile.content,
      createdAt: String(profile.createdAt || new Date().toISOString()),
      enabled: profile.enabled,
      fileName: profile.sourceType === "file"
        ? String(profile.fileName || profile.name || "AGENTS.md")
        : "",
      id,
      name,
      order: index,
      placement: profile.placement,
      shortcut,
      sites: [...profile.sites],
      sourceType: profile.sourceType,
      updatedAt: String(profile.updatedAt || new Date().toISOString())
    };
  }

  function validateProfiles(profiles) {
    if (!Array.isArray(profiles)) {
      throw new Error("配置列表格式无效。");
    }

    const normalized = profiles.map(normalizeProfile);
    const ids = new Set();
    normalized.forEach((profile) => {
      if (ids.has(profile.id)) {
        throw new Error(`配置 ID 重复：${profile.name}。`);
      }
      ids.add(profile.id);
    });

    for (let index = 0; index < normalized.length; index += 1) {
      const current = normalized[index];
      if (!current.enabled || !current.shortcut) {
        continue;
      }
      for (let otherIndex = index + 1; otherIndex < normalized.length; otherIndex += 1) {
        const other = normalized[otherIndex];
        if (
          other.enabled
          && other.shortcut
          && shortcutKey(current.shortcut) === shortcutKey(other.shortcut)
          && sitesOverlap(current.sites, other.sites)
        ) {
          throw new Error(`${current.name} 与 ${other.name} 的快捷键在相同网站范围内冲突。`);
        }
      }
    }

    return normalized;
  }

  function createBackup(profiles) {
    return {
      exportedAt: new Date().toISOString(),
      format: BACKUP_FORMAT,
      profiles: validateProfiles(profiles),
      schemaVersion: BACKUP_SCHEMA_VERSION
    };
  }

  function validateBackup(backup) {
    if (!backup || backup.format !== BACKUP_FORMAT) {
      throw new Error("这不是 AGENTS.md 导入器的配置文件。");
    }
    if (backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      throw new Error(`不支持配置版本 ${backup.schemaVersion}。`);
    }
    return validateProfiles(backup.profiles);
  }

  const api = Object.freeze({
    BACKUP_FORMAT,
    BACKUP_SCHEMA_VERSION,
    SUPPORTED_ORIGINS,
    createBackup,
    formatShortcut,
    isValidShortcut,
    matchesOrigin,
    normalizeShortcut,
    shortcutFromEvent,
    shortcutKey,
    sitesOverlap,
    validateBackup,
    validateProfiles
  });

  global.AgentProfileModel = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
