import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { createSessionArchive } from "../lib/export";
import {
  DEFAULT_CONFIG,
  createTrial,
  geometryFor,
  type Session,
} from "../lib/model";
test("export contains ordered recordings, complete metadata, raw CSV and a reconstructable overlay", async () => {
  const session: Session = {
    id: "export-session",
    participantId: "P-001",
    mode: "training",
    task: "standard",
    status: "interrupted",
    startedAt: new Date().toISOString(),
    config: DEFAULT_CONFIG,
    device: { platform: "test" },
  };
  const trial = createTrial(session, 1);
  trial.geometry = geometryFor(trial, 800, 600, 2, "landscape");
  const zip = await createSessionArchive({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    session,
    trials: [trial],
    touches: [],
    events: [],
    media: [
      {
        id: "second",
        trialId: trial.id,
        sequence: 1,
        kind: "audio",
        at: new Date().toISOString(),
        blob: new Blob(["second"], { type: "audio/wav" }),
      },
      {
        id: "first",
        trialId: trial.id,
        sequence: 0,
        kind: "audio",
        at: new Date().toISOString(),
        blob: new Blob(["first"], { type: "audio/wav" }),
      },
    ],
  });
  const reopened = await JSZip.loadAsync(
    await zip.generateAsync({ type: "uint8array" }),
  );
  assert.equal(
    await reopened.file("audio/trial-1.wav")!.async("string"),
    "firstsecond",
  );
  const metadata = JSON.parse(
    await reopened.file("session.json")!.async("string"),
  );
  assert.equal(metadata.session.config.trials, 10);
  assert.equal(metadata.media[0].mimeType, "audio/wav");
  assert.equal(metadata.trials[0].response, undefined);
  assert.match(
    await reopened.file("trials.csv")!.async("string"),
    /randomization/,
  );
  assert.match(
    await reopened.file("overlays/trial-1.svg")!.async("string"),
    /viewBox="0 0 800 600"/,
  );
});
