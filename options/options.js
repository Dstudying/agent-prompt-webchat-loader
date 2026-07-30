"use strict";

const state = {
  commandShortcuts: new Set(),
  draftShortcut: null,
  profiles: [],
  recording: false,
  selectedId: null,
  selectedSiteId: null,
  siteDraft: null,
  sites: [],
  view: "profiles"
};

const elements = {
  addFile: document.getElementById("add-file"),
  addText: document.getElementById("add-text"),
  associateFile: document.getElementById("associate-file"),
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
  shortcutRecorder: document.getElementById("shortcut-recorder"),
  siteAll: document.getElementById("site-all"),
  siteOptionsContainer: document.getElementById("site-options"),
  sourceBadge: document.getElementById("source-badge"),
  startMarker: document.getElementById("start-marker-input"),
  textSection: document.getElementById("text-section"),
  addSite: document.getElementById("add-site"),
  authorizeSite: document.getElementById("authorize-site"),
  copySite: document.getElementById("copy-site"),
  deleteSite: document.getElementById("delete-site"),
  emptySiteEditor: document.getElementById("empty-site-editor"),
  emptySites: document.getElementById("empty-sites"),
  profilesTab: document.getElementById("profiles-tab"),
  profilesView: document.getElementById("profiles-view"),
  siteAutoDetect: document.getElementById("site-auto-detect-input"),
  siteAutoDetectRow: document.getElementById("site-auto-detect-row"),
  siteEditorBadge: document.getElementById("site-editor-badge"),
  siteEditorTitle: document.getElementById("site-editor-title"),
  siteFeedback: document.getElementById("site-feedback"),
  siteForm: document.getElementById("site-form"),
  siteList: document.getElementById("site-list"),
  siteName: document.getElementById("site-name-input"),
  siteOrigin: document.getElementById("site-origin-input"),
  sitePermissionStatus: document.getElementById("site-permission-status"),
  siteCodeInput: document.getElementById("site-code-input"),
  siteCodeField: document.getElementById("site-code-field"),
  siteSelectors: document.getElementById("site-selectors-input"),
  siteSelectorsField: document.getElementById("site-selectors-field"),
  sitesTab: document.getElementById("sites-tab"),
  sitesView: document.getElementById("sites-view"),
  templateList: document.getElementById("template-list"),
  templateFeedback: document.getElementById("template-feedback"),
  testSite: document.getElementById("test-site")
};

function siteOptionInputs() {
  return Array.from(elements.siteOptionsContainer.querySelectorAll(".site-option"));
}

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
  const namesById = new Map(state.sites.map((site) => [site.id, site.name]));
  return sites.map((siteId) => namesById.get(siteId)).filter(Boolean).join("、");
}

function renderProfileSiteOptions() {
  const selected = selectedProfile()?.sites || [];
  elements.siteOptionsContainer.querySelectorAll(".site-option-label").forEach((label) => {
    label.remove();
  });
  state.sites.forEach((site) => {
    const label = document.createElement("label");
    label.className = "site-option-label";
    const input = document.createElement("input");
    input.className = "site-option";
    input.type = "checkbox";
    input.value = site.id;
    input.checked = selected.includes(site.id);
    input.disabled = elements.siteAll.checked;
    label.append(input, document.createTextNode(` ${site.name}`));
    elements.siteOptionsContainer.append(label);
  });
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
    ? "使用已修改的导入副本；重新读取可恢复来源快照"
    : "使用来源文件快照；关联文件后可读取磁盘最新内容";
}

function getSourceContent(profile) {
  if (profile?.sourceType !== "file") {
    return "";
  }
  return typeof profile.sourceContent === "string"
    ? profile.sourceContent
    : profile.content;
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
  elements.reloadFile.disabled = profile.sourceType !== "file";
  elements.siteAll.checked = profile.sites.includes("*");
  elements.startMarker.value = profile.startMarker
    || AgentProfileModel.DEFAULT_PROFILE_START_MARKER;
  renderProfileSiteOptions();
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
  const profile = {
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
  if (sourceType === "file") {
    profile.sourceContent = values.sourceContent ?? values.content ?? "";
  }
  return profile;
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
  return siteOptionInputs().filter((input) => input.checked).map((input) => input.value);
}

function readFormProfile({ updateTimestamp = true } = {}) {
  const profile = selectedProfile();
  const placement = elements.form.querySelector("input[name='placement']:checked")?.value;
  const content = profile.sourceType === "text" ? elements.content.value : elements.fileContent.value;
  const sourceContent = getSourceContent(profile);
  return {
    ...profile,
    content,
    contentEdited: profile.sourceType === "file"
      ? content !== sourceContent
      : false,
    enabled: elements.enabled.checked,
    endMarker: elements.endMarker.value.trim()
      || AgentProfileModel.DEFAULT_PROFILE_END_MARKER,
    name: elements.name.value.trim(),
    placement,
    shortcut: state.draftShortcut,
    sites: getSelectedSites(),
    ...(profile.sourceType === "file" ? { sourceContent } : {}),
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
    const normalized = AgentProfileModel.validateProfiles(
      nextProfiles,
      state.sites.map((site) => site.id)
    );
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

async function associateFile() {
  const profile = selectedProfile();
  if (!profile || profile.sourceType !== "file") {
    return;
  }
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
          if (hasFileContentChanges(profile) && !confirm(
            "关联其他本地文件会放弃当前导入副本修改，是否继续？"
          )) {
            input.remove();
            return;
          }
          try {
            const draftProfile = readFormProfile({ updateTimestamp: false });
            await applySourceFile(draftProfile, selected, null);
            showFeedback("已关联本地文件。", "success");
          } catch (_error) {
            showFeedback("关联文件失败，请重试。", "error");
          }
        }
        input.remove();
      }, { once: true });
      document.body.append(input);
      input.click();
      return;
    }
    if (hasFileContentChanges(profile) && !confirm(
      "关联其他本地文件会放弃当前导入副本修改，是否继续？"
    )) {
      return;
    }
    const draftProfile = readFormProfile({ updateTimestamp: false });
    await applySourceFile(draftProfile, file, handle);
    showFeedback("已关联本地文件。", "success");
  } catch (error) {
    if (error?.name !== "AbortError") {
      showFeedback("关联文件失败，请重试。", "error");
    }
  }
}

async function applySourceFile(profile, file, handle) {
  const content = await file.text();
  await applySourceContent(profile, content, file.name, handle);
}

async function applySourceContent(profile, content, fileName, handle) {
  const updated = {
    ...profile,
    content,
    contentEdited: false,
    fileName,
    handle,
    sourceContent: content,
    updatedAt: AgentProfileModel.formatLocalDateTime()
  };
  await AgentProfileStore.putProfile(updated);
  state.profiles = state.profiles.map((entry) => entry.id === updated.id ? updated : entry);
  renderList();
  renderEditor();
}

function hasFileContentChanges(profile) {
  return Boolean(
    profile?.sourceType === "file"
    && elements.fileContent.value !== getSourceContent(profile)
  );
}

async function reloadFile() {
  const profile = selectedProfile();
  if (!profile || profile.sourceType !== "file") {
    return;
  }
  const hasHandle = Boolean(profile.handle?.getFile);
  const confirmation = hasHandle
    ? "重新读取将使用当前来源文件的磁盘内容覆盖预览，并放弃插件内所有修改。是否继续？"
    : "重新读取将使用保存的来源快照覆盖预览，并放弃插件内所有修改。是否继续？";
  if (!confirm(confirmation)) {
    return;
  }
  const draftProfile = readFormProfile({ updateTimestamp: false });
  try {
    if (hasHandle) {
      const file = await profile.handle.getFile();
      await applySourceFile(draftProfile, file, profile.handle);
      showFeedback("已重新读取来源文件。", "success");
    } else {
      await applySourceContent(
        draftProfile,
        getSourceContent(profile),
        profile.fileName,
        profile.handle
      );
      showFeedback("已恢复来源文件快照。", "success");
    }
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
    const backup = AgentProfileModel.createBackup(state.profiles, state.sites);
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
    const imported = AgentProfileModel.validateBackup(backup, validateSelectorSyntax);
    const { profiles, sites } = imported;
    const importedCount = profiles.length;
    const overwrittenCount = state.profiles.length;
    if (!confirm(
      `将导入 ${importedCount} 条配置，并覆盖当前 ${overwrittenCount} 条配置。是否继续？`
    )) {
      return;
    }
    const previousSites = [...state.sites];
    await AgentProfileStore.replaceConfiguration(profiles, sites);
    state.profiles = profiles;
    state.sites = sites;
    state.selectedId = profiles[0]?.id || null;
    state.selectedSiteId = sites[0]?.id || null;
    renderList();
    renderEditor();
    renderSiteList();
    renderSiteEditor();
    renderTemplates();
    await removeUnusedSitePermissions(previousSites, sites);
    await notifySiteRegistryChanged();
    showFeedback(
      `导入完成：共导入 ${importedCount} 条配置，覆盖 ${overwrittenCount} 条原有配置。`,
      "success"
    );
  } catch (error) {
    showFeedback(error.message || "JSON 导入失败，现有配置未更改。", "error");
  }
}

function showSiteFeedback(message, kind = "info") {
  elements.siteFeedback.textContent = message;
  elements.siteFeedback.className = `feedback visible ${kind}`;
}

function clearSiteFeedback() {
  elements.siteFeedback.textContent = "";
  elements.siteFeedback.className = "feedback";
}

function selectedSite() {
  if (state.siteDraft) {
    return state.siteDraft;
  }
  return state.sites.find((site) => site.id === state.selectedSiteId) || null;
}

function switchView(view) {
  state.view = view;
  const showProfiles = view === "profiles";
  elements.profilesView.hidden = !showProfiles;
  elements.sitesView.hidden = showProfiles;
  elements.profilesTab.classList.toggle("active", showProfiles);
  elements.sitesTab.classList.toggle("active", !showProfiles);
  elements.profilesTab.setAttribute("aria-selected", String(showProfiles));
  elements.sitesTab.setAttribute("aria-selected", String(!showProfiles));
}

async function siteHasPermission(site) {
  return chrome.permissions.contains({
    origins: [AgentSiteModel.originToMatchPattern(site.origin)]
  });
}

async function updateSitePermissionStatus(site) {
  if (!site || selectedSite()?.id !== site.id) {
    return;
  }
  try {
    const permitted = await siteHasPermission(site);
    if (selectedSite()?.id !== site.id) {
      return;
    }
    elements.sitePermissionStatus.textContent = permitted ? "已授权" : "未授权";
    elements.sitePermissionStatus.classList.toggle("missing", !permitted);
    elements.authorizeSite.hidden = permitted;
  } catch (_error) {
    elements.sitePermissionStatus.textContent = "权限状态未知";
    elements.sitePermissionStatus.classList.add("missing");
    elements.authorizeSite.hidden = false;
  }
}

function renderSiteList() {
  elements.siteList.replaceChildren();
  elements.emptySites.hidden = state.sites.length > 0;
  state.sites.forEach((site) => {
    const item = document.createElement("div");
    item.className = `managed-site-item${site.id === state.selectedSiteId && !state.siteDraft ? " selected" : ""}`;
    const select = document.createElement("button");
    select.className = "managed-site-select";
    select.type = "button";
    const name = document.createElement("strong");
    name.textContent = site.name;
    const origin = document.createElement("span");
    origin.textContent = site.origin;
    select.append(name, origin);
    select.addEventListener("click", () => {
      state.siteDraft = null;
      state.selectedSiteId = site.id;
      renderSiteList();
      renderSiteEditor();
    });
    item.append(select);
    elements.siteList.append(item);
  });
}

function setSiteEditorMode(mode) {
  const isCode = mode === "code";
  elements.siteSelectorsField.hidden = isCode;
  elements.siteCodeField.hidden = !isCode;
  elements.siteAutoDetectRow.hidden = isCode;
  const radios = document.querySelectorAll("input[name='site-editor-mode']");
  radios.forEach((radio) => {
    radio.checked = radio.value === mode;
  });
}

function renderSiteEditor() {
  const site = selectedSite();
  elements.siteForm.hidden = !site;
  elements.emptySiteEditor.hidden = Boolean(site);
  if (!site) {
    return;
  }
  clearSiteFeedback();
  const isDraft = Boolean(state.siteDraft);
  elements.siteEditorBadge.textContent = isDraft ? "新网站" : "网站";
  elements.siteEditorTitle.textContent = isDraft ? "添加网站" : "编辑网站";
  elements.siteName.value = site.name;
  elements.siteOrigin.value = site.origin;
  elements.siteSelectors.value = (site.editorSelectors || []).join("\n");
  elements.siteCodeInput.value = site.code || "";
  elements.siteAutoDetect.checked = site.autoDetect;
  const mode = (site.code && site.code.trim()) ? "code" : "selector";
  setSiteEditorMode(mode);
  elements.testSite.textContent = mode === "code" ? "测试代码" : "测试选择器";
  elements.deleteSite.hidden = isDraft;
  elements.copySite.hidden = isDraft;
  elements.sitePermissionStatus.textContent = isDraft ? "保存时授权" : "读取权限中…";
  elements.sitePermissionStatus.classList.toggle("missing", isDraft);
  elements.authorizeSite.hidden = isDraft;
  if (!isDraft) {
    updateSitePermissionStatus(site);
  }
}

function validateSelectorSyntax(selector, siteName) {
  try {
    document.querySelector(selector);
  } catch (_error) {
    throw new Error(`${siteName} 的选择器语法无效：${selector}`);
  }
}

function getSiteEditorMode() {
  const radio = document.querySelector("input[name='site-editor-mode']:checked");
  return radio ? radio.value : "selector";
}

function readSiteForm() {
  const current = selectedSite();
  const now = AgentProfileModel.formatLocalDateTime();
  const mode = getSiteEditorMode();
  return AgentSiteModel.normalizeSite({
    autoDetect: mode === "selector" ? elements.siteAutoDetect.checked : false,
    code: mode === "code" ? elements.siteCodeInput.value : "",
    createdAt: current?.createdAt || now,
    editorSelectors: mode === "selector" ? elements.siteSelectors.value : [],
    id: current?.id || crypto.randomUUID(),
    name: elements.siteName.value,
    origin: elements.siteOrigin.value,
    updatedAt: now
  }, 0, mode === "selector" ? validateSelectorSyntax : null);
}

async function requestSitePermission(site) {
  const pattern = AgentSiteModel.originToMatchPattern(site.origin);
  return chrome.permissions.request({ origins: [pattern] });
}

async function removeUnusedSitePermissions(previousSites, remainingSites) {
  const remainingPatterns = new Set(remainingSites.map((site) => (
    AgentSiteModel.originToMatchPattern(site.origin)
  )));
  const removedPatterns = [...new Set(previousSites.map((site) => (
    AgentSiteModel.originToMatchPattern(site.origin)
  )))].filter((pattern) => !remainingPatterns.has(pattern));
  await Promise.allSettled(removedPatterns.map((pattern) => (
    chrome.permissions.remove({ origins: [pattern] })
  )));
}

async function notifySiteRegistryChanged() {
  try {
    await chrome.runtime.sendMessage({ type: "SITE_REGISTRY_CHANGED" });
  } catch (_error) {
    // 后台重新加载期间，下次启动会自动同步动态内容脚本。
  }
}

function ensureUniqueSite(site) {
  const conflict = state.sites.find((entry) => (
    entry.origin === site.origin && entry.id !== site.id
  ));
  if (conflict) {
    throw new Error(`网站地址已被“${conflict.name}”使用。`);
  }
}

async function saveSite(event) {
  event.preventDefault();
  clearSiteFeedback();
  try {
    const previous = state.siteDraft
      ? null
      : state.sites.find((site) => site.id === state.selectedSiteId) || null;
    const site = readSiteForm();
    ensureUniqueSite(site);
    if (!await requestSitePermission(site)) {
      throw new Error("未获得网站访问权限，网站配置尚未保存。");
    }
    await AgentProfileStore.putSite(site);
    state.sites = state.sites.filter((entry) => entry.id !== site.id);
    state.sites.push(site);
    state.siteDraft = null;
    state.selectedSiteId = site.id;
    if (previous && previous.origin !== site.origin) {
      await removeUnusedSitePermissions([previous], state.sites);
    }
    renderSiteList();
    renderSiteEditor();
    renderTemplates();
    renderList();
    renderEditor();
    await notifySiteRegistryChanged();
    showSiteFeedback("网站配置已保存。", "success");
  } catch (error) {
    showSiteFeedback(error.message || "保存网站失败，请重试。", "error");
  }
}

function createSiteDraft(values = {}) {
  const now = AgentProfileModel.formatLocalDateTime();
  state.siteDraft = {
    autoDetect: values.autoDetect ?? true,
    code: values.code || "",
    createdAt: now,
    editorSelectors: [...(values.editorSelectors || [])],
    id: crypto.randomUUID(),
    name: values.name || "新网站",
    origin: values.origin || "",
    updatedAt: now
  };
  state.selectedSiteId = null;
  renderSiteList();
  renderSiteEditor();
  elements.siteName.select();
}

async function authorizeCurrentSite() {
  const site = selectedSite();
  if (!site || state.siteDraft) {
    return;
  }
  try {
    if (!await requestSitePermission(site)) {
      throw new Error("你拒绝了网站访问权限。");
    }
    await notifySiteRegistryChanged();
    await updateSitePermissionStatus(site);
    showSiteFeedback("网站已授权。", "success");
  } catch (error) {
    showSiteFeedback(error.message || "授权失败，请重试。", "error");
  }
}

async function deleteCurrentSite() {
  const site = selectedSite();
  if (!site || state.siteDraft) {
    return;
  }
  const references = state.profiles.filter((profile) => profile.sites.includes(site.id));
  if (references.length > 0) {
    showSiteFeedback(
      `该网站仍被以下配置引用：${references.map((profile) => profile.name).join("、")}。请先修改这些配置。`,
      "error"
    );
    return;
  }
  if (!confirm(`确定删除网站“${site.name}”吗？参考模板仍会保留。`)) {
    return;
  }
  await AgentProfileStore.deleteSite(site.id);
  state.sites = state.sites.filter((entry) => entry.id !== site.id);
  state.selectedSiteId = state.sites[0]?.id || null;
  await removeUnusedSitePermissions([site], state.sites);
  renderSiteList();
  renderSiteEditor();
  renderTemplates();
  renderList();
  renderEditor();
  await notifySiteRegistryChanged();
}

async function testCurrentSite() {
  clearSiteFeedback();
  try {
    const site = readSiteForm();
    if (!await requestSitePermission(site)) {
      throw new Error("测试前需要授予网站访问权限。");
    }
    const mode = getSiteEditorMode();
    if (mode === "code") {
      if (!site.code.trim()) {
        throw new Error("JS 代码不能为空。");
      }
      const response = await chrome.runtime.sendMessage({
        code: site.code,
        origin: site.origin,
        type: "TEST_SITE_CODE"
      });
      if (!response?.ok) {
        throw new Error(response?.message || "代码测试失败。");
      }
      showSiteFeedback(
        `platformRead() 返回：${response.text}`,
        "success"
      );
    } else {
      const response = await chrome.runtime.sendMessage({
        autoDetect: site.autoDetect,
        editorSelectors: site.editorSelectors,
        origin: site.origin,
        type: "TEST_SITE_SELECTORS"
      });
      if (!response?.ok) {
        const details = response?.results?.length
          ? ` ${response.results.map((result) => `${result.selector}：${result.matchCount} 个，${result.visibleCount} 个可见`).join("；")}`
          : "";
        throw new Error(`${response?.message || "测试失败。"}${details}`);
      }
      showSiteFeedback(
        `测试成功：${response.usedAutoDetect ? "自动识别规则" : "自定义选择器"} ${response.selector}，匹配 ${response.matchCount} 个元素，已高亮 ${response.element}。`,
        "success"
      );
    }
  } catch (error) {
    showSiteFeedback(error.message || "测试失败，请重试。", "error");
  }
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    elements.templateFeedback.textContent = successMessage;
    elements.templateFeedback.className = "feedback visible success";
  } catch (_error) {
    elements.templateFeedback.textContent = "复制失败，请手动选择文本。";
    elements.templateFeedback.className = "feedback visible error";
  }
}

function renderTemplates() {
  elements.templateList.replaceChildren();
  AgentSiteModel.DEFAULT_SITE_TEMPLATES.forEach((template) => {
    const card = document.createElement("article");
    card.className = "template-card";
    const title = document.createElement("h3");
    title.textContent = template.name;
    const origin = document.createElement("p");
    origin.className = "template-origin";
    origin.textContent = `${template.origin} · 自动识别：${template.autoDetect ? "开启" : "关闭"}`;
    const selectors = document.createElement("pre");
    selectors.className = "template-selectors";
    selectors.textContent = template.editorSelectors.join("\n");
    const actions = document.createElement("div");
    actions.className = "template-actions";
    const add = document.createElement("button");
    add.className = "button primary";
    add.type = "button";
    add.textContent = "添加此网站";
    add.disabled = state.sites.some((site) => site.origin === template.origin);
    add.addEventListener("click", () => createSiteDraft(template));
    const copyAsNew = document.createElement("button");
    copyAsNew.className = "button secondary";
    copyAsNew.type = "button";
    copyAsNew.textContent = "复制为新网站";
    copyAsNew.addEventListener("click", () => createSiteDraft({
      ...template,
      name: `${template.name} 副本`
    }));
    const copySelectors = document.createElement("button");
    copySelectors.className = "button secondary";
    copySelectors.type = "button";
    copySelectors.textContent = "复制选择器";
    copySelectors.addEventListener("click", () => copyText(
      template.editorSelectors.join("\n"),
      `已复制 ${template.name} 的选择器。`
    ));
    actions.append(add, copyAsNew, copySelectors);
    card.append(title, origin, selectors, actions);
    elements.templateList.append(card);
  });
}

async function initialize() {
  await AgentProfileStore.initialize();
  const [profiles, sites, commands] = await Promise.all([
    AgentProfileStore.getAllProfiles(),
    AgentProfileStore.getAllSites(),
    chrome.commands.getAll()
  ]);
  state.profiles = profiles;
  state.sites = sites;
  state.commandShortcuts = new Set(
    commands.map((command) => command.shortcut?.toLowerCase()).filter(Boolean)
  );
  state.selectedId = profiles[0]?.id || null;
  state.selectedSiteId = sites[0]?.id || null;
  renderList();
  renderEditor();
  renderSiteList();
  renderSiteEditor();
  renderTemplates();
}

elements.addText.addEventListener("click", addTextProfile);
elements.addFile.addEventListener("click", addFiles);
elements.fallbackFileInput.addEventListener("change", handleFallbackFiles);
elements.form.addEventListener("submit", saveCurrentProfile);
elements.deleteButton.addEventListener("click", deleteCurrentProfile);
elements.associateFile.addEventListener("click", associateFile);
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
  siteOptionInputs().forEach((input) => {
    input.disabled = elements.siteAll.checked;
    if (elements.siteAll.checked) {
      input.checked = false;
    }
  });
});
elements.exportButton.addEventListener("click", exportProfiles);
elements.importButton.addEventListener("click", () => elements.importInput.click());
elements.importInput.addEventListener("change", importProfiles);
elements.profilesTab.addEventListener("click", () => switchView("profiles"));
elements.sitesTab.addEventListener("click", () => switchView("sites"));
document.querySelectorAll("input[name='site-editor-mode']").forEach((radio) => {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      setSiteEditorMode(radio.value);
      elements.testSite.textContent = radio.value === "code" ? "测试代码" : "测试选择器";
    }
  });
});

elements.addSite.addEventListener("click", () => createSiteDraft());
elements.siteForm.addEventListener("submit", saveSite);
elements.authorizeSite.addEventListener("click", authorizeCurrentSite);
elements.deleteSite.addEventListener("click", deleteCurrentSite);
elements.testSite.addEventListener("click", testCurrentSite);
elements.copySite.addEventListener("click", () => {
  const site = selectedSite();
  if (site) {
    createSiteDraft({ ...site, name: `${site.name} 副本` });
  }
});

initialize().catch(() => {
  showFeedback("无法读取扩展配置，请重新加载扩展后重试。", "error");
});
