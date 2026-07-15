(function attachInstructionUtilities(global) {
  "use strict";

  const START_MARKER = "<<<请你严格遵循一下规范-开始>>>";
  const END_MARKER = "<<<请你严格遵循一下规范-结束>>>";

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

  const api = Object.freeze({
    END_MARKER,
    START_MARKER,
    buildInstructionBlock,
    mergeInstructionBlock
  });

  global.AgentInstructions = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
