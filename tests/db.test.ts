import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  db,
  saveTrial,
  recoverInterruptedSessions,
  getSessionData,
  saveConfig,
  getConfig,
} from "../lib/db";
import {
  DEFAULT_CONFIG,
  createTrial,
  confirmTrial,
  type Session,
} from "../lib/model";
test("incremental writes survive reopening and unconfirmed trials recover without scores", async () => {
  await db.delete();
  await db.open();
  const session: Session = {
    id: "durable-session",
    participantId: "P-001",
    status: "active",
    mode: "training",
    task: "standard",
    startedAt: new Date().toISOString(),
    config: structuredClone(DEFAULT_CONFIG),
    device: {},
  };
  await db.sessions.add(session);
  const draft = createTrial(session, 1);
  draft.phase = "confirming";
  draft.draft = "triangle";
  await saveTrial(draft, "response_review_requested");
  await db.media.add({
    id: "chunk",
    trialId: draft.id,
    sequence: 0,
    at: new Date().toISOString(),
    kind: "audio",
    blob: new Blob(["recording"], { type: "audio/webm" }),
  });
  await db.touches.add({
    id: "touch",
    trialId: draft.id,
    at: new Date().toISOString(),
    elapsedMs: 12.125,
    type: "DOWN",
    x: 13.37,
    y: 29.88,
    pointerId: 1,
    pointerType: "touch",
    pressure: null,
    contactWidth: 4,
    contactHeight: 4,
  });
  db.close();
  await db.open();
  await recoverInterruptedSessions();
  const data = await getSessionData(session.id);
  assert.equal(data.session.status, "interrupted");
  assert.equal(data.trials[0].phase, "interrupted");
  assert.equal(data.trials[0].draft, "triangle");
  assert.equal(data.trials[0].response, undefined);
  assert.equal(data.trials[0].correct, undefined);
  assert.equal(data.touches[0].x, 13.37);
  assert.equal(data.media[0].blob.size, 9);
  assert.ok(
    data.events.some((e) => e.event === "session_recovered_as_interrupted"),
  );
  await db.delete();
});
test("confirmed answers survive recovery and last-used config does not mutate snapshots", async () => {
  await db.open();
  const config = structuredClone(DEFAULT_CONFIG);
  const s: Session = {
    id: "s2",
    participantId: "P-001",
    status: "active",
    mode: "training",
    task: "standard",
    startedAt: new Date().toISOString(),
    config,
    device: {},
  };
  await db.sessions.add(s);
  const t = createTrial(s, 1);
  t.phase = "confirming";
  await saveTrial(confirmTrial(t, t.target), "response_confirmed");
  await saveConfig({ ...config, trials: 20 });
  await recoverInterruptedSessions();
  assert.equal((await getConfig()).trials, 20);
  const data = await getSessionData(s.id);
  assert.equal(data.session.config.trials, 10);
  assert.equal(data.trials[0].phase, "feedback");
  assert.equal(data.trials[0].correct, true);
  await db.delete();
});
