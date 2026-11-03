import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LiveHub,
  ScopeLimitError,
  SubscriberLimitError,
  type Scope,
  type ServerMessage,
  type Snapshot,
} from "./live-hub.js";

const global: Scope = { kind: "global", id: "" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (n: number): Snapshot => ({
  updatedAt: new Date().toISOString(),
  trains: [{ n }],
  dbConfigured: true,
});
const constant = (): Snapshot => ({
  updatedAt: "2026-01-01T00:00:00.000Z",
  trains: [{ n: 1 }],
  dbConfigured: true,
});

test("one poll per scope, shared by every subscriber", async () => {
  let calls = 0;
  const hub = new LiveHub({
    fetchSnapshot: async () => snap(++calls),
    intervalMs: 20,
    freshMs: 5,
    idleGraceMs: 20,
  });
  const a: ServerMessage[] = [];
  const b: ServerMessage[] = [];
  const unsubA = hub.subscribe(global, (m) => a.push(m));
  const unsubB = hub.subscribe(global, (m) => b.push(m));

  await sleep(75);
  unsubA();
  unsubB();
  hub.close();

  assert.equal(a.length, b.length);
  assert.ok(calls >= 2, `expected repeated polls, got ${calls}`);
  assert.ok(calls <= a.length, `polls (${calls}) should not exceed broadcasts (${a.length})`);
  const first = a[0];
  assert.ok(first);
  assert.ok(!first.heartbeat);
  assert.deepEqual(first.trains, [{ n: 1 }]);
});

test("sends heartbeat frames when the payload is unchanged", async () => {
  const hub = new LiveHub({
    fetchSnapshot: async () => constant(),
    intervalMs: 15,
    freshMs: 0,
    idleGraceMs: 10,
  });
  const seen: ServerMessage[] = [];
  const unsub = hub.subscribe(global, (m) => seen.push(m));
  await sleep(60);
  unsub();
  hub.close();

  assert.ok(seen.length >= 2, `expected several frames, got ${seen.length}`);
  assert.equal(seen[0]?.heartbeat, undefined);
  assert.ok(seen.slice(1).every((m) => m.heartbeat === true));
});

test("late joiner gets the cached snapshot immediately", async () => {
  const hub = new LiveHub({
    fetchSnapshot: async () => snap(1),
    intervalMs: 1_000,
    freshMs: 60_000,
    idleGraceMs: 10,
  });
  const unsubA = hub.subscribe(global, () => {});
  await sleep(15); // first poll completed, cache is fresh

  const late: ServerMessage[] = [];
  const unsubB = hub.subscribe(global, (m) => late.push(m));
  assert.equal(late.length, 1, "catch-up frame should be synchronous");
  const catchUp = late[0];
  assert.ok(catchUp);
  assert.ok(!catchUp.heartbeat);
  assert.deepEqual(catchUp.trains, [{ n: 1 }]);

  unsubA();
  unsubB();
  hub.close();
});

test("stops polling and drops the scope after the idle grace", async () => {
  let calls = 0;
  const hub = new LiveHub({
    fetchSnapshot: async () => snap(++calls),
    intervalMs: 15,
    idleGraceMs: 80,
  });
  const unsub = hub.subscribe(global, () => {});
  await sleep(40);
  unsub();
  await sleep(20); // let any in-flight tick settle

  assert.equal(hub.stats().scopes, 1, "scope survives during grace");
  const afterUnsub = calls;
  await sleep(100);
  assert.equal(hub.stats().scopes, 0, "scope is dropped after grace");
  assert.equal(calls, afterUnsub, "no polling without subscribers");
  hub.close();
});

test("different scopes poll independently", async () => {
  const seen: string[] = [];
  const hub = new LiveHub({
    fetchSnapshot: async (scope) => {
      seen.push(scope.id);
      return snap(1);
    },
    intervalMs: 15,
    freshMs: 0,
    idleGraceMs: 10,
  });
  const unsubA = hub.subscribe({ kind: "station", id: "S01700" }, () => {});
  const unsubB = hub.subscribe({ kind: "train", id: "9583" }, () => {});
  await sleep(40);
  unsubA();
  unsubB();
  hub.close();

  assert.ok(seen.includes("S01700"));
  assert.ok(seen.includes("9583"));
});

test("rejects new scopes and subscribers past the caps", () => {
  const noop = () => {};
  const scoped = new LiveHub({
    fetchSnapshot: async () => snap(1),
    intervalMs: 1_000,
    maxScopes: 1,
  });
  const unsubScope = scoped.subscribe(global, noop);
  assert.throws(
    () => scoped.subscribe({ kind: "station", id: "S01700" }, noop),
    ScopeLimitError,
  );
  unsubScope();
  scoped.close();

  const busy = new LiveHub({
    fetchSnapshot: async () => snap(1),
    intervalMs: 1_000,
    maxSubscribers: 1,
  });
  const unsub = busy.subscribe(global, noop);
  assert.throws(() => busy.subscribe(global, noop), SubscriberLimitError);
  unsub();
  busy.close();
});

test("a failing poll is logged and retried", async () => {
  let calls = 0;
  const errors: string[] = [];
  const hub = new LiveHub({
    fetchSnapshot: async () => {
      calls += 1;
      if (calls === 1) throw new Error("neon quota");
      return snap(calls);
    },
    intervalMs: 15,
    freshMs: 0,
    idleGraceMs: 10,
    log: (msg) => errors.push(msg),
  });
  const seen: ServerMessage[] = [];
  const unsub = hub.subscribe(global, (m) => seen.push(m));
  await sleep(60);
  unsub();
  hub.close();

  assert.ok(calls >= 2);
  assert.ok(seen.length >= 1, "recovered after the failed poll");
  assert.equal(errors.length, 1);
});

test("close() stops timers and clears subscribers", async () => {
  let calls = 0;
  const hub = new LiveHub({
    fetchSnapshot: async () => snap(++calls),
    intervalMs: 15,
    idleGraceMs: 10,
  });
  hub.subscribe(global, () => {});
  await sleep(30);
  hub.close();
  const after = calls;
  await sleep(50);

  assert.equal(hub.stats().scopes, 0);
  assert.equal(hub.stats().subscribers, 0);
  assert.equal(calls, after);
});
