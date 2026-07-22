(function attachInstructionUtilities(global) {
  "use strict";

  const START_MARKER = "<<<请你严格遵循一下规范-开始>>>";
  const END_MARKER = "<<<请你严格遵循一下规范-结束>>>";
  const PROFILE_MARKER_PREFIX = "AGENT_PROMPT_WEBCHAT_LOADER";

  function normalizeContent(content) {
    return String(content || "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  }

  function buildInstructionBlock(sources) {
    const sections = sources
      .map((source) => ({ ...source, content: normalizeContent(source.content) }))
      .filter((source) => source.content.length > 0)
      .map((source) => {
        const scopeLabel = source.scope === "global"
          ? "全局 AGENTS.md"
          : `网站 AGENTS.md · ${source.origin}`;
        return `[${scopeLabel} · ${source.name}]\n${source.content}`;
      });

    if (sections.length === 0) {
      return "";
    }

    return [START_MARKER, ...sections, END_MARKER].join("\n\n");
  }

  function mergeInstructionBlock(existingText, newBlock) {
    const existing = String(existingText || "");
    if (!newBlock) {
      return existing;
    }

    const startIndex = existing.indexOf(START_MARKER);
    const endIndex = startIndex >= 0
      ? existing.indexOf(END_MARKER, startIndex + START_MARKER.length)
      : -1;

    if (startIndex >= 0 && endIndex >= 0) {
      const blockEnd = endIndex + END_MARKER.length;
      const before = existing.slice(0, startIndex);
      let after = existing.slice(blockEnd);

      if (before.length === 0) {
        after = after.replace(/^(?:\r?\n){1,2}/, "");
        return after ? `${newBlock}\n\n${after}` : newBlock;
      }

      return `${before}${newBlock}${after}`;
    }

    return existing ? `${newBlock}\n\n${existing}` : newBlock;
  }

  function getProfileMarkers(id) {
    return {
      end: `<<<请你严格遵循给定的规范:END>>>`,
      start: `<<<请你严格遵循给定的规范:START>>>`
    };
  }

  function buildProfileBlock(profile) {
    const content = normalizeContent(profile.content);
    if (!content) {
      return "";
    }
    const markers = getProfileMarkers(profile.id);
    return [
      markers.start,
      `[AGENTS 配置 · ${profile.name}]`,
      content,
      markers.end
    ].join("\n");
  }

  function removeMarkedBlock(text, startMarker, endMarker) {
    const existing = String(text || "");
    const startIndex = existing.indexOf(startMarker);
    const endIndex = startIndex >= 0
      ? existing.indexOf(endMarker, startIndex + startMarker.length)
      : -1;
    if (startIndex < 0 || endIndex < 0) {
      return existing;
    }

    const before = existing.slice(0, startIndex);
    const after = existing.slice(endIndex + endMarker.length);
    if (!before) {
      return after.replace(/^(?:\r?\n){1,2}/, "");
    }
    if (!after) {
      return before.replace(/(?:\r?\n){1,2}$/, "");
    }
    return [
      before.replace(/(?:\r?\n){1,2}$/, ""),
      after.replace(/^(?:\r?\n){1,2}/, "")
    ].join("\n\n");
  }

  function removeLegacyBlock(text) {
    return removeMarkedBlock(text, START_MARKER, END_MARKER);
  }

  function mergeProfileBlocks(existingText, profiles) {
    let remaining = removeLegacyBlock(existingText);
    const blocks = profiles
      .map((profile) => ({
        block: buildProfileBlock(profile),
        id: profile.id,
        placement: profile.placement
      }))
      .filter((entry) => entry.block);

    blocks.forEach((entry) => {
      const markers = getProfileMarkers(entry.id);
      remaining = removeMarkedBlock(remaining, markers.start, markers.end);
    });

    const prepended = blocks
      .filter((entry) => entry.placement === "prepend")
      .map((entry) => entry.block);
    const appended = blocks
      .filter((entry) => entry.placement === "append")
      .map((entry) => entry.block);
    return [...prepended, remaining, ...appended]
      .filter((part) => part !== "")
      .join("\n\n");
  }

  const api = Object.freeze({
    END_MARKER,
    START_MARKER,
    buildProfileBlock,
    buildInstructionBlock,
    mergeProfileBlocks,
    mergeInstructionBlock
  });

  global.AgentInstructions = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
