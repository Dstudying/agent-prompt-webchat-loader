"use strict";

const assert = require("node:assert/strict");

const storedValues = {};
const storageWrites = [];

global.chrome = {
  storage: {
    local: {
      async set(values) {
        Object.assign(storedValues, values);
        storageWrites.push(JSON.parse(JSON.stringify(values)));
      }
    }
  }
};

require("../lib/profile-store.js");

const shortcut = {
  altKey: false,
  code: "Digit1",
  ctrlKey: true,
  metaKey: false,
  shiftKey: true
};
const profile = {
  enabled: true,
  id: "11111111-1111-4111-8111-111111111111",
  shortcut,
  sites: ["*"]
};
const sites = [{
  id: "10000000-0000-4000-8000-000000000001",
  origin: "https://chat.deepseek.com"
}];

async function runTests() {
  await AgentProfileStore.syncShortcutIndex([profile], sites);
  const firstWrite = storageWrites.at(-1);
  const firstRevision = firstWrite[AgentProfileStore.SHORTCUT_INDEX_REVISION_KEY];

  assert.equal(typeof firstRevision, "string");
  assert.ok(firstRevision.length > 0);
  assert.deepEqual(firstWrite[AgentProfileStore.SHORTCUT_INDEX_KEY], [{
    id: profile.id,
    revision: firstRevision,
    shortcut,
    sites: ["https://chat.deepseek.com"]
  }]);

  await AgentProfileStore.syncShortcutIndex([profile], sites);
  const secondWrite = storageWrites.at(-1);
  const secondRevision = secondWrite[AgentProfileStore.SHORTCUT_INDEX_REVISION_KEY];

  assert.notEqual(secondRevision, firstRevision);
  assert.equal(
    secondWrite[AgentProfileStore.SHORTCUT_INDEX_KEY][0].revision,
    secondRevision
  );

  await AgentProfileStore.syncShortcutIndex([{ ...profile, enabled: false }], sites);
  const disabledWrite = storageWrites.at(-1);
  assert.deepEqual(disabledWrite[AgentProfileStore.SHORTCUT_INDEX_KEY], []);
  assert.equal(
    storedValues[AgentProfileStore.SHORTCUT_INDEX_REVISION_KEY],
    disabledWrite[AgentProfileStore.SHORTCUT_INDEX_REVISION_KEY]
  );

  await AgentProfileStore.syncShortcutIndex([{
    ...profile,
    sites: [sites[0].id]
  }], sites);
  assert.deepEqual(storageWrites.at(-1)[AgentProfileStore.SHORTCUT_INDEX_KEY][0].sites, [
    "https://chat.deepseek.com"
  ]);
}

runTests()
  .then(() => console.log("profile-store tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
