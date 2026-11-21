import assert from "node:assert/strict";
import test from "node:test";
import { createCrazyGamesPlatform } from "../dist/index.js";

const records = new Map();
const persistence = {
  async get(key) { return records.get(key); },
  async set(key, value) { records.set(key, value); },
  async flush() {},
};

test("v3 enables host events after one initialization and emits each transition once", async () => {
  const events = [];
  let finishInitialization;
  const sdk = {
    init() {
      events.push("init");
      return new Promise((resolve) => {
        finishInitialization = resolve;
      });
    },
    get environment() {
      events.push("environment");
      return "local";
    },
    game: {
      record(event) { events.push(event); },
      loadingStart() { this.record("loadingStart"); },
      loadingStop() { this.record("loadingStop"); },
      gameplayStart() { this.record("gameplayStart"); },
      gameplayStop() { this.record("gameplayStop"); },
    },
  };
  const platform = createCrazyGamesPlatform({ persistence, getSdk: () => sdk });
  assert.equal(platform.persistence, persistence);
  const { lifecycle } = platform;
  const initialized = lifecycle.initialize();
  assert.equal(platform.capabilities().hostLoading, "unavailable");
  assert.equal(platform.capabilities().hostGameplay, "unavailable");
  lifecycle.setPlaying(true);
  const started = lifecycle.start();
  assert.deepEqual(events, ["init"]);
  finishInitialization();
  await Promise.all([initialized, started]);
  assert.equal(platform.capabilities().hostLoading, "available");
  assert.equal(platform.capabilities().hostGameplay, "available");

  lifecycle.loading({ phase: "finish" });
  lifecycle.loading({ phase: "start" });
  lifecycle.loading({ phase: "start" });
  lifecycle.loading({ phase: "progress", percent: 99 });
  lifecycle.loading({ phase: "finish" });
  lifecycle.loading({ phase: "finish" });
  for (const playing of [false, true, true, false, false, true]) {
    lifecycle.setPlaying(playing);
  }
  assert.deepEqual(events, [
    "init", "environment", "loadingStart", "loadingStop", "gameplayStart",
    "gameplayStop", "gameplayStart",
  ]);
});

test("Basic startup continues when SDK is missing, disabled, rejected or stalled", async () => {
  let resolveLate;
  let accessedDisabledGame = false;
  const disabled = {
    init: async () => {},
    environment: "disabled",
    get game() { accessedDisabledGame = true; },
  };
  const stalled = {
    init: () => new Promise((resolve) => { resolveLate = resolve; }),
    environment: "crazygames",
    game: { gameplayStart() {}, gameplayStop() {} },
  };
  for (const sdk of [
    undefined,
    disabled,
    { init: async () => { throw new Error("init rejected"); } },
    stalled,
  ]) {
    const platform = createCrazyGamesPlatform({
      persistence,
      getSdk: () => sdk,
      initTimeoutMs: 5,
    });
    await platform.lifecycle.start();
    if (sdk === stalled) {
      resolveLate();
      await Promise.resolve();
    }
    assert.equal(platform.capabilities().hostLoading, "unavailable");
    assert.equal(platform.capabilities().hostGameplay, "unavailable");
    await platform.persistence.set("crazygames.record", 42);
    assert.equal(await persistence.get("crazygames.record"), 42);
  }
  assert.equal(accessedDisabledGame, false);
});
