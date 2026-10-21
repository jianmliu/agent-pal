// MIDI → WAV,离线渲染,用 macOS 自带的 GM 音色库(gs_instruments.dls)。只在 macOS 上能用;由 music-from-midi.mjs 调。
//   swift render-midi.swift <in.mid> <out.wav> [尾音秒数=2]
import AVFoundation
import AudioToolbox

let args = CommandLine.arguments
guard args.count >= 3 else { FileHandle.standardError.write("usage: render-midi <in.mid> <out.wav> [tail seconds]\n".data(using: .utf8)!); exit(2) }
let inURL = URL(fileURLWithPath: args[1]), outURL = URL(fileURLWithPath: args[2])
let tail = args.count > 3 ? (Double(args[3]) ?? 2) : 2

let engine = AVAudioEngine()
var desc = AudioComponentDescription(componentType: kAudioUnitType_MusicDevice, componentSubType: kAudioUnitSubType_MIDISynth,
                                     componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0)
let synth = AVAudioUnitMIDIInstrument(audioComponentDescription: desc)
engine.attach(synth)
let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
engine.connect(synth, to: engine.mainMixerNode, format: format)
engine.mainMixerNode.outputVolume = 0.7                      // 留点余量:好几个声部叠在一起会削顶
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)

// 音色库:系统自带的 GM 集
var bank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls") as CFURL
let st = withUnsafePointer(to: &bank) { AudioUnitSetProperty(synth.audioUnit, kMusicDeviceProperty_SoundBankURL, kAudioUnitScope_Global, 0, $0, UInt32(MemoryLayout<CFURL>.size)) }
guard st == noErr else { FileHandle.standardError.write("cannot load the system sound bank (\(st))\n".data(using: .utf8)!); exit(1) }

let sequencer = AVAudioSequencer(audioEngine: engine)
try sequencer.load(from: inURL, options: [])
for track in sequencer.tracks { track.destinationAudioUnit = synth }
let length = sequencer.tracks.map { $0.lengthInSeconds }.max() ?? 0
guard length > 0 else { FileHandle.standardError.write("empty MIDI file\n".data(using: .utf8)!); exit(1) }

try engine.start()
sequencer.prepareToPlay()
try sequencer.start()

let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 2,
                               AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
let out = try AVAudioFile(forWriting: outURL, settings: settings)
let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: engine.manualRenderingMaximumFrameCount)!
let total = AVAudioFramePosition((length + tail) * 44100)
while engine.manualRenderingSampleTime < total {
  let n = AVAudioFrameCount(min(AVAudioFramePosition(buffer.frameCapacity), total - engine.manualRenderingSampleTime))
  let status = try engine.renderOffline(n, to: buffer)
  if status == .success { try out.write(from: buffer) } else if status == .error { FileHandle.standardError.write("render error\n".data(using: .utf8)!); exit(1) }
}
sequencer.stop(); engine.stop()
print(String(format: "%.1f", length))
