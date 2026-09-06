# Physical iPad acceptance checks

Status: **not yet run**. Record the iPad model, iPadOS version and build version for each run. These are product acceptance criteria, not a certification of WCAG conformance.

## Complete a session without visual navigation

- Launch with VoiceOver already enabled. All navigation items, fields, buttons and errors have understandable names and a logical focus order.
- Configure a two-trial session, permit microphone and speech access, then say “Start session” without touching a trial control.
- Hear that the trial started. The screen reader must not announce the hidden target.
- Check whether the target surface can collect the intended raw touch traces while VoiceOver is active. This is a blocking architecture decision; do not dismiss consumed gestures as a user error.
- Say “Finish trial,” give an answer, hear the readback, say “Change,” give a replacement answer and say “Yes.” The answer must remain unscored until confirmation.
- Hear the actual target after confirmation and advance explicitly. No countdown auto-advances the participant.
- Finish the session and save an export to Files.
- Check VoiceOver announcements alongside app prompts for overlapping speech, incorrect focus changes and accidental recognition of screen-reader output.
- Say “Repeat” and “Stop session”; verify “No” continues and “Yes” stops. Free speech and negative confirmation phrases must never accidentally confirm or advance.

## Input and visual accessibility

- Complete the same flow using an external keyboard, including Control + Enter.
- Exercise Switch Control with the intended external switch and scanning settings.
- Increase iPad Dynamic Type to accessibility sizes, then change it while the app is open. Text must grow without hiding controls.
- Test a minimum of 200% enlarged text; verify labels, errors, response confirmation and navigation reflow.
- Check portrait and landscape, reduced motion, VoiceOver screen curtain and high-contrast preferences.
- Test triple-tap only as an optional blindfolded gesture without VoiceOver, and verify ordinary tracing strokes do not accidentally finalize a trial.
- Confirm target rendering remains experimentally correct under screen curtain and any accessibility display options. Document invalid stimulus conditions.

## Audio and timing

- Verify audible prompts, cue tone, microphone recordings and response recognition on the actual iPad speakers/microphone.
- Check that the full trial recording includes exploration speech and the confirmed answer, without gaps when recognition starts.
- Confirm that final-answer capture starts only after its prompt. Command listening is active at the ready screen, during exploration, confirmation and feedback, and pauses while app prompts play. Irrelevant exploration guesses must not become the official answer.
- Wait silently and explore for several minutes, then issue a command. Confirm that listening remains available and that the app never hears its own prompts as participant input.
- Test denied permissions, empty recognition, corrections, recognition unavailable, long answers and silence.
- Test no internet with device speech selected. If English on-device recognition is unavailable, the app must explain that and must not silently send audio online.
- Test AI Gateway separately after a reachable authenticated voice service is configured. Verify only the final-answer segment leaves the device.
- Check that response-time measurement excludes gateway latency, and note actual tone/stimulus latency. The current timestamps are application/paint-boundary timestamps, not a calibrated hardware timing measurement.

## Recording integrity and device state

- Enable airplane mode after installing the app and complete a device-speech session from a cold start.
- Rotate or resize the app during exploration: interrupt and flag the trial; do not continue under mismatched geometry.
- Background, lock and force-quit the app during exploration, answer capture and confirmation. On return, retained data must be reviewable and unconfirmed trials must remain unscored.
- Change audio routes / unplug headphones. Verify interruption handling and that native files close and remain recoverable.
- Change brightness during the trial. Check interruption flags and restoration of the previous brightness.
- Verify auto-brightness, True Tone and Night Shift are off for controlled display conditions.
- Test a low-storage condition and failure to save audio/touches. Do not show a false success state.
- Open training in a second web tab; verify it cannot take over an active session.
- Run a realistic 10-trial session, then a longer session; monitor memory, thermal state, storage growth and recognition availability.

## Review and export

- Listen to every exported recording and verify order and duration.
- Compare touch overlays with an observed trace, including multiple fingers, movement outside the target and stylus pressure when available.
- Verify target location, actual bounds and all geometry in the same coordinate system.
- Open the CSV in Excel and Pandas/R; numeric coordinates and times must remain numeric, including negative coordinates.
- Ensure the ZIP includes every trial, relevant settings, flags, randomization metadata and events. The iPad share sheet must complete Save to Files.

If the touch/VoiceOver, navigation or audio checks fail, keep Capacitor provisional and implement the required native trial surface before participant use.
