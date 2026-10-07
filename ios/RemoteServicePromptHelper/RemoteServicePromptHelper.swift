import CryptoKit
import Foundation
import XCTest

private enum RemoteServiceHelperFailure: Error, CustomStringConvertible {
  case invalidConfiguration(String)
  case deadline
  case cancelled
  case unavailable
  case ambiguous
  case notActionable

  var description: String {
    switch self {
    case .invalidConfiguration(let detail): return "invalid-configuration: \(detail)"
    case .deadline: return "deadline-exceeded"
    case .cancelled: return "cancelled"
    case .unavailable: return "remote-target-unavailable"
    case .ambiguous: return "prompt-or-dismiss-control-was-not-unique"
    case .notActionable: return "unique-controls-were-not-actionable"
    }
  }
}

private struct RemoteServiceTargetSpec: Codable {
  let role: String
  let bundleIdentifier: String
}

private struct ElementState: Codable {
  let count: Int
  let exists: Bool
  let enabled: Bool
  let visible: Bool
  let hittable: Bool
}

private struct TargetAttempt: Codable {
  let role: String
  let bundleIdentifier: String
  let applicationExists: Bool
  let prompt: ElementState
  let dismiss: ElementState
  let outcome: String
  let observedAtMs: Int64
}

private struct HelperProvenance: Codable {
  let bundleIdentifier: String
  let bundlePath: String
  let executablePath: String
  let expectedBinaryPath: String
  let binarySha256: String
  let sourceClosureSha256: String
  let projectClosureSha256: String
}

private struct HelperTiming: Codable {
  let startedAtMs: Int64
  let endedAtMs: Int64
  let originalDeadlineAtMs: Int64
}

private struct RemoteServiceReceipt: Codable {
  let schema: String
  let status: String
  let action: String
  let expectedDeviceUdid: String
  let observedDeviceUdid: String
  let runId: String
  let promptLabel: String
  let dismissLabel: String
  let targetBundleIdentifiers: [RemoteServiceTargetSpec]
  let targetBundleIdentifier: String?
  let reason: String
  let reachedTargetCount: Int
  let stableActionableSamplesBeforeTap: Int
  let tapSent: Bool
  let attempts: [TargetAttempt]
  let helper: HelperProvenance
  let timing: HelperTiming
  let error: String?
}

private struct RemoteServiceRunConfiguration {
  static let promptLabel = "Save Password?"
  static let dismissLabel = "Not Now"
  static let schema = "ios-detox-camera-remote-service-helper-receipt-v1"
  static let targets = [
    RemoteServiceTargetSpec(
      role: "safari-view-service",
      bundleIdentifier: "com.apple.SafariViewService"
    ),
  ]

  let expectedDeviceUdid: String
  let observedDeviceUdid: String
  let deadlineAtMs: Int64
  let artifactRoot: URL
  let receiptURL: URL
  let cancelURL: URL
  let runId: String
  let sourceClosureSha256: String
  let projectClosureSha256: String
  let expectedBinarySha256: String
  let expectedBinaryPath: String
  let expectedBundleIdentifier: String
  let deadlineAtUptime: TimeInterval

  init(environment: [String: String] = ProcessInfo.processInfo.environment) throws {
    func required(_ key: String) throws -> String {
      guard let value = environment[key], !value.isEmpty else {
        throw RemoteServiceHelperFailure.invalidConfiguration("missing \(key)")
      }
      return value
    }

    expectedDeviceUdid = try Self.requireUdid(required("REMOTE_SERVICE_HELPER_EXPECTED_UDID"))
    observedDeviceUdid = try Self.requireUdid(required("SIMULATOR_UDID"))
    guard expectedDeviceUdid == observedDeviceUdid else {
      throw RemoteServiceHelperFailure.invalidConfiguration(
        "destination UDID does not match SIMULATOR_UDID"
      )
    }
    let currentEpochMs = Self.nowMs()
    guard let parsedDeadline = Int64(try required("REMOTE_SERVICE_HELPER_DEADLINE_AT_MS")),
      parsedDeadline > currentEpochMs
    else {
      throw RemoteServiceHelperFailure.invalidConfiguration("deadline is missing or expired")
    }
    deadlineAtMs = parsedDeadline
    let remainingMs = try Self.requireBoundedRemainingMs(
      required("REMOTE_SERVICE_HELPER_BUDGET_REMAINING_MS")
    )
    // The host owns the original monotonic deadline. It passes the remaining
    // budget once; this process never re-anchors polling from wall time.
    deadlineAtUptime = ProcessInfo.processInfo.systemUptime + Double(remainingMs) / 1000.0

    artifactRoot = URL(fileURLWithPath: try required("REMOTE_SERVICE_HELPER_ARTIFACT_ROOT"), isDirectory: true)
      .standardizedFileURL
    receiptURL = URL(fileURLWithPath: try required("REMOTE_SERVICE_HELPER_RECEIPT_PATH"))
      .standardizedFileURL
    cancelURL = URL(fileURLWithPath: try required("REMOTE_SERVICE_HELPER_CANCEL_PATH"))
      .standardizedFileURL
    try Self.requireDirectChild(receiptURL, of: artifactRoot, label: "receipt")
    try Self.requireDirectChild(cancelURL, of: artifactRoot, label: "cancel marker")
    try Self.requirePrivateArtifactRoot(artifactRoot)
    guard !FileManager.default.fileExists(atPath: receiptURL.path) else {
      throw RemoteServiceHelperFailure.invalidConfiguration("receipt path already exists")
    }

    runId = try required("REMOTE_SERVICE_HELPER_RUN_ID")
    sourceClosureSha256 = try Self.requireHash(required("REMOTE_SERVICE_HELPER_SOURCE_CLOSURE_SHA256"))
    projectClosureSha256 = try Self.requireHash(required("REMOTE_SERVICE_HELPER_PROJECT_CLOSURE_SHA256"))
    expectedBinarySha256 = try Self.requireHash(required("REMOTE_SERVICE_HELPER_BINARY_SHA256"))
    expectedBinaryPath = try required("REMOTE_SERVICE_HELPER_BINARY_PATH")
    expectedBundleIdentifier = try required("REMOTE_SERVICE_HELPER_EXPECTED_BUNDLE_ID")
    guard expectedBundleIdentifier == "com.edufelip.mychampions.remote.service.helper" else {
      throw RemoteServiceHelperFailure.invalidConfiguration("unexpected helper bundle identifier")
    }
  }

  func execute() throws -> RemoteServiceReceipt {
    let startedAtMs = Self.nowMs()
    let helper = try helperProvenance()
    var attempts: [TargetAttempt] = []
    var reachedBundleIds = Set<String>()
    var sawAmbiguous = false
    var sawNotActionable = false
    var previousTarget: String?
    var previousStableKey: String?
    var stableSamples = 0

    while true {
      try assertWithinOriginalDeadline()
      for target in Self.targets {
        try assertWithinOriginalDeadline()
        let app = XCUIApplication(bundleIdentifier: target.bundleIdentifier)
        let appExists = app.exists
        if appExists { reachedBundleIds.insert(target.bundleIdentifier) }

        let promptQuery = app
          .descendants(matching: .any)
          .matching(NSPredicate(format: "label == %@", Self.promptLabel))
        let dismissQuery = app
          .descendants(matching: .button)
          .matching(NSPredicate(format: "label == %@", Self.dismissLabel))
        let promptCount = promptQuery.count
        let dismissCount = dismissQuery.count
        let promptElement = promptCount == 1 ? promptQuery.element(boundBy: 0) : nil
        let dismissElement = dismissCount == 1 ? dismissQuery.element(boundBy: 0) : nil
        let promptState = Self.elementState(promptElement, count: promptCount)
        let dismissState = Self.elementState(dismissElement, count: dismissCount)
        let outcome: String
        if !appExists {
          outcome = "application-unavailable"
        } else if promptCount != 1 || dismissCount != 1 {
          outcome = promptCount > 1 || dismissCount > 1 ? "ambiguous" : "no-unique-match"
          sawAmbiguous = sawAmbiguous || promptCount > 1 || dismissCount > 1
        } else if !promptState.visible || !promptState.hittable || !dismissState.enabled || !dismissState.visible || !dismissState.hittable {
          outcome = "not-actionable"
          sawNotActionable = true
        } else {
          outcome = "unique-actionable"
        }
        let attempt = TargetAttempt(
          role: target.role,
          bundleIdentifier: target.bundleIdentifier,
          applicationExists: appExists,
          prompt: promptState,
          dismiss: dismissState,
          outcome: outcome,
          observedAtMs: Self.nowMs()
        )
        attempts.append(attempt)
        if attempts.count > 128 { attempts.removeFirst(attempts.count - 128) }

        guard outcome == "unique-actionable", let dismissElement else {
          previousTarget = nil
          previousStableKey = nil
          stableSamples = 0
          continue
        }
        let stableKey = "\(target.bundleIdentifier)|\(promptState.count)|\(promptState.visible)|\(promptState.hittable)|\(dismissState.count)|\(dismissState.enabled)|\(dismissState.visible)|\(dismissState.hittable)"
        if previousTarget == target.bundleIdentifier && previousStableKey == stableKey {
          stableSamples += 1
        } else {
          stableSamples = 1
        }
        previousTarget = target.bundleIdentifier
        previousStableKey = stableKey
        guard stableSamples >= 2 else { continue }

        try assertWithinOriginalDeadline()
        dismissElement.tap()
        try assertWithinOriginalDeadline()
        let endedAtMs = Self.nowMs()
        return RemoteServiceReceipt(
          schema: Self.schema,
          status: "dismissed",
          action: "dismiss-save-password",
          expectedDeviceUdid: expectedDeviceUdid,
          observedDeviceUdid: observedDeviceUdid,
          runId: runId,
          promptLabel: Self.promptLabel,
          dismissLabel: Self.dismissLabel,
          targetBundleIdentifiers: Self.targets,
          targetBundleIdentifier: target.bundleIdentifier,
          reason: "unique-witness-and-actionable-dismiss-control",
          reachedTargetCount: reachedBundleIds.count,
          stableActionableSamplesBeforeTap: stableSamples,
          tapSent: true,
          attempts: attempts,
          helper: helper,
          timing: HelperTiming(
            startedAtMs: startedAtMs,
            endedAtMs: endedAtMs,
            originalDeadlineAtMs: deadlineAtMs
          ),
          error: nil
        )
      }

      let remainingMs = Int64(max(0.0, (deadlineAtUptime - ProcessInfo.processInfo.systemUptime) * 1000.0))
      if remainingMs <= 0 { break }
      Thread.sleep(forTimeInterval: min(0.1, Double(remainingMs) / 1000.0))
    }

    if FileManager.default.fileExists(atPath: cancelURL.path) {
      throw RemoteServiceHelperFailure.cancelled
    }
    if reachedBundleIds.isEmpty { throw RemoteServiceHelperFailure.unavailable }
    if sawAmbiguous { throw RemoteServiceHelperFailure.ambiguous }
    if sawNotActionable { throw RemoteServiceHelperFailure.notActionable }
    let endedAtMs = Self.nowMs()
    return RemoteServiceReceipt(
      schema: Self.schema,
      status: "absent",
      action: "dismiss-save-password",
      expectedDeviceUdid: expectedDeviceUdid,
      observedDeviceUdid: observedDeviceUdid,
      runId: runId,
      promptLabel: Self.promptLabel,
      dismissLabel: Self.dismissLabel,
      targetBundleIdentifiers: Self.targets,
      targetBundleIdentifier: nil,
      reason: "no-unique-actionable-prompt-before-deadline",
      reachedTargetCount: reachedBundleIds.count,
      stableActionableSamplesBeforeTap: stableSamples,
      tapSent: false,
      attempts: attempts,
      helper: helper,
      timing: HelperTiming(
        startedAtMs: startedAtMs,
        endedAtMs: endedAtMs,
        originalDeadlineAtMs: deadlineAtMs
      ),
      error: nil
    )
  }

  func failureReceipt(_ error: Error) -> RemoteServiceReceipt? {
    guard FileManager.default.fileExists(atPath: receiptURL.path) == false else { return nil }
    let now = Self.nowMs()
    let helper = (try? helperProvenance()) ?? HelperProvenance(
      bundleIdentifier: Bundle(for: RemoteServicePromptHelperTests.self).bundleIdentifier ?? "unknown",
      bundlePath: Bundle(for: RemoteServicePromptHelperTests.self).bundlePath,
      executablePath: Bundle(for: RemoteServicePromptHelperTests.self).executableURL?.path ?? "unknown",
      expectedBinaryPath: expectedBinaryPath,
      binarySha256: "unknown",
      sourceClosureSha256: sourceClosureSha256,
      projectClosureSha256: projectClosureSha256
    )
    let status: String
    if let typedError = error as? RemoteServiceHelperFailure {
      switch typedError {
      case .cancelled: status = "cancelled"
      case .deadline: status = "deadline"
      default: status = "failed"
      }
    } else {
      status = "failed"
    }
    return RemoteServiceReceipt(
      schema: Self.schema,
      status: status,
      action: "dismiss-save-password",
      expectedDeviceUdid: expectedDeviceUdid,
      observedDeviceUdid: observedDeviceUdid,
      runId: runId,
      promptLabel: Self.promptLabel,
      dismissLabel: Self.dismissLabel,
      targetBundleIdentifiers: Self.targets,
      targetBundleIdentifier: nil,
      reason: "helper-failed-before-usable-receipt",
      reachedTargetCount: 0,
      stableActionableSamplesBeforeTap: 0,
      tapSent: false,
      attempts: [],
      helper: helper,
      timing: HelperTiming(
        startedAtMs: now,
        endedAtMs: now,
        originalDeadlineAtMs: deadlineAtMs
      ),
      error: String(describing: error)
    )
  }

  func write(_ receipt: RemoteServiceReceipt) throws {
    let data = try JSONEncoder().encode(receipt)
    try data.write(to: receiptURL, options: [.atomic])
    try FileManager.default.setAttributes(
      [.posixPermissions: NSNumber(value: 0o600)],
      ofItemAtPath: receiptURL.path
    )
    let attributes = try FileManager.default.attributesOfItem(atPath: receiptURL.path)
    let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
    guard permissions & 0o777 == 0o600 else {
      throw RemoteServiceHelperFailure.invalidConfiguration("receipt is not mode 0600")
    }
  }

  private func helperProvenance() throws -> HelperProvenance {
    let bundle = Bundle(for: RemoteServicePromptHelperTests.self)
    guard let executableURL = bundle.executableURL else {
      throw RemoteServiceHelperFailure.invalidConfiguration("helper executable path is unavailable")
    }
    guard bundle.bundleIdentifier == expectedBundleIdentifier,
      executableURL.path.hasPrefix(bundle.bundlePath + "/")
    else {
      throw RemoteServiceHelperFailure.invalidConfiguration("installed helper bundle identity mismatch")
    }
    try assertWithinOriginalDeadline()
    let fileHandle = try FileHandle(forReadingFrom: executableURL)
    let binaryData: Data
    do {
      let fileSize = try fileHandle.seekToEnd()
      guard fileSize <= 256 * 1024 * 1024 else {
        throw RemoteServiceHelperFailure.invalidConfiguration("helper binary exceeds bounded read size")
      }
      try fileHandle.seek(toOffset: 0)
      var readData = Data()
      readData.reserveCapacity(Int(fileSize))
      var remaining = Int(fileSize)
      while remaining > 0 {
        try assertWithinOriginalDeadline()
        let chunk = try fileHandle.read(upToCount: min(1024 * 1024, remaining)) ?? Data()
        guard !chunk.isEmpty else {
          throw RemoteServiceHelperFailure.invalidConfiguration("helper binary ended during bounded read")
        }
        readData.append(chunk)
        remaining -= chunk.count
      }
      guard readData.count == Int(fileSize) else {
        throw RemoteServiceHelperFailure.invalidConfiguration("helper binary ended during bounded read")
      }
      let finalSize = try fileHandle.seekToEnd()
      guard finalSize == fileSize else {
        throw RemoteServiceHelperFailure.invalidConfiguration("helper binary changed during bounded read")
      }
      binaryData = readData
      try fileHandle.close()
    } catch {
      try? fileHandle.close()
      throw error
    }
    try assertWithinOriginalDeadline()
    let actualHash = SHA256.hash(data: binaryData).map { String(format: "%02x", $0) }.joined()
    guard actualHash == expectedBinarySha256 else {
      throw RemoteServiceHelperFailure.invalidConfiguration("helper binary hash does not match command input")
    }
    return HelperProvenance(
      bundleIdentifier: bundle.bundleIdentifier ?? "unknown",
      bundlePath: bundle.bundlePath,
      executablePath: executableURL.path,
      expectedBinaryPath: expectedBinaryPath,
      binarySha256: actualHash,
      sourceClosureSha256: sourceClosureSha256,
      projectClosureSha256: projectClosureSha256
    )
  }

  private func assertWithinOriginalDeadline() throws {
    if FileManager.default.fileExists(atPath: cancelURL.path) {
      throw RemoteServiceHelperFailure.cancelled
    }
    if ProcessInfo.processInfo.systemUptime >= deadlineAtUptime {
      throw RemoteServiceHelperFailure.deadline
    }
  }

  private static func elementState(_ element: XCUIElement?, count: Int) -> ElementState {
    guard let element else {
      return ElementState(count: count, exists: false, enabled: false, visible: false, hittable: false)
    }
    let exists = element.exists
    let enabled = exists && element.isEnabled
    let hittable = exists && element.isHittable
    return ElementState(
      count: count,
      exists: exists,
      enabled: enabled,
      visible: hittable,
      hittable: hittable
    )
  }

  private static func nowMs() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000.0)
  }

  private static func requireUdid(_ value: String) throws -> String {
    let allowed = CharacterSet(charactersIn: "0123456789abcdefABCDEF-")
    guard value.count == 36, value.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
      throw RemoteServiceHelperFailure.invalidConfiguration("invalid simulator UDID")
    }
    return value
  }

  private static func requireHash(_ value: String) throws -> String {
    guard value.count == 64, value.allSatisfy({ $0.isHexDigit }) else {
      throw RemoteServiceHelperFailure.invalidConfiguration("invalid SHA-256 input")
    }
    return value.lowercased()
  }

  private static func requireBoundedRemainingMs(_ value: String) throws -> Int64 {
    guard let parsed = Int64(value), parsed >= 100, parsed <= 900_000 else {
      throw RemoteServiceHelperFailure.invalidConfiguration("invalid remaining monotonic budget")
    }
    return parsed
  }

  private static func requireDirectChild(_ path: URL, of root: URL, label: String) throws {
    guard path.deletingLastPathComponent().standardizedFileURL.path == root.standardizedFileURL.path else {
      throw RemoteServiceHelperFailure.invalidConfiguration("\(label) is outside private artifact root")
    }
  }

  private static func requirePrivateArtifactRoot(_ root: URL) throws {
    let attributes = try FileManager.default.attributesOfItem(atPath: root.path)
    let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
    guard permissions & 0o777 == 0o700 else {
      throw RemoteServiceHelperFailure.invalidConfiguration("artifact root is not mode 0700")
    }
  }
}

final class RemoteServicePromptHelperTests: XCTestCase {
  func testObserveAndDismissSavePasswordPrompt() {
    do {
      let run = try RemoteServiceRunConfiguration()
      do {
        try run.write(run.execute())
      } catch {
        if let receipt = run.failureReceipt(error) {
          try? run.write(receipt)
        }
        XCTFail(String(describing: error))
      }
    } catch {
      XCTFail(String(describing: error))
    }
  }
}
