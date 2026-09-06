# Architecture and the iPad decision

## Stack

| Concern | Initial implementation | Relationship to Social RV |
| --- | --- | --- |
| Web UI | Next.js 16 App Router, React 19, TypeScript | Next.js replaces Remix as requested |
| UI styling | Tailwind 3, shadcn-style Radix button, Lucide | Same underlying conventions and libraries |
| Validation | Zod | Shared approach |
| iPad packaging | Capacitor 8, locally bundled Next.js static export | Social RV also uses Capacitor; this app bundles its UI for local use |
| Local records | Dexie/IndexedDB | A temporary device-local repository until Supabase exists |
| Native device I/O | Swift Capacitor plugin | A single iOS audio engine, native speech and display controls |
| Optional online STT | Vercel AI Gateway, Grok STT | Reuses the mindsight demo's API contract |
| Cloud/auth | Not configured | Supabase Auth and Postgres are the intended next stage |

The current app stores data on the device. “Local DB” is implemented as IndexedDB rather than a local database server, which lets the static Next.js bundle run without a Next.js backend inside the iPad app. This choice should be reassessed for large research recordings. A native SQLite/filesystem adapter can sit under the same domain/repository boundary later.

## Capacitor: provisional, with a native audio adapter

Accessibility alone does not establish that a complete SwiftUI rewrite is necessary. Standard HTML controls can provide accessible navigation, while a Capacitor plugin handles device capabilities. But this particular app has a difficult requirement: VoiceOver exploration and raw finger tracing may compete for the same touch events. A physical-device test must resolve that before the architecture is accepted.

Proceed with this hybrid prototype. If VoiceOver cannot operate the trial reliably, or tracing samples are consumed by assistive technology, implement a native trial/canvas surface (or a fully native participant UI if warranted). Keep the web researcher/configuration UI and the shared data contract. Do not make participants disable assistive technology merely to claim the app is accessible.

The first decision gate is a complete session on Shaun's actual recent iPad: launch, configure, start, explore, answer, correct, confirm, hear feedback, continue and export. Include VoiceOver, external keyboard/switch control, larger text, interruptions and microphone routing. Test with a blind user as well as a sighted tester wearing a blindfold.

## Voice

The Social RV demo detects utterances throughout gameplay and can use model interpretation. MLPT's spec distinguishes continuous verbalization from the official final answer, so that behavior is intentionally adapted:

- Full trial audio is recorded locally.
- Context-specific voice commands cover start, finish trial, repeat, correction, confirmation, next and end session. Commands use whole utterances and never infer intent from incidental exploration words.
- Final-answer capture begins after the explicit response prompt finishes.
- Device recognition consumes the same native microphone buffers as the recorder.
- Gateway recognition sends a separately finalized answer segment, not arbitrary chunks of a longer recording and not the exploration audio.
- The user confirms the transcript before the official response is stored.
- Device/gateway selection is explicit and saved in the configuration. There is no silent provider fallback.

Hands-free iOS controls require on-device English recognition to be available. Buttons and typed answers remain available when recognition fails. Browser SpeechRecognition has limited support and may use an online provider. AI Gateway is optional and unverified against a live credential in this build; its answer segment currently ends with a button. A Debug-only Simulator audio adapter uses actual local Whisper transcription of synthetic WAVs for integration testing, with explicit test metadata. It does not validate Apple recognition or physical microphone behavior.

## Local data boundaries

`lib/model.ts` owns serializable domain types and deterministic scoring. `lib/db.ts` owns the current local repository. The participant page orchestrates state transitions. `lib/audio.ts` is the device/voice adapter; its native implementation is in the Xcode app. `lib/stimulus.ts` produces the same SVG geometry for presentation and reconstruction. `lib/export.ts` builds portable archives.

The current local schema includes:

- sessions keyed by UUID, participant study label, timestamps, status, mode, configuration snapshot and device information;
- trials keyed by UUID and session ID, including target/reference, state, response confirmation, CSPRNG draws, geometry, actual native brightness and quality flags;
- raw touch rows with stable IDs, timestamps, event type and unmodified coordinates;
- time-stamped audit events with a high-resolution ordering clock;
- audio/overlay blobs keyed by trial and sequence;
- last-used configuration, independent of previous session snapshots.

The target catalog currently contains four shapes, six colors, digits 0–9, letters A–F and six English words. The schema supports adding/versioning catalogs later. Standard Training Mode is the only implemented task/mode. Video, precognitive behavior, QRNG, protocol assignment and researcher roles are not simulated.

## Supabase migration path

1. Create the new Supabase project and introduce Auth. Keep identifying profile data separate from study IDs.
2. Map the stable session/trial UUIDs to Postgres tables and configuration/geometry/event details to versioned JSONB fields. Add study/project ownership and server-side access enforcement with RLS as appropriate.
3. Move large media to Supabase Storage with manifests, checksums and resumable transfer. Keep native/local files until server receipt has been verified.
4. Add an idempotent outbox with explicit sync states; reuse current record UUIDs for deduplication.
5. Provide an authenticated server-side AI Gateway endpoint. Never place the gateway key or Supabase service-role key in the client.
6. Build research protocols, assignments, video and longitudinal research views as Stage 2.

No hosted project or database has been created, and no Social RV data or secrets have been copied.

## References

- [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports)
- [Capacitor build and native workflow](https://capacitorjs.com/docs/basics/workflow)
- [Apple on-device recognition availability](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition)
- [Apple live speech audio buffers](https://developer.apple.com/documentation/speech/sfspeechaudiobufferrecognitionrequest)
- [MDN SpeechRecognition availability](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start)
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [Vercel audio capability announcement](https://vercel.com/changelog/realtime-voice-speech-and-transcription-now-supported-on-ai-gateway)

Local reference implementation inspected: Social RV's `app/services/mindsight/voice.server.ts`, `items.ts`, `Mindsight/useVoiceCapture.ts`, `Mindsight/gameAudio.ts`, `package.json` and Capacitor configuration. Product scope follows Stage 1 of the supplied MLPT Digital Platform Overview, with accounts deferred and iPad prioritized by the user.
