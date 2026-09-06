# Validation record

Updated: 5 September 2026.

## Simplified participant UI and real-audio simulator tests

The root route is now a participant ready screen, with one primary Start session button. Session setup and researcher data are separate. Trials use the mockups' dark target area, purple controls, a short instruction and the action needed for that step. Answer fields and detailed settings are collapsed until needed. Feedback reveals the target after confirmation, and completion uses a compact white summary.

Sixteen real synthetic WAV clips were generated with macOS voices. The Debug-only Simulator adapter feeds their PCM samples into the native recording path and sends those WAV bytes to a local Whisper recognizer. Actual recognition results drive the same command parser and transitions as the Apple speech listener. The app does not receive expected transcripts or target hints. The test service is absent from physical-device and Release builds; both Debug and Release simulator compilation passed.

The two-trial audio sequence ran without UI taps: Start session, unscored exploration speech, Repeat, Finish trial, Square, “That is not correct” (left unconfirmed), Change, Circle, Yes, Next trial, Stop session, No (continue), Finish trial, Triangle, Yes and Finish session. The actual random targets happened to be circle and triangle; the UI showed two confirmed trials and 100% exact matches. This is a workflow test, not participant performance data.

The native export was saved through Save to Files and passed ZIP CRC checks. Its audit log retained all 15 in-session voice inputs, three answer reviews, one correction and two explicit confirmations. The session identity and device metadata label it synthetic. The two exported WAVs contain nonzero 16 kHz mono PCM and span 50.944 and 38.336 seconds, including real-time gaps. Inspecting the export caught a trial-level synthetic flag being overwritten by a later state snapshot; the flag is now applied when the trial is first created.

A Daniel “End session” fixture was once recognized as only “session,” which correctly did not end the trial. The repeatable scenario uses a separately generated Samantha “Stop session” recording, while retaining the original failed clip. A preceding test used one UI tap to open end confirmation after that misrecognition; the subsequent two-trial run required no taps.

Browser home and compact setup were inspected. The in-app browser entered the recording flow, reported recognition unavailable, and successfully completed a trial through Finish trial → typed Circle → readback → Yes → feedback → End session → confirmation. The summary retained one confirmed answer. Native spoken prompts and answer readbacks ran in Simulator. Microphone/Apple-recognizer accuracy, acoustic echo, VoiceOver and physical touch behavior still require a real iPad.

After the metadata fix, another voice-driven confirmation and end-session test was exported. It passed ZIP checks and retained `simulator_audio_fixture` through confirmation, with response source `simulator-whisper` and a separate spoken end confirmation. A voice-only early-stop test showed zero completed trials and no score. The revised Done button returned to Ready and enabled native voice again.

The final native ready and trial layouts were also inspected in portrait; target, instruction, listening state and primary button fit on screen. The separate researcher overview was inspected in landscape using actual local data.

See [simulator voice testing](simulator-voice.md) to repeat the audio sequence.

## Xcode and simulator setup

Xcode 26.6 (17F113) first-launch components were installed through the Xcode UI. The earlier IDESimulatorFoundation/DVTDownloads failure is resolved. The iOS 26.5 simulator platform was downloaded and installed; unrelated watchOS installation was deselected.

The App scheme builds successfully for the iPad Pro 11-inch (M5), iPadOS 26.5 (23F77), using the iOS 26.5 SDK. A generic simulator build also succeeded for arm64 and x86_64 before the subsequent native fixes. The final arm64 simulator build succeeded and is installed. No signing team, signed IPA, TestFlight upload or physical-device run was needed or performed.

## Passed automated and build checks

- Next.js production static export and TypeScript compilation.
- Thirteen JavaScript tests: confirmation gating, unbiased randomization, target bounds, conservative response normalization, safe CSV cells, independent pointer overlays, configuration validation, database reopening/recovery, immutable snapshots, complete ZIP contents, Capacitor status-zero WAV responses, context-specific voice commands and negative/free-speech rejection.
- Native Swift recovery tests: complete files remain unchanged; interrupted mono and three-channel PCM headers recover; incomplete trailing frames are excluded; original data remain unchanged; invalid files are rejected.
- Capacitor synchronization and successful native compilation/linkage, including the custom audio plugin and WAV recovery helper.
- Prior HTTP checks for all five web pages; local voice health, origin rejection and missing-credential behavior.
- Dependency audit: zero known vulnerabilities at installation.

Run `npm test`, `npm run test:native`, `npm run typecheck`, `npm run build`, and `npx cap sync ios` to repeat the relevant local checks. Native tests require macOS and Xcode.

## Earlier simulator baseline (before the simplified UI)

- Cold launch and both portrait and landscape home layouts. The portrait audio-test button no longer collapses into the icon column.
- Configuration editing, keyboard form submission and persistence of a two-trial configuration through repeated app updates/restarts.
- Native microphone and speech authorization prompts, native bridge registration, trial recording start, cue/prompt calls and explicit trial progression.
- A complete two-trial session. Trial one changed from manually entered Circle to Square before confirmation and matched its square target. Trial two manually entered Triangle against a circle target and correctly did not match. The final screen showed two confirmed trials and 50% exact matches.
- Confirmed WAV recordings imported into IndexedDB without errors. The exported recordings contain 223.30 and 123.00 seconds of non-silent 48 kHz mono, 16-bit PCM. This establishes valid recorded data, not real-iPad microphone quality or calibrated timing.
- Native share sheet → Save to Files → On My iPad completed. The 33.3 MB ZIP passed CRC/integrity checks and contains JSON, both CSVs, two WAVs, two SVG overlays and export notes.
- Export assertions confirmed the two expected scores, three manual answer-review events, one correction event and 12 raw pointer samples. Continuous drag, multi-finger and stylus fidelity were not established by the computer-control input used here.
- Forced termination during an unconfirmed trial, followed by reinstallation and relaunch. The session recovered as interrupted, retained two raw pointer samples, and remained unconfirmed/unscored.
- The retained crash recording initially failed playback because its data chunk length was zero. After the fix, a separate recovered WAV plays with approximately 51 seconds of duration; the original file remains unchanged. The trial shows interrupted-before-confirmation and native-audio-header-recovered flags.
- Selecting Review brings the review panel into view and moves programmatic focus to its heading.

## Issues fixed during simulator testing

1. The generated SceneDelegate replaced the custom storyboard controller, leaving MLPTAudio unavailable. The scene now retains the custom controller and registers the plugin.
2. Delayed brightness setup notifications falsely interrupted the first trial. Preflight now allows the setting to settle and recording ignores notifications that do not change measured brightness. Simulator reports 0.5 brightness; the measured value is retained separately from the requested setting.
3. Capacitor serves WAV media with a non-HTTP response status of zero. Native import now accepts that response and checks the WAV header instead of reporting a false download error.
4. Stored absolute recording paths stopped resolving after an app-container UUID changed. The native adapter now resolves validated recording names inside the current container.
5. Interrupted WAV headers were unfinished. Recovery reconstructs complete PCM frame lengths in a separate protected copy and replaces older invalid cached media; recovery is explicitly flagged.
6. Speech-recognition errors now clear the Listening state and enter the audit log. Manual answer entry remains available.
7. Portrait audio-button layout and session-review focus were corrected.

## Remaining acceptance work

Apple reports on-device recognition support in this simulator, but starting recognition returns “Failed to initialize recognizer.” The Apple speech-to-text path remains unverified. The new simulator tests use actual local Whisper recognition, explicitly labeled as test input; no fake transcript or live AI Gateway response is substituted. Apple documents this initialization failure in its [speech task error reference](https://developer.apple.com/documentation/speech/sfspeechrecognitiontask/error).

Computer control did not expose the app web controls in the simulator accessibility tree. Accessibility Inspector produced no usable audit result, and its Dynamic Type adjustment did not produce a verified app text-size change. Keyboard shortcut and drag/scroll delivery through this simulator-control path were also inconclusive. These are unresolved checks, not accessibility passes or proof that the physical app fails. The original Inspector text-size setting was restored.

VoiceOver focus/announcements, raw touch exploration with VoiceOver enabled, Switch Control, Dynamic Type reflow, external keyboard operation, real speech accuracy, audio quality, brightness control, background/route interruptions, realistic storage limits and long sessions require the [physical iPad acceptance checklist](ipad-acceptance.md). Capacitor remains provisional until those checks pass. Formal WCAG conformance and scientific scoring/timing validation are not claimed.

The optional AI Gateway bridge still has no configured live credential. Existing Social RV credentials were not read or copied. No Supabase project, accounts, public service or deployment was created.
