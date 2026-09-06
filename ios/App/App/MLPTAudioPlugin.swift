import Foundation
import UIKit
import AVFoundation
import Speech
import Capacitor

/// One capture engine writes the full trial and, only after the prompt, the response segment.
/// Device recognition is explicitly on-device; unsupported devices never silently upload audio.
@objc(MLPTAudioPlugin)
public class MLPTAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "MLPTAudioPlugin"
    public let jsName = "MLPTAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "accessibilitySettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordingPath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTrial", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginAnswer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAnswer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTrial", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]
    private var engine: AVAudioEngine?
    private var captureFormat: AVAudioFormat?
    #if DEBUG && targetEnvironment(simulator)
    private var fixtureClock: Timer?
    private var fixtureSamples: [Float] = []
    private var fixtureCursor = 0
    #endif
    private var fixtureInput: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.environment["MLPT_AUDIO_FIXTURES"] == "1"
        #else
        return false
        #endif
    }
    private let fileLock = NSLock()
    private var fullFile: AVAudioFile?
    private var answerFile: AVAudioFile?
    private var fullURL: URL?
    private var answerURL: URL?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var transcript = ""
    private var recognitionGeneration = 0
    private var previousBrightness: CGFloat?
    private var captureBrightness: CGFloat?
    private let synthesizer = AVSpeechSynthesizer()
    private var speechCalls: [ObjectIdentifier: CAPPluginCall] = [:]
    private var tonePlayer: AVAudioPlayer?
    private var observers: [NSObjectProtocol] = []
    private var captureErrorSent = false
    private var deviceRecognitionReady = false

    public override func load() {
        synthesizer.delegate = self
        observers.append(NotificationCenter.default.addObserver(forName: UIContentSizeCategory.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("accessibilityChanged", data: ["textScale": Double(UIFont.preferredFont(forTextStyle: .body).pointSize / 17), "voiceOver": UIAccessibility.isVoiceOverRunning])
        })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  type == AVAudioSession.InterruptionType.began.rawValue else { return }
            self?.interrupt("The iPad audio session was interrupted.")
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.interrupt("The app entered the background.")
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIScreen.brightnessDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self, let brightness = self.captureBrightness,
                  abs(UIScreen.main.brightness - brightness) > 0.005 else { return }
            self.interrupt("Screen brightness changed during the trial.")
        })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            guard let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
            self?.interrupt("The microphone or audio route changed.")
        })
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    @objc func accessibilitySettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["textScale": Double(UIFont.preferredFont(forTextStyle: .body).pointSize / 17), "voiceOver": UIAccessibility.isVoiceOverRunning])
        }
    }
    @objc func prepare(_ call: CAPPluginCall) {
        let permissionResult: (Bool) -> Void = { [weak self] granted in
            guard let self = self else { return }
            guard granted else { call.reject("Microphone permission is required for training."); return }
            let needsRecognition = (call.getBool("recognition") ?? true) && !self.fixtureInput
            self.deviceRecognitionReady = false
            let finish: () -> Void = {
                DispatchQueue.main.async {
                    do {
                        let session = AVAudioSession.sharedInstance()
                        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
                        try session.setActive(true)
                        if self.previousBrightness == nil { self.previousBrightness = UIScreen.main.brightness }
                        let requestedBrightness = CGFloat(call.getDouble("brightness") ?? 0.8)
                        UIScreen.main.brightness = requestedBrightness
                        UIApplication.shared.isIdleTimerDisabled = true
                        // Brightness application is asynchronous, especially in Simulator.
                        // Finish preflight before a delayed setup notification can interrupt capture.
                        self.finishPreparation(call, brightness: requestedBrightness, deadline: Date().addingTimeInterval(2))
                    } catch { call.reject("Unable to prepare audio: \(error.localizedDescription)") }
                }
            }
            if !needsRecognition { finish(); return }
            SFSpeechRecognizer.requestAuthorization { status in
                self.deviceRecognitionReady = status == .authorized && SFSpeechRecognizer(locale: Locale(identifier: "en-US"))?.supportsOnDeviceRecognition == true
                finish()
            }
        }
            if fixtureInput { permissionResult(true) }
        else { AVAudioApplication.requestRecordPermission(completionHandler: permissionResult) }
    }
    private func finishPreparation(_ call: CAPPluginCall, brightness: CGFloat, deadline: Date) {
        if abs(UIScreen.main.brightness - brightness) > 0.005, Date() < deadline {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                self.finishPreparation(call, brightness: brightness, deadline: deadline)
            }
            return
        }
        call.resolve(["onDeviceSpeech": deviceRecognitionReady, "brightness": Double(UIScreen.main.brightness), "testInput": fixtureInput])
    }
    private func recordingDirectory() throws -> URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MLPTRecordings", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return directory
    }
    @objc func recordingPath(_ call: CAPPluginCall) {
        // Application container UUIDs can change after installing an update.
        // Resolve retained recordings inside the current container, never an arbitrary path.
        guard let path = call.getString("path") else { call.reject("A recording path is required."); return }
        let filename = URL(fileURLWithPath: path).lastPathComponent
        let stem = (filename as NSString).deletingPathExtension
        let identifier = stem.hasPrefix("answer-") ? String(stem.dropFirst(7)) : stem
        guard filename.hasSuffix(".wav"), UUID(uuidString: identifier) != nil else {
            call.reject("Invalid recording name."); return
        }
        do {
            let url = try recordingDirectory().appendingPathComponent(filename)
            guard FileManager.default.fileExists(atPath: url.path) else { call.reject("The recording is missing from device storage."); return }
            let original = try Data(contentsOf: url, options: .mappedIfSafe)
            if let recovered = try WAVRecovery.recoveredDataIfNeeded(original) {
                let recoveryURL = url.deletingPathExtension().appendingPathExtension("recovered.wav")
                try recovered.write(to: recoveryURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                call.resolve(["path": recoveryURL.path, "repaired": true])
            } else {
                call.resolve(["path": url.path, "repaired": false])
            }
        } catch { call.reject("Could not locate the recording: \(error.localizedDescription)") }
    }
    private func makeFile(_ url: URL, format: AVAudioFormat) throws -> AVAudioFile {
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate, AVNumberOfChannelsKey: format.channelCount, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        return file
    }
    private func consumePCM(_ buffer: AVAudioPCMBuffer) {
        fileLock.lock()
        defer { fileLock.unlock() }
        do {
            try fullFile?.write(from: buffer)
            try answerFile?.write(from: buffer)
            recognitionRequest?.append(buffer)
        } catch {
            if !captureErrorSent {
                captureErrorSent = true
                DispatchQueue.main.async { self.interrupt("Audio could not be written to device storage.") }
            }
        }
    }
    private func ensureCapture() throws -> AVAudioFormat {
        if let format = captureFormat { return format }
        if fixtureInput {
            let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
            captureFormat = format
            #if DEBUG && targetEnvironment(simulator)
            fixtureClock = Timer.scheduledTimer(withTimeInterval: 0.032, repeats: true) { [weak self] _ in
                guard let self = self else { return }
                let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
                buffer.frameLength = 512
                let samples = buffer.floatChannelData![0]
                for i in 0..<512 {
                    if self.fixtureCursor < self.fixtureSamples.count {
                        samples[i] = self.fixtureSamples[self.fixtureCursor]
                        self.fixtureCursor += 1
                    } else { samples[i] = 0 }
                }
                self.consumePCM(buffer)
            }
            #endif
            return format
        }
        let next = AVAudioEngine()
        let input = next.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "MLPT", code: 1, userInfo: [NSLocalizedDescriptionKey: "The microphone has no usable input format."])
        }
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in self?.consumePCM(buffer) }
        next.prepare()
        try next.start()
        engine = next
        captureFormat = format
        return format
    }
    private func stopRecognition() {
        recognitionGeneration += 1
        fileLock.lock()
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        fileLock.unlock()
        recognitionTask?.cancel()
        recognitionTask = nil
    }
    private func startRecognition(_ context: String) throws {
        stopRecognition()
        _ = try ensureCapture()
        transcript = ""
        let generation = recognitionGeneration
        #if DEBUG && targetEnvironment(simulator)
        if fixtureInput { pollFixture(context, generation: generation); return }
        #endif
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.supportsOnDeviceRecognition, recognizer.isAvailable else {
            throw NSError(domain: "MLPT", code: 2, userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition is unavailable."])
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        // Command vocabulary only. Target identities are never passed as hints.
        if context != "answering" { request.contextualStrings = ["start session", "finish trial", "yes", "change", "next trial", "repeat", "end session", "stop session", "no"] }
        fileLock.lock()
        recognitionRequest = request
        fileLock.unlock()
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, generation == self.recognitionGeneration else { return }
                if let result = result {
                    self.transcript = result.bestTranscription.formattedString
                    self.notifyListeners("transcript", data: ["text": self.transcript, "isFinal": result.isFinal])
                }
                if let error = error {
                    self.notifyListeners("speechError", data: ["message": error.localizedDescription])
                }
            }
        }
    }
    @objc func beginListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { try self.startRecognition(call.getString("context") ?? "ready"); call.resolve() }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func stopListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.stopRecognition(); call.resolve() }
    }
    @objc func startTrial(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.fullFile == nil else { call.reject("A trial is already recording."); return }
            guard let id = call.getString("trialId"), UUID(uuidString: id) != nil else { call.reject("A valid trial ID is required."); return }
            do {
                let format = try self.ensureCapture()
                let url = try self.recordingDirectory().appendingPathComponent("\(id).wav")
                let file = try self.makeFile(url, format: format)
                self.fileLock.lock()
                self.fullFile = file
                self.fullURL = url
                self.captureErrorSent = false
                self.fileLock.unlock()
                self.captureBrightness = UIScreen.main.brightness
                call.resolve(["path": url.path, "brightness": Double(UIScreen.main.brightness)])
            } catch { call.reject("Could not begin recording: \(error.localizedDescription)") }
        }
    }
    @objc func beginAnswer(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                let format = try self.ensureCapture()
                let url = try self.recordingDirectory().appendingPathComponent("answer-\(UUID().uuidString).wav")
                let file = try self.makeFile(url, format: format)
                self.fileLock.lock()
                self.answerURL = url
                self.answerFile = file
                self.fileLock.unlock()
                self.transcript = ""
                if call.getBool("recognize") ?? true { try self.startRecognition("answering") }
                call.resolve()
            } catch { call.reject("Could not capture the final answer: \(error.localizedDescription)") }
        }
    }
    @objc func stopAnswer(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopRecognition()
            self.fileLock.lock()
            self.answerFile = nil
            let path = self.answerURL?.path ?? ""
            self.fileLock.unlock()
            call.resolve(["path": path, "transcript": self.transcript])
        }
    }
    // Simulator-only input adapter. Real PCM enters the same recording pipeline;
    // a local Whisper process recognizes the audio, never a canned transcript.
    #if DEBUG && targetEnvironment(simulator)
    private func pollFixture(_ context: String, generation: Int) {
        Task { @MainActor in
            guard fixtureInput, generation == recognitionGeneration else { return }
            do {
                let url = URL(string: "http://127.0.0.1:9333/next?context=\(context)&generation=\(generation)")!
                var request = URLRequest(url: url)
                request.timeoutInterval = 3
                let (data, response) = try await URLSession.shared.data(for: request)
                guard generation == recognitionGeneration else { return }
                if (response as? HTTPURLResponse)?.statusCode == 204 {
                    try await Task.sleep(nanoseconds: 300_000_000)
                    self.pollFixture(context, generation: generation)
                    return
                }
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("fixture-\(UUID().uuidString).wav")
                try data.write(to: fileURL)
                defer { try? FileManager.default.removeItem(at: fileURL) }
                let file = try AVAudioFile(forReading: fileURL)
                guard file.processingFormat.sampleRate == 16000, file.processingFormat.channelCount == 1 else { throw URLError(.cannotDecodeContentData) }
                let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))!
                try file.read(into: buffer)
                fixtureSamples = Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength)))
                fixtureCursor = 0
                while fixtureCursor < fixtureSamples.count {
                    guard generation == recognitionGeneration else { return }
                    try await Task.sleep(nanoseconds: 32_000_000)
                }
                var transcription = URLRequest(url: URL(string: "http://127.0.0.1:9333/transcribe")!)
                transcription.httpMethod = "POST"
                transcription.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
                transcription.httpBody = data
                transcription.timeoutInterval = 30
                let (result, _) = try await URLSession.shared.data(for: transcription)
                guard generation == recognitionGeneration else { return }
                let json = try JSONSerialization.jsonObject(with: result) as? [String: Any]
                guard let text = json?["text"] as? String else { throw URLError(.cannotParseResponse) }
                transcript = text
                notifyListeners("transcript", data: ["text": text, "isFinal": true, "testInput": true])
            } catch {
                if generation == recognitionGeneration {
                    notifyListeners("speechError", data: ["message": "Simulator audio test service: \(error.localizedDescription)"])
                }
            }
        }
    }
    #endif
    private func finishCapture() {
        recognitionGeneration += 1
        captureBrightness = nil
        engine?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        engine = nil
        captureFormat = nil
        #if DEBUG && targetEnvironment(simulator)
        fixtureClock?.invalidate()
        fixtureClock = nil
        fixtureSamples = []
        fixtureCursor = 0
        #endif
        fileLock.lock()
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        fullFile = nil
        answerFile = nil
        fileLock.unlock()
        recognitionTask?.cancel()
        recognitionTask = nil
    }
    @objc func stopTrial(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopRecognition()
            self.captureBrightness = nil
            self.fileLock.lock()
            self.fullFile = nil
            self.answerFile = nil
            self.fileLock.unlock()
            call.resolve(["path": self.fullURL?.path ?? ""])
        }
    }
    private func interrupt(_ message: String) {
        guard captureFormat != nil else { return }
        finishCapture()
        synthesizer.stopSpeaking(at: .immediate)
        if let value = previousBrightness { UIScreen.main.brightness = value; previousBrightness = nil }
        UIApplication.shared.isIdleTimerDisabled = false
        notifyListeners("interrupted", data: ["message": message], retainUntilConsumed: true)
    }
    @objc func speak(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let text = call.getString("text") ?? ""
            guard !text.isEmpty else { call.resolve(); return }
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
            utterance.rate = 0.46
            self.speechCalls[ObjectIdentifier(utterance)] = call
            self.synthesizer.speak(utterance)
        }
    }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { speechCalls.removeValue(forKey: ObjectIdentifier(utterance))?.resolve() }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { speechCalls.removeValue(forKey: ObjectIdentifier(utterance))?.resolve() }
    @objc func beep(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // A short PCM tone, played through the same play-and-record audio session.
            let sampleRate = 22050, count = 3307
            var data = Data()
            func text(_ value: String) { data.append(value.data(using: .ascii)!) }
            func word(_ value: UInt16) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
            func number(_ value: UInt32) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
            text("RIFF"); number(UInt32(36 + count * 2)); text("WAVEfmt "); number(16); word(1); word(1); number(UInt32(sampleRate)); number(UInt32(sampleRate * 2)); word(2); word(16); text("data"); number(UInt32(count * 2))
            for i in 0..<count { let envelope = min(1.0, Double(i) / 150.0) * (1.0 - Double(i) / Double(count)); let sample = Int16(sin(Double(i) * 2 * .pi * 660 / Double(sampleRate)) * 5000 * envelope); word(UInt16(bitPattern: sample)) }
            do { self.tonePlayer = try AVAudioPlayer(data: data); self.tonePlayer?.play(); call.resolve() }
            catch { call.reject("Unable to play the trial tone.") }
        }
    }
    @objc func shareExport(_ call: CAPPluginCall) {
        guard let encoded = call.getString("base64"), let data = Data(base64Encoded: encoded),
              let filename = call.getString("filename"), filename.range(of: "^[A-Za-z0-9._-]+\\.zip$", options: .regularExpression) != nil else {
            call.reject("The export file is invalid."); return
        }
        DispatchQueue.main.async {
            do {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
                try data.write(to: url, options: .atomic)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                guard let presenter = self.bridge?.viewController else { call.reject("The export sheet is unavailable."); return }
                if let popover = sheet.popoverPresentationController {
                    popover.sourceView = presenter.view
                    popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                    popover.permittedArrowDirections = []
                }
                sheet.completionWithItemsHandler = { _, _, _, error in
                    try? FileManager.default.removeItem(at: url)
                    if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
                }
                presenter.present(sheet, animated: true)
            } catch { call.reject("Unable to prepare the export file.") }
        }
    }
    @objc func restore(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishCapture()
            self.synthesizer.stopSpeaking(at: .immediate)
            if let value = self.previousBrightness { UIScreen.main.brightness = value; self.previousBrightness = nil }
            UIApplication.shared.isIdleTimerDisabled = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            call.resolve()
        }
    }
}
