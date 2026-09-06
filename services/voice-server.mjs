// Local, optional AI Gateway bridge. Never bundle this module or its key in the iPad app.
// REST contract follows Social RV's app/services/mindsight/voice.server.ts.
import { createServer } from "node:http";
const port = Number(process.env.VOICE_PORT || 3001);
const origins = new Set(
  (
    process.env.VOICE_ALLOWED_ORIGINS ||
    "http://localhost:3000,http://127.0.0.1:3000,capacitor://localhost"
  ).split(","),
);
const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
let inflight = 0;
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!origin || !origins.has(origin)) {
    res.writeHead(403);
    res.end("Origin is not allowed");
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === "/health" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        configured: Boolean(key),
        transcriptionModel: "xai/grok-stt",
      }),
    );
    return;
  }
  if (req.method !== "POST" || !["/transcribe", "/speech"].includes(req.url)) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (!key) {
    res.writeHead(503);
    res.end("Configure AI_GATEWAY_API_KEY on the voice server.");
    return;
  }
  if (inflight >= 2) {
    res.writeHead(429);
    res.end("Voice service is busy. Try again.");
    return;
  }
  inflight++;
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 12 * 1024 * 1024) {
        res.writeHead(413);
        res.end("Audio clip is too large.");
        return;
      }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const stt = req.url === "/transcribe";
    if (
      stt &&
      (!(typeof body.audio === "string") ||
        !/^audio\/(webm|mp4|wav|x-wav|ogg|aac|caf|x-caf)(;.*)?$/.test(
          body.mediaType,
        ) ||
        !body.audio.length ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.audio))
    ) {
      res.writeHead(400);
      res.end("A supported audio clip is required.");
      return;
    }
    if (
      !stt &&
      (typeof body.text !== "string" ||
        !body.text.trim() ||
        body.text.length > 500)
    ) {
      res.writeHead(400);
      res.end("Speech text must contain 1 to 500 characters.");
      return;
    }
    const upstream = await fetch(
      `https://ai-gateway.vercel.sh/v4/ai/${stt ? "transcription" : "speech"}-model`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${key}`,
          "ai-model-id": stt ? "xai/grok-stt" : "openai/tts-1",
          "ai-gateway-protocol-version": "0.0.1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          stt
            ? {
                audio: body.audio,
                mediaType: body.mediaType,
                providerOptions: { xai: { language: "en" } },
              }
            : { text: body.text, voice: "alloy", outputFormat: "mp3" },
        ),
      },
    );
    if (!upstream.ok) {
      res.writeHead(502);
      res.end(`Voice provider returned ${upstream.status}. Please retry.`);
      return;
    }
    const result = await upstream.json();
    if (stt) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text: typeof result.text === "string" ? result.text.trim() : "",
        }),
      );
    } else {
      if (!result.audio) throw new Error("No audio returned");
      res.setHeader("Content-Type", "audio/mpeg");
      res.end(Buffer.from(result.audio, "base64"));
    }
  } catch (e) {
    if (!res.headersSent) res.writeHead(e instanceof SyntaxError ? 400 : 502);
    res.end("Voice processing failed. Your local recording is retained.");
  } finally {
    inflight--;
  }
});
// Deliberately loopback-only while the product has no authentication.
server.listen(port, "127.0.0.1", () =>
  console.log(
    `MLPT voice bridge: http://127.0.0.1:${port} (${key ? "configured" : "no gateway credential"})`,
  ),
);
