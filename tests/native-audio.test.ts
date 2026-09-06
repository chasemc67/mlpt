import assert from "node:assert/strict";
import test from "node:test";
import { nativeFile } from "../lib/audio";

test("native media accepts Capacitor's status-zero WAV response, but rejects invalid data", async () => {
  const originalFetch = globalThis.fetch;
  const wav = new Uint8Array(48);
  wav.set(new TextEncoder().encode("RIFF"), 0);
  wav.set(new TextEncoder().encode("WAVE"), 8);
  try {
    globalThis.fetch = async () => ({
      ok: false, status: 0, arrayBuffer: async () => wav.buffer,
    }) as Response;
    const blob = await nativeFile("/recording.wav");
    assert.equal(blob.type, "audio/wav");
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), wav);

    globalThis.fetch = async () => new Response("<html>Missing file</html>");
    await assert.rejects(nativeFile("/missing.wav"), /not a readable WAV/);
    globalThis.fetch = async () => new Response("Not found", { status: 404 });
    await assert.rejects(nativeFile("/missing.wav"), /Unable to read/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
