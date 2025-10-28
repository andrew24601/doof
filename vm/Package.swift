// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "DoofVM",
    platforms: [
        .iOS(.v13),
        .macOS(.v12)
    ],
    products: [
        // Expose a library that forwards to the binary XCFramework
        .library(name: "DoofVM", targets: ["DoofVM"]),
    ],
    targets: [
        // The binaryTarget points to the built XCFramework. Consumers can reference this package
        // locally (file system) or you can publish it as a package repository with the XCFramework
        // checked in at the specified path.
        .binaryTarget(
            name: "DoofVM",
            path: "./build/xcframework/doof-vm.xcframework"
        )
    ]
)
