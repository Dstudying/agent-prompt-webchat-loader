(function attachProfileModel(global) {
  "use strict";

  const BACKUP_FORMAT = "agent-prompt-webchat-loader";
  const BACKUP_SCHEMA_VERSION = 2;
  const DEFAULT_PROFILE_END_MARKER = "<<<请你严格遵循给定的规范:END>>>";
  const DEFAULT_PROFILE_START_MARKER = "<<<请你严格遵循给定的规范:START>>>";
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

  function padDateTimePart(value) {
    return String(value).padStart(2, "0");
  }

  function formatLocalDateTime(date = new Date()) {
    return [
      date.getFullYear(),
      padDateTimePart(date.getMonth() + 1),
      padDateTimePart(date.getDate())
    ].join("-") + " " + [
      padDateTimePart(date.getHours()),
      padDateTimePart(date.getMinutes()),
      padDateTimePart(date.getSeconds())
    ].join(":");
  }

  function isValidLocalDateTime(value) {
    if (typeof value !== "string") {
      return false;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
      return false;
    }

    const parts = match.slice(1).map(Number);
    const [year, month, day, hours, minutes, seconds] = parts;
    const date = new Date(year, month - 1, day, hours, minutes, seconds);
    return date.getFullYear() === year
      && date.getMonth() === month - 1
      && date.getDate() === day
      && date.getHours() === hours
      && date.getMinutes() === minutes
      && date.getSeconds() === seconds;
  }

  function normalizeProfileMarker(value, fallback, profileName, label) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new Error(`${profileName} 的${label}必须是文本。`);
    }
    const normalized = String(value || "").trim() || fallback;
    if (/[\r\n]/.test(normalized)) {
      throw new Error(`${profileName} 的${label}不能包含换行。`);
    }
    return normalized;
  }

  function normalizeProfileDateTime(value, fallback, profileName, label) {
    const normalized = value === undefined || value === null || value === ""
      ? fallback
      : value;
    if (isValidLocalDateTime(normalized)) {
      return normalized;
    }

    const legacyIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
    if (typeof normalized === "string" && legacyIsoPattern.test(normalized)) {
      const legacyDate = new Date(normalized);
      if (!Number.isNaN(legacyDate.getTime())) {
        return formatLocalDateTime(legacyDate);
      }
    }

    throw new Error(`${profileName} 的${label}格式无效，应为 YYYY-MM-DD HH:mm:ss。`);
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
    if (profile.contentEdited !== undefined && typeof profile.contentEdited !== "boolean") {
      throw new Error(`${name} 的正文编辑状态必须是布尔值。`);
    }
    if (profile.sourceContent !== undefined && typeof profile.sourceContent !== "string") {
      throw new Error(`${name} 的来源正文必须是文本。`);
    }
    if (profile.placement !== "prepend" && profile.placement !== "append") {
      throw new Error(`${name} 的插入位置无效。`);
    }

    const startMarker = normalizeProfileMarker(
      profile.startMarker,
      DEFAULT_PROFILE_START_MARKER,
      name,
      "开头标记"
    );
    const endMarker = normalizeProfileMarker(
      profile.endMarker,
      DEFAULT_PROFILE_END_MARKER,
      name,
      "结尾标记"
    );
    if (startMarker === endMarker) {
      throw new Error(`${name} 的开头标记和结尾标记不能相同。`);
    }

    const now = formatLocalDateTime();
    const createdAt = normalizeProfileDateTime(profile.createdAt, now, name, "创建时间");
    const updatedAt = normalizeProfileDateTime(profile.updatedAt, now, name, "更新时间");

    validateSites(profile.sites);
    const shortcut = normalizeShortcut(profile.shortcut);
    if (shortcut && !isValidShortcut(shortcut)) {
      throw new Error(`${name} 的快捷键无效。`);
    }

    return {
      content: profile.content,
      contentEdited: profile.sourceType === "file" ? Boolean(profile.contentEdited) : false,
      createdAt,
      enabled: profile.enabled,
      endMarker,
      fileName: profile.sourceType === "file"
        ? String(profile.fileName || profile.name || "AGENTS.md")
        : "",
      id,
      name,
      order: index,
      placement: profile.placement,
      shortcut,
      sites: [...profile.sites],
      ...(profile.sourceType === "file" ? {
        sourceContent: typeof profile.sourceContent === "string"
          ? profile.sourceContent
          : profile.content
      } : {}),
      sourceType: profile.sourceType,
      startMarker,
      updatedAt
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
      exportedAt: formatLocalDateTime(),
      format: BACKUP_FORMAT,
      profiles: validateProfiles(profiles),
      schemaVersion: BACKUP_SCHEMA_VERSION
    };
  }

  function validateRequiredBackupFields(profile, index) {
    if (!profile || typeof profile !== "object") {
      return;
    }
    const profileName = String(profile.name || `第 ${index + 1} 条配置`);
    ["startMarker", "endMarker"].forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(profile, field)) {
        throw new Error(`${profileName} 缺少 ${field} 字段。`);
      }
      if (typeof profile[field] !== "string" || !profile[field].trim()) {
        throw new Error(`${profileName} 的 ${field} 字段必须是非空文本。`);
      }
    });
    ["createdAt", "updatedAt"].forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(profile, field)) {
        throw new Error(`${profileName} 缺少 ${field} 字段。`);
      }
      if (!isValidLocalDateTime(profile[field])) {
        throw new Error(`${profileName} 的 ${field} 格式无效，应为 YYYY-MM-DD HH:mm:ss。`);
      }
    });
  }

  function validateBackup(backup) {
    if (!backup || backup.format !== BACKUP_FORMAT) {
      throw new Error("这不是 AGENTS.md 导入器的配置文件。");
    }
    if (backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      throw new Error(`不支持配置版本 ${backup.schemaVersion}。`);
    }
    if (!isValidLocalDateTime(backup.exportedAt)) {
      throw new Error("配置文件的 exportedAt 格式无效，应为 YYYY-MM-DD HH:mm:ss。");
    }
    if (!Array.isArray(backup.profiles)) {
      throw new Error("配置列表格式无效。");
    }
    backup.profiles.forEach(validateRequiredBackupFields);
    return validateProfiles(backup.profiles);
  }

  const api = Object.freeze({
    BACKUP_FORMAT,
    BACKUP_SCHEMA_VERSION,
    DEFAULT_PROFILE_END_MARKER,
    DEFAULT_PROFILE_START_MARKER,
    SUPPORTED_ORIGINS,
    createBackup,
    formatLocalDateTime,
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
