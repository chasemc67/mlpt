# Simulator voice testing

The test input is available only when both `DEBUG` and `targetEnvironment(simulator)` are true and the app launches with `MLPT_AUDIO_FIXTURES=1`. It is compiled out of physical-device and Release builds. Normal app launches use the microphone and Apple on-device speech.

The adapter reads actual 16 kHz mono WAV samples from a loopback service and writes them into the same native PCM recording path as microphone input. It sends the WAV bytes to a local `whisper.cpp` process, whose actual transcription enters the same transcript listener and command parser as Apple results. Expected phrases and target identities are never sent to recognition. The recording preserves real-time gaps with silence. Injected user speech is stored in trial WAVs; this adapter does not play that speech through the iPad speaker.

This checks audio decoding, response boundaries, correction, confirmation, command routing and saved recording data. It does **not** test Apple recognizer accuracy, microphone hardware, acoustic echo, VoiceOver or real user speech. The synthetic voice is a stock macOS voice, not a clone of a participant. Test sessions are labeled `VOICE-TEST` and flagged as synthetic in the export.

## Start the service

From the project directory:

```sh
brew install whisper-cpp ffmpeg
# Download ggml-base.en.bin using whisper.cpp's official model instructions:
# https://github.com/ggml-org/whisper.cpp/tree/master/models
python3 scripts/simulator-voice-server.py --model /absolute/path/ggml-base.en.bin
```

On the development Mac, the model is already at `../../work/voice/ggml-base.en.bin` relative to this project. The service binds to `127.0.0.1:9333` and does not upload audio. The bundled WAV clips can be regenerated with `python3 scripts/make-voice-fixtures.py` (macOS `say`, Daniel and Samantha voices, and FFmpeg).

## Launch the installed Debug app with the test input

```sh
xcrun simctl terminate 46FA778F-FD9C-4C26-A1EC-DCF7174F3406 org.mlpt.training
SIMCTL_CHILD_MLPT_AUDIO_FIXTURES=1 xcrun simctl launch \
  46FA778F-FD9C-4C26-A1EC-DCF7174F3406 org.mlpt.training
```

Use `xcrun simctl list devices booted` if the simulator ID changes. The home screen displays **Simulator test · synthetic audio · local Whisper**. Set the number of trials to **2** in Session setup, save, and return to the ready screen before running the complete scenario.

```sh
python3 scripts/simulator-voice.py --scenario two-trial --save-log /tmp/mlpt-voice-log.json
```

The sequence includes start, free exploration, repeat, finish trial, an answer, a negative phrase that must not confirm, correction, a replacement answer, yes, next trial, stop session, no, the second answer and completion. It waits for the matching app context before delivering each WAV. Verify **Session complete / 2 trials** in the UI and inspect the session export; the CLI reports audio delivery and recognition rather than asserting hidden UI state.

To test ending before confirmation, return to Ready and run:

```sh
python3 scripts/simulator-voice.py --scenario end-session
```

The UI should show **Session stopped / 0 trials completed**, and the unfinished trial must remain unscored.

For individual test inputs or a stalled queue:

```sh
python3 scripts/simulator-voice.py --clip start --context ready
python3 scripts/simulator-voice.py --clip square --context answering
python3 scripts/simulator-voice.py --clear
```

`--clear` only discards pending audio. It does not advance the UI or edit saved data. Run the command without arguments to inspect the listening context. A short Daniel “End session” clip was once recognized as just “session”; the app correctly ignored that ambiguous result. The scenarios use the separately recorded Samantha “Stop session” clip, while retaining the failed clip for regression testing.

To return to microphone input, terminate the app and launch it again without `SIMCTL_CHILD_MLPT_AUDIO_FIXTURES`. Apple recognition currently fails to initialize in this simulator, so use the physical iPad for that path.
