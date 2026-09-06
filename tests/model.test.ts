import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  createTrial,
  confirmTrial,
  geometryFor,
  sampleIndex,
  canonicalResponse,
  csvCell,
  configSchema,
  type Session,
} from "../lib/model";
import { overlaySvg, targetMarkup } from "../lib/stimulus";
const session: Session = {
  id: "session",
  participantId: "P-001",
  mode: "training",
  task: "standard",
  status: "active",
  startedAt: new Date().toISOString(),
  config: DEFAULT_CONFIG,
  device: {},
};
test("confirmation is mandatory, exploration and drafts cannot be scored", () => {
  const trial = createTrial(session, 1);
  assert.equal(trial.response, undefined);
  assert.equal(trial.correct, undefined);
  assert.throws(() => confirmTrial(trial, trial.target), /reviewed/);
  const reviewed = {
    ...trial,
    phase: "confirming" as const,
    draft: trial.target,
    presentedAt: "2026-09-04T12:00:00Z",
    responseAt: "2026-09-04T12:00:08Z",
  };
  assert.throws(() => confirmTrial(reviewed, "  "), /required/);
  const result = confirmTrial(reviewed, trial.target);
  assert.equal(result.correct, true);
  assert.equal(result.phase, "feedback");
  assert.equal(result.responseTimeMs, 8000);
  assert.ok(result.confirmedAt);
  assert.throws(() => confirmTrial(result, trial.target), /reviewed/);
});
test("random selection rejects biased tail values and retains every draw", () => {
  const draws: number[] = [];
  const values = [4294967295, 17];
  assert.equal(
    sampleIndex(6, draws, () => values.shift()!),
    5,
  );
  assert.deepEqual(draws, [4294967295, 17]);
});
test("random targets stay within the permitted area at tablet sizes", () => {
  for (let i = 0; i < 150; i++) {
    const trial = createTrial(
      {
        ...session,
        config: {
          ...DEFAULT_CONFIG,
          position: "random",
          size: "random",
          area: "central",
        },
      },
      1,
    );
    const g = geometryFor(trial, 980, 660, 2, "landscape");
    assert.ok(g.x >= 196);
    assert.ok(g.y >= 132);
    assert.ok(g.x + g.targetWidth <= 784);
    assert.ok(g.y + g.targetHeight <= 528);
    assert.ok(trial.randomization.draws.length >= 4);
  }
});
test("spelled answers and numeric words normalize conservatively", () => {
  assert.equal(canonicalResponse("S Q U A R E."), "square");
  assert.equal(canonicalResponse("Seven"), "7");
  assert.equal(canonicalResponse("I think square"), "i think square");
});
test("CSV escapes separators, multiline text and formula injection", () => {
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell(-4.25), '"-4.25"');
  assert.equal(csvCell("a,b\nc"), '"a,b\nc"');
});
test("overlay preserves independent pointer paths without connecting between strokes", () => {
  const trial = createTrial(session, 1);
  trial.geometry = geometryFor(trial, 800, 600, 2, "landscape");
  const make = (
    pointerId: number,
    type: "DOWN" | "MOVE" | "UP",
    x: number,
    elapsedMs: number,
  ) => ({
    id: String(elapsedMs),
    trialId: trial.id,
    at: new Date().toISOString(),
    elapsedMs,
    type,
    x,
    y: 5,
    pointerId,
    pointerType: "touch",
    pressure: null,
    contactWidth: null,
    contactHeight: null,
  });
  const svg = overlaySvg(trial, [
    make(1, "DOWN", 2, 1),
    make(2, "DOWN", 8, 2),
    make(1, "UP", 4, 3),
    make(2, "UP", 10, 4),
  ]);
  assert.match(svg, /M 2 5 L 4 5/);
  assert.match(svg, /M 8 5 L 10 5/);
  assert.ok(svg.includes(targetMarkup(trial)));
});
test("invalid configuration is rejected before starting a session", () => {
  assert.equal(
    configSchema.safeParse({ ...DEFAULT_CONFIG, trials: -1 }).success,
    false,
  );
  assert.equal(
    configSchema.safeParse({ ...DEFAULT_CONFIG, participantId: "../../foo" })
      .success,
    false,
  );
  assert.equal(
    configSchema.safeParse({ ...DEFAULT_CONFIG, trials: 0 }).success,
    true,
  );
});
