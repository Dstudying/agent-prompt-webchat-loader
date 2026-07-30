"use strict";

const SITE_LABELS = {
  "https://chat.deepseek.com": "DeepSeek",
  "https://www.doubao.com": "豆包",
  "https://www.qianwen.com": "千问"
};

const state = {
  commandShortcuts: new Set(),
  draftShortcut: null,
  profiles: [],
  recording: false,
  selectedId: null,
  filePreviewOriginalContent: null
};

const elements = {
  addFile: document.getElementById("add-file"),
  addText: document.getElementById("add-text"),
  clearShortcut: document.getElementById("clear-shortcut"),
  content: document.getElementById("content-input"),
  deleteButton: document.getElementById("delete-button"),
  emptyEditor: document.getElementById("empty-editor"),
  emptyList: document.getElementById("empty-list"),
  endMarker: document.getElementById("end-marker-input"),
  enabled: document.getElementById("enabled-input"),
  exportButton: document.getElementById("export-button"),
  fallbackFileInput: document.getElementById("fallback-file-input"),
  feedback: document.getElementById("feedback"),
  fileName: document.getElementById("file-name"),
  fileContent: document.getElementById("file-content-input"),
  filePreviewSection: document.getElementById("file-preview-section"),
  fileSection: document.getElementById("file-section"),
  fileStatus: document.getElementById("file-status"),
  form: document.getElementById("profile-form"),
  importButton: document.getElementById("import-button"),
  importInput: document.getElementById("import-input"),
  name: document.getElementById("name-input"),
  profileCount: document.getElementById("profile-count"),
  profileList: document.getElementById("profile-list"),
  reloadFile: document.getElementById("reload-file"),
  rebindFile: document.getElementById("rebind-file"),
  shortcutRecorder: document.getElementById("shortcut-recorder"),
  siteAll: document.getElementById("site-all"),
  siteOptions: Array.from(document.querySelectorAll(".site-option")),
  sourceBadge: document.getElementById("source-badge"),
  startMarker: document.getElementById("start-marker-input"),
  textSection: document.getElementById("text-section")
};

function selectedProfile() {
  return state.profiles.find((profile) => profile.id === state.selectedId) || null;
}

function showFeedback(message, kind = "info") {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback visible ${kind}`;
}

function clearFeedback() {
  elements.feedback.textContent = "";
  elements.feedback.className = "feedback";
}

function siteSummary(sites) {
  if (sites.includes("*")) {
    return "全部网站";
  }
  return sites.map((site) => SITE_LABELS[site]).filter(Boolean).join("、");
}

function sourceStatus(profile) {
  if (profile.sourceType !== "file") {
    return "文本配置";
  }
  if (profile.handle?.getFile) {
    return profile.contentEdited
      ? "使用已修改的导入副本；本地文件未更改"
      : "已关联本地文件；读取失败时使用正文缓存";
  }
  return profile.contentEdited
    ? "使用已修改的导入副本；来源文件需要重新关联"
    : "JSON 或浏览器文件快照；可重新关联本地文件";
}

function renderShortcut() {
  elements.shortcutRecorder.textContent = state.recording
    ? "请按下组合键…"
    : AgentProfileModel.formatShortcut(state.draftShortcut) || "点击录制";
  elements.shortcutRecorder.classList.toggle("recording", state.recording);
}

function renderList() {
  elements.profileList.replaceChildren();
  elements.profileCount.textContent = `${state.profiles.length} 条`;
  elements.emptyList.hidden = state.profiles.length > 0;

  state.profiles.forEach((profile, index) => {
    const item = document.createElement("div");
    item.className = `profile-item${profile.id === state.selectedId ? " selected" : ""}${profile.enabled ? "" : " disabled"}`;

    const select = document.createElement("button");
    select.className = "profile-select";
    select.type = "button";
    const title = document.createElement("strong");
    title.textContent = profile.name;
    const detail = document.createElement("span");
    const shortcut = AgentProfileModel.formatShortcut(profile.shortcut);
    detail.textContent = [siteSummary(profile.sites), shortcut].filter(Boolean).join(" · ");
    select.append(title, detail);
    select.addEventListener("click", () => selectProfile(profile.id));

    const orderButtons = document.createElement("div");
    orderButtons.className = "order-buttons";
    const up = document.createElement("button");
    up.className = "order-button";
    up.type = "button";
    up.textContent = "↑";
    up.title = "上移";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveProfile(index, -1));
    const down = document.createElement("button");
    down.className = "order-button";
    down.type = "button";
    down.textContent = "↓";
    down.title = "下移";
    down.disabled = index === state.profiles.length - 1;
    down.addEventListener("click", () => moveProfile(index, 1));
    orderButtons.append(up, down);
    item.append(select, orderButtons);
    elements.profileList.append(item);
  });
}

function renderEditor() {
  const profile = selectedProfile();
  elements.emptyEditor.hidden = Boolean(profile);
  elements.form.hidden = !profile;
  if (!profile) {
    return;
  }

  clearFeedback();
  elements.name.value = profile.name;
  elements.enabled.checked = profile.enabled;
  elements.sourceBadge.textContent = profile.sourceType === "file" ? "文件" : "文本";
  elements.textSection.hidden = profile.sourceType !== "text";
  elements.fileSection.hidden = profile.sourceType !== "file";
  elements.filePreviewSection.hidden = profile.sourceType !== "file";
  elements.content.value = profile.content;
  elements.fileContent.value = profile.content;
  elements.endMarker.value = profile.endMarker
    || AgentProfileModel.DEFAULT_PROFILE_END_MARKER;
  elements.fileName.textContent = profile.fileName || "AGENTS.md";
  elements.fileStatus.textContent = sourceStatus(profile);
  elements.reloadFile.disabled = profile.sourceType !== "file" || !profile.handle?.getFile;
  state.filePreviewOriginalContent = profile.sourceType === "file" ? profile.content : null;
  elements.siteAll.checked = profile.sites.includes("*");
  elements.startMarker.value = profile.startMarker
    || AgentProfileModel.DEFAULT_PROFILE_START_MARKER;
  elements.siteOptions.forEach((input) => {
    input.checked = profile.sites.includes(input.value);
    input.disabled = elements.siteAll.checked;
  });
  const placement = elements.form.querySelector(`input[name="placement"][value="${profile.placement}"]`);
  if (placement) {
    placement.checked = true;
  }
  state.draftShortcut = profile.shortcut;
  state.recording = false;
  renderShortcut();
}

function selectProfile(id) {
  cacheCurrentDraft();
  state.selectedId = id;
  renderList();
  renderEditor();
}

function cacheCurrentDraft() {
  const profile = selectedProfile();
  if (!profile || elements.form.hidden) {
    return;
  }
  const draft = readFormProfile({ updateTimestamp: false });
  state.profiles = state.profiles.map((entry) => entry.id === draft.id ? draft : entry);
}

function createProfile(sourceType, values = {}) {
  const now = AgentProfileModel.formatLocalDateTime();
  return {
    content: values.content || "",
    contentEdited: false,
    createdAt: now,
    enabled: true,
    endMarker: values.endMarker || AgentProfileModel.DEFAULT_PROFILE_END_MARKER,
    fileName: values.fileName || "",
    handle: values.handle,
    id: crypto.randomUUID(),
    name: values.name || (sourceType === "text" ? "新文本配置" : values.fileName),
    order: state.profiles.length,
    placement: "prepend",
    shortcut: null,
    sites: ["*"],
    sourceType,
    startMarker: values.startMarker || AgentProfileModel.DEFAULT_PROFILE_START_MARKER,
    updatedAt: now
  };
}

function addTextProfile() {
  const profile = createProfile("text");
  state.profiles.push(profile);
  selectProfile(profile.id);
  elements.name.select();
}

async function filesToProfiles(files, handles = []) {
  const profiles = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    profiles.push(createProfile("file", {
      content: await file.text(),
      fileName: file.name,
      handle: handles[index],
      name: file.name
    }));
  }
  return profiles;
}

async function saveAddedFileProfiles(profiles) {
  if (profiles.length === 0) {
    return;
  }
  state.profiles.push(...profiles);
  state.profiles.forEach((profile, index) => {
    profile.order = index;
  });
  await AgentProfileStore.putProfiles(profiles);
  selectProfile(profiles[0].id);
}

async function addFiles() {
  clearFeedback();
  if (typeof globalThis.showOpenFilePicker !== "function") {
    elements.fallbackFileInput.click();
    return;
  }

  try {
    const handles = await showOpenFilePicker({
      multiple: true,
      types: [{
        accept: {
          "text/markdown": [".md"],
          "text/plain": [".txt"]
        },
        description: "Markdown 或文本文件"
      }]
    });
    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    await saveAddedFileProfiles(await filesToProfiles(files, handles));
  } catch (error) {
    if (error?.name !== "AbortError") {
      showFeedback("选择文件失败，请重试。", "error");
    }
  }
}

async function handleFallbackFiles() {
  try {
    await saveAddedFileProfiles(await filesToProfiles(Array.from(elements.fallbackFileInput.files)));
  } catch (_error) {
    showFeedback("读取文件失败，请重试。", "error");
  } finally {
    elements.fallbackFileInput.value = "";
  }
}

function getSelectedSites() {
  if (elements.siteAll.checked) {
    return ["*"];
  }
  return elements.siteOptions.filter((input) => input.checked).map((input) => input.value);
}

function readFormProfile({ updateTimestamp = true } = {}) {
  const profile = selectedProfile();
  const placement = elements.form.querySelector("input[name='placement']:checked")?.value;
  const content = profile.sourceType === "text" ? elements.content.value : elements.fileContent.value;
  return {
    ...profile,
    content,
    contentEdited: profile.sourceType === "file"
      ? Boolean(profile.contentEdited || content !== state.filePreviewOriginalContent)
      : false,
    enabled: elements.enabled.checked,
    endMarker: elements.endMarker.value.trim()
      || AgentProfileModel.DEFAULT_PROFILE_END_MARKER,
    name: elements.name.value.trim(),
    placement,
    shortcut: state.draftShortcut,
    sites: getSelectedSites(),
    startMarker: elements.startMarker.value.trim()
      || AgentProfileModel.DEFAULT_PROFILE_START_MARKER,
    updatedAt: updateTimestamp
      ? AgentProfileModel.formatLocalDateTime()
      : profile.updatedAt
  };
}

async function saveCurrentProfile(event) {
  event.preventDefault();
  clearFeedback();
  try {
    const updated = readFormProfile();
    if (!updated.content.trim()) {
      throw new Error("规范正文不能为空。");
    }
    const nextProfiles = state.profiles.map((profile) => profile.id === updated.id ? updated : profile);
    const normalized = AgentProfileModel.validateProfiles(nextProfiles);
    if (updated.shortcut && state.commandShortcuts.has(
      AgentProfileModel.formatShortcut(updated.shortcut).toLowerCase()
    )) {
      throw new Error("该组合键已被浏览器扩展命令使用，请选择其他快捷键。");
    }

    const normalizedProfile = normalized.find((profile) => profile.id === updated.id);
    const saved = { ...normalizedProfile, handle: updated.handle };
    await AgentProfileStore.putProfile(saved);
    state.profiles = state.profiles.map((profile) => profile.id === saved.id ? saved : profile);
    renderList();
    renderEditor();
    showFeedback("配置已保存。", "success");
  } catch (error) {
    showFeedback(error.message || "保存失败，请重试。", "error");
  }
}

async function rebindFile() {
  const profile = selectedProfile();
  if (!profile || profile.sourceType !== "file") {
    return;
  }
  if (hasFileContentChanges(profile) && !confirm(
    "重新关联会放弃当前导入副本修改，是否继续？"
  )) {
    return;
  }
  const draftProfile = readFormProfile({ updateTimestamp: false });
  try {
    let file;
    let handle;
    if (typeof globalThis.showOpenFilePicker === "function") {
      [handle] = await showOpenFilePicker({
        multiple: false,
        types: [{
          accept: {
            "text/markdown": [".md"],
            "text/plain": [".txt"]
          },
          description: "Markdown 或文本文件"
        }]
      });
      file = await handle.getFile();
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.txt,text/markdown,text/plain";
      input.hidden = true;
      input.addEventListener("change", async () => {
        const selected = input.files[0];
        if (selected) {
          await applyReboundFile(draftProfile, selected, null);
        }
        input.remove();
      }, { once: true });
      document.body.append(input);
      input.click();
      return;
    }
    await applyReboundFile(draftProfile, file, handle);
  } catch (error) {
    if (error?.name !== "AbortError") {
      showFeedback("重新关联文件失败，请重试。", "error");
    }
  }
}

async function applyReboundFile(profile, file, handle) {
  const updated = {
    ...profile,
    content: await file.text(),
    contentEdited: false,
    fileName: file.name,
    handle,
    updatedAt: AgentProfileModel.formatLocalDateTime()
  };
  await AgentProfileStore.putProfile(updated);
  state.profiles = state.profiles.map((entry) => entry.id === updated.id ? updated : entry);
  renderList();
  renderEditor();
  showFeedback("本地文件已重新关联。", "success");
}

function hasFileContentChanges(profile) {
  return Boolean(
    profile?.sourceType === "file"
    && (profile.contentEdited || elements.fileContent.value !== profile.content)
  );
}

async function reloadFile() {
  const profile = selectedProfile();
  if (!profile || profile.sourceType !== "file" || !profile.handle?.getFile) {
    return;
  }
  if (hasFileContentChanges(profile) && !confirm(
    "重新读取会放弃当前导入副本修改，是否继续？"
  )) {
    return;
  }
  const draftProfile = readFormProfile({ updateTimestamp: false });
  try {
    const file = await profile.handle.getFile();
    await applyReboundFile(draftProfile, file, profile.handle);
    showFeedback("已重新读取来源文件。", "success");
  } catch (_error) {
    showFeedback("重新读取来源文件失败，请重试。", "error");
  }
}

async function deleteCurrentProfile() {
  const profile = selectedProfile();
  if (!profile || !confirm(`确定删除“${profile.name}”吗？`)) {
    return;
  }
  await AgentProfileStore.deleteProfile(profile.id);
  state.profiles = state.profiles.filter((entry) => entry.id !== profile.id);
  state.profiles.forEach((entry, index) => {
    entry.order = index;
  });
  await AgentProfileStore.putProfiles(state.profiles);
  state.selectedId = state.profiles[0]?.id || null;
  renderList();
  renderEditor();
}

async function moveProfile(index, offset) {
  const target = index + offset;
  if (target < 0 || target >= state.profiles.length) {
    return;
  }
  [state.profiles[index], state.profiles[target]] = [state.profiles[target], state.profiles[index]];
  state.profiles.forEach((profile, profileIndex) => {
    profile.order = profileIndex;
  });
  await AgentProfileStore.putProfiles(state.profiles);
  renderList();
}

function recordShortcut(event) {
  if (!state.recording) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.code === "Escape") {
    state.recording = false;
    renderShortcut();
    return;
  }
  const shortcut = AgentProfileModel.shortcutFromEvent(event);
  if (!AgentProfileModel.isValidShortcut(shortcut)) {
    showFeedback("快捷键至少需要 Ctrl、Alt 或 Meta，并包含一个非修饰键。", "error");
    return;
  }
  state.draftShortcut = shortcut;
  state.recording = false;
  clearFeedback();
  renderShortcut();
}

function exportProfiles() {
  try {
    const backup = AgentProfileModel.createBackup(state.profiles);
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = AgentProfileModel.formatLocalDateTime()
      .replace(" ", "_")
      .replace(/:/g, "-");
    link.href = url;
    link.download = `agent-prompt-config-${timestamp}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showFeedback(error.message || "导出失败。", "error");
  }
}

async function importProfiles() {
  const file = elements.importInput.files[0];
  elements.importInput.value = "";
  if (!file) {
    return;
  }
  try {
    const backup = JSON.parse(await file.text());
    const profiles = AgentProfileModel.validateBackup(backup);
    if (!confirm(`导入将替换当前 ${state.profiles.length} 条配置，是否继续？`)) {
      return;
    }
    await AgentProfileStore.replaceProfiles(profiles);
    state.profiles = profiles;
    state.selectedId = profiles[0]?.id || null;
    renderList();
    renderEditor();
    if (state.selectedId) {
      showFeedback(`已导入 ${profiles.length} 条配置。`, "success");
    }
  } catch (error) {
    showFeedback(error.message || "JSON 导入失败，现有配置未更改。", "error");
  }
}

async function initialize() {
  await AgentProfileStore.initialize();
  const [profiles, commands] = await Promise.all([
    AgentProfileStore.getAllProfiles(),
    chrome.commands.getAll()
  ]);
  state.profiles = profiles;
  state.commandShortcuts = new Set(
    commands.map((command) => command.shortcut?.toLowerCase()).filter(Boolean)
  );
  state.selectedId = profiles[0]?.id || null;
  renderList();
  renderEditor();
}

elements.addText.addEventListener("click", addTextProfile);
elements.addFile.addEventListener("click", addFiles);
elements.fallbackFileInput.addEventListener("change", handleFallbackFiles);
elements.form.addEventListener("submit", saveCurrentProfile);
elements.deleteButton.addEventListener("click", deleteCurrentProfile);
elements.rebindFile.addEventListener("click", rebindFile);
elements.reloadFile.addEventListener("click", reloadFile);
elements.shortcutRecorder.addEventListener("click", () => {
  state.recording = true;
  clearFeedback();
  renderShortcut();
  elements.shortcutRecorder.focus();
});
elements.shortcutRecorder.addEventListener("keydown", recordShortcut);
elements.clearShortcut.addEventListener("click", () => {
  state.draftShortcut = null;
  state.recording = false;
  renderShortcut();
});
elements.siteAll.addEventListener("change", () => {
  elements.siteOptions.forEach((input) => {
    input.disabled = elements.siteAll.checked;
    if (elements.siteAll.checked) {
      input.checked = false;
    }
  });
});
elements.exportButton.addEventListener("click", exportProfiles);
elements.importButton.addEventListener("click", () => elements.importInput.click());
elements.importInput.addEventListener("change", importProfiles);

initialize().catch(() => {
  showFeedback("无法读取扩展配置，请重新加载扩展后重试。", "error");
});
