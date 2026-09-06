import Capacitor
class MLPTViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MLPTAudioPlugin())
    }
}
