import test from "node:test";
import assert from "node:assert/strict";
import { voiceAction } from "../lib/voice";

test("voice commands are constrained to the current step", () => {
  assert.equal(voiceAction("ready", "Start session."), "start");
  assert.equal(voiceAction("exploring", "Finish trial!"), "finish");
  assert.equal(voiceAction("confirming", "Yes."), "confirm");
  assert.equal(voiceAction("confirming", "No, change."), "change");
  assert.equal(voiceAction("feedback", "Next trial."), "next");
  assert.equal(voiceAction("exploring", "Yes."), null);
  assert.equal(voiceAction("answering", "Yes."), null);
  assert.equal(voiceAction("confirming", "Next trial."), null);
});
test("free speech and negative phrases cannot confirm or end a trial", () => {
  for (const text of ["Not correct", "yes or no", "I think the next trial is a circle", "Do not finish trial", "I heard you say finish trial", "Yesterday was square"]) {
    assert.equal(voiceAction("exploring", text), null);
    assert.equal(voiceAction("confirming", text), null);
  }
  assert.equal(voiceAction("ending", "No."), "cancel");
  assert.equal(voiceAction("ending", "Yes."), "end");
});
