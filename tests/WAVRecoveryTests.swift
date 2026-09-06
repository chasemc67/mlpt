import Foundation

@main struct WAVRecoveryTests {
    static func fixture(channels: Int, finalized: Bool, tail: Int = 0) -> Data {
        var data = Data()
        func tag(_ text: String) { data.append(text.data(using: .ascii)!) }
        func word(_ number: Int, _ bytes: Int = 4) {
            for byte in 0..<bytes { data.append(UInt8((number >> (byte * 8)) & 255)) }
        }
        let payloadBytes = 12 * channels * 2
        tag("RIFF"); word(finalized ? 36 + payloadBytes : 36); tag("WAVE")
        tag("fmt "); word(16); word(1, 2); word(channels, 2); word(48000)
        word(48000 * channels * 2); word(channels * 2, 2); word(16, 2)
        tag("data"); word(finalized ? payloadBytes : 0)
        data.append(Data(repeating: 7, count: payloadBytes + tail))
        return data
    }
    static func main() throws {
        for channels in [1, 3] {
            let complete = fixture(channels: channels, finalized: true)
            let unchanged = try WAVRecovery.recoveredDataIfNeeded(complete)
            precondition(unchanged == nil)
            let interrupted = fixture(channels: channels, finalized: false)
            let repaired = try WAVRecovery.recoveredDataIfNeeded(interrupted)
            precondition(repaired == complete)
            precondition(interrupted[40] == 0, "Original bytes must remain untouched")
            let torn = fixture(channels: channels, finalized: false, tail: 1)
            let recovered = try WAVRecovery.recoveredDataIfNeeded(torn)
            precondition(recovered == complete, "Only complete PCM frames may be recovered")
        }
        do {
            _ = try WAVRecovery.recoveredDataIfNeeded(Data("not a WAV".utf8))
            fatalError("Invalid files must be rejected")
        } catch WAVRecovery.Failure.invalidPCM {}
        print("PASS: complete WAVs unchanged; mono/three-channel crash headers repaired; torn frame discarded; original preserved; invalid files rejected.")
    }
}
