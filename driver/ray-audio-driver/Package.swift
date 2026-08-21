// swift-tools-version:5.9
import PackageDescription

// Ray Audio Driver — plugin CoreAudio/HAL (bundle .driver) + probe de
// verificacao. O plugin e uma biblioteca dinamica C carregada pelo coreaudiod
// via AudioServerPlugInMain; o probe e um executavel de diagnostico.
let package = Package(
    name: "RayAudioDriver",
    platforms: [.macOS(.v11)],
    products: [
        .library(name: "RayAudioDriver", type: .dynamic, targets: ["RayAudioDriver"]),
        .executable(name: "RayAudioProbe", targets: ["RayAudioProbe"]),
    ],
    targets: [
        .target(
            name: "RayAudioDriver",
            path: "Sources/RayAudioDriver",
            linkerSettings: [
                .linkedFramework("CoreAudio"),
                .linkedFramework("CoreFoundation"),
                .linkedFramework("AudioToolbox"),
            ]
        ),
        .executableTarget(
            name: "RayAudioProbe",
            path: "Sources/RayAudioProbe",
            linkerSettings: [
                .linkedFramework("CoreAudio"),
                .linkedFramework("CoreFoundation"),
            ]
        ),
    ]
)
