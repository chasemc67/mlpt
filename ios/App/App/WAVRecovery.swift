import Foundation

enum WAVRecovery {
    enum Failure: Error { case invalidPCM, noCompleteFrames }

    /// Recover the terminal PCM data chunk of a file made by MLPT's AVAudioFile writer.
    /// Return a copy so the original interrupted recording remains untouched.
    static func recoveredDataIfNeeded(_ data: Data) throws -> Data? {
        func tag(_ offset: Int) -> String {
            String(data: data.subdata(in: offset..<(offset + 4)), encoding: .ascii) ?? ""
        }
        func word(_ offset: Int, _ count: Int) -> Int {
            (0..<count).reduce(0) { $0 | Int(data[offset + $1]) << (8 * $1) }
        }
        guard data.count >= 44, data.count - 8 <= Int(UInt32.max), tag(0) == "RIFF", tag(8) == "WAVE" else { throw Failure.invalidPCM }
        var offset = 12
        var blockAlign = 0
        while offset + 8 <= data.count {
            let name = tag(offset), size = word(offset + 4, 4)
            let payload = offset + 8
            if name == "data" {
                guard blockAlign > 0 else { throw Failure.invalidPCM }
                let available = data.count - payload
                if size == available, size > 0, size % blockAlign == 0, word(4, 4) == data.count - 8 { return nil }
                let completeBytes = available / blockAlign * blockAlign
                guard completeBytes > 0 else { throw Failure.noCompleteFrames }
                var recovered = Data(data.prefix(payload + completeBytes))
                func write(_ value: Int, at offset: Int) {
                    for byte in 0..<4 { recovered[offset + byte] = UInt8((value >> (byte * 8)) & 0xff) }
                }
                write(recovered.count - 8, at: 4)
                write(completeBytes, at: offset + 4)
                return recovered
            }
            guard size <= data.count - payload else { throw Failure.invalidPCM }
            if name == "fmt " {
                guard size >= 16, word(payload, 2) == 1, word(payload + 2, 2) > 0,
                      word(payload + 4, 4) > 0, word(payload + 14, 2) == 16,
                      word(payload + 12, 2) == word(payload + 2, 2) * 2 else { throw Failure.invalidPCM }
                blockAlign = word(payload + 12, 2)
            }
            offset = payload + size + size % 2
        }
        throw Failure.invalidPCM
    }
}
