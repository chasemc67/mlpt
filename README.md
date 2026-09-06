# MLPT

Stage 1 of the Minimal Light Perception Training platform. The project is a local training implementation and an iPad Capacitor app, based on the supplied MLPT overview and the Social RV stack. It has no accounts and does not connect to Supabase.

**Current verification:** The simplified participant UI builds and runs on an iPad Pro 11-inch (M5) simulator with iPadOS 26.5 and Xcode 26.6. Real synthetic WAV clips exercise the voice flow through a Debug-only audio adapter and actual local Whisper recognition. Thirteen JavaScript tests and native Swift WAV-recovery checks pass. Apple's recognizer fails to initialize in this simulator, so Apple speech accuracy, physical microphone behavior, VoiceOver, Switch Control and Dynamic Type remain physical-iPad acceptance work. See [validation notes](docs/validation.md).

## Run locally

Use Node 22 or newer, ideally the current LTS release.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The initial configuration uses 10 shape trials and study ID `P-001`. Configuration, sessions, raw touches, event logs and audio are stored in a real IndexedDB database through Dexie. The browser database and iPad app database are separate. No database service, credentials or account is required.

Use a browser supporting microphone recording for the browser trial flow. Voice commands also require browser speech recognition; buttons and typed answers remain available when recognition is unavailable. Browsers may require an initial tap to allow audio. The intended participant device is a recent iPad.

The web production build is deliberately a static Next.js export so the same interface can be bundled into Capacitor without a running Next.js server:

```sh
npm run build
npm start
```

Webpack is used for production builds because Turbopack's CSS worker IPC is blocked in this managed development environment.

## iPad project

```sh
npm run cap:sync
npm run cap:ios
```

Choose your Apple signing team in Xcode and run the `App` target on an iPad. The bundle ID is the development placeholder `org.mlpt.training`; change it before distribution. The project targets iPad and iOS 17+, with the current iPadOS version intended for acceptance testing. The web files are bundled locally; the app does not load a remotely hosted website.

For local simulator testing, choose **App → iPad Pro 11-inch (M5), iOS 26.5** in Xcode and Run. Simulator builds do not require a signing team. The simulator already has a two-trial test configuration and retained test sessions; a fresh installation defaults to ten trials. If speech recognition fails to initialize, use the final-answer field and confirm the manually entered answer.

`MLPTAudioPlugin.swift` is a local native adapter for:

- a single microphone engine that writes continuous trial audio as WAV files;
- a separate final-answer audio segment, captured only after the response prompt;
- Apple on-device English speech recognition, without silent online fallback;
- native spoken prompts and a trial-start tone;
- applying, measuring and restoring screen brightness;
- interruption events for backgrounding, microphone route changes and brightness changes;
- native export sharing and Dynamic Type scaling.

Raw audio is written into the iOS application-support directory with iOS file protection. Finalized recordings are also imported into the local database. Original native recordings are retained. Interrupted PCM WAVs with unfinished headers are recovered into separate `.recovered.wav` files; the original samples are preserved and incomplete trailing frames are excluded from the recovered copy. Storage paths are resolved inside the current app container after updates. There is no cloud backup or app-level encrypted research repository in this version.

Do not use this build for Shaun's unattended training until the [iPad acceptance checks](docs/ipad-acceptance.md) have passed. A successful web build does not establish VoiceOver accessibility or native audio reliability.

## Training flow

1. A facilitator can adjust the saved setup separately. The participant starts on a simple ready screen.
2. After initial microphone/speech permissions, say **Start session**. The iPad app enables voice automatically; a browser can require **Enable voice controls** first.
3. Explore the target and speak freely. Raw touches and audio are recorded, but exploration speech is never scored.
4. Say **Finish trial**, then state or spell the final answer after the prompt.
5. Hear the recognized answer read back. Say **Yes** to confirm or **Change** to answer again. Only confirmation stores and scores the official response.
6. Hear the actual target, then say **Next trial** or **Finish session** when ready.
7. Say **Repeat** for the current instruction. **End session** or **Stop session** asks for a separate yes/no confirmation.

The same steps have large touch buttons. **Type an answer** opens the manual field; speech failure exposes that fallback and a **Retry voice** control. Control + Enter activates the primary trial action. Commands match whole utterances in the current step; phrases such as “That is not correct” never count as “correct.” The recognizer is suspended while app prompts play. With the optional Gateway answer provider, **Use this answer** currently ends the recorded answer segment; automatic answer completion uses device speech.

Participant screens follow the supplied mockups: a dark target screen, purple primary controls, and compact white setup and summary screens. Detailed settings stay under **More settings**. `/research/` provides a separate local researcher overview and session review workspace. Standard HTML controls, visible keyboard focus, skip links and reduced-motion handling are included. During the task, stimulus SVGs are intentionally excluded from the accessibility tree so the screen reader does not reveal the answer. The stimulus becomes a named target after confirmation.

## Repeatable simulator audio tests

See [simulator voice testing](docs/simulator-voice.md) for the full commands. The repository includes 16 synthetic WAV clips and scripts to regenerate them, launch a local Whisper service and queue complete voice sessions. Audio samples enter the native recorder and actual recognized text drives the participant state machine; no canned transcript or expected target is supplied to recognition. Simulator test sessions are labeled `VOICE-TEST`, with `synthetic-audio-fixtures` device metadata and a trial quality flag.

VoiceOver may consume the same touches needed for raw tracing. A screen-reader user's ability to trace the stimulus area must be verified on the actual iPad; see the architecture decision below. A native tracing surface may be needed even if the surrounding UI remains in Capacitor.

## Optional Vercel AI Gateway voice

The gateway adapter follows Social RV's mindsight demo: the v4 transcription endpoint with `xai/grok-stt`, and a speech endpoint with `openai/tts-1`. The participant interface uses the transcription endpoint when **Vercel AI Gateway** is selected; guidance remains native on iPad and browser TTS on the web for immediate prompts. The server's speech endpoint is available for later voice parity with the demo.

```sh
cp .env.example .env.local
# Set AI_GATEWAY_API_KEY in .env.local on the server only.
npm run voice:dev
# In a second terminal:
npm run dev
```

Select Vercel AI Gateway in Configuration. Only the final-answer segment is submitted for transcription, and the transcript must still be confirmed by the participant. No LLM judges, infers or silently changes the answer. The existing Social RV credentials have not been read or copied, and no live gateway request was made during development.

The local voice bridge binds only to `127.0.0.1:3001` while there are no accounts. On an iPad, `127.0.0.1` means the iPad itself. To use the gateway from iPad later, provide an authenticated HTTPS voice service reachable by the iPad, set `NEXT_PUBLIC_VOICE_URL`, and rebuild/sync the app. Do not expose the unauthenticated local bridge on the public internet. Device speech is the default and needs no gateway service.

## Reviewing and exporting data

Open Session history, choose Review, then Export session. On iPad this opens the native share sheet (including Save to Files); the web downloads a ZIP.

The ZIP includes:

- `session.json`: session/configuration snapshots, trial records, randomization draws, geometry, device metadata, media metadata and ordered events;
- `trials.csv`: Excel-compatible UTF-8 CSV, including configuration, randomization and quality flags;
- `touches.csv`: unsmoothed, unrounded raw touch samples, with pointer IDs and timestamps;
- `audio/`: recordings concatenated in their original chunk order;
- `overlays/`: SVG images reproducing targets with thin cyan touch trajectories.

SVGs are standalone image files, not screenshots. Geometry uses CSS pixels relative to the experimental area, with top-left origin; actual rendered fill bounds, viewport dimensions, screen pixel ratio, orientation, scale dimensions, colors and stroke width are recorded. Pressure/contact dimensions are nullable when reliable measurements are unavailable.

Scoring is a conservative exact match after case/punctuation normalization, spelled single letters, and zero–nine number-word mapping. Both the actual response and the scoring result are retained. This is a provisional training score, not a validated measure of perceptual ability or trajectory accuracy.

## Data and recovery

Browser audio is saved in approximately one-second chunks, touch samples in roughly 250 ms batches, and trial state at each transition. The native recorder writes audio continuously to disk. A crash may lose the latest unsaved touch batch, audio buffer, or file header update; interrupted trials are flagged and are never automatically confirmed.

Entering Training acquires a single-tab Web Lock, recovers any previous active session as interrupted, and attempts to recover its native audio. An interrupted session is retained; subsequent practice starts a new session. IndexedDB availability is required. Clearing site data or uninstalling the app can remove local sessions. Export before doing so.

No server synchronization is presented as available. Full resumable upload, checksums, account separation, protocol locking, video and research modes belong to later stages.

## Development

```sh
npm test
npm run test:native # macOS with Xcode
npm run typecheck
npm run build
npm run cap:sync
```

The tests cover rejection-sampled randomization, allowed target area, confirmation gating, interrupted-session persistence, immutable settings snapshots, raw multi-pointer overlays, CSV escaping, and complete archive contents. The `xcode` helper's development-only UUID dependency is overridden to a compatible patched v11 release; Capacitor uses its unchanged `v4()` API.

- [Architecture and Capacitor decision](docs/architecture.md)
- [Physical iPad acceptance checklist](docs/ipad-acceptance.md)
- [Validation results and limitations](docs/validation.md)

An open-source license and the final app identity should be selected before publishing. No license terms have been invented for the project.
