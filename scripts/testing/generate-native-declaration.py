#!/usr/bin/env python3
"""Generate the portable source declaration, never runtime passing evidence."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/qa/native-pilot/inventory.json"
SOURCE_PATHS = {
    "auth-doc": "docs/screens/v2/SC-217-auth-sign-in.md",
    "account-doc": "docs/screens/v2/SC-213-account-privacy-settings.md",
    "training-doc": "docs/screens/v2/SC-208-training-plan-builder.md",
    "connection-doc": "docs/screens/v2/SC-211-relationship-management.md",
    "pro-doc": "docs/screens/v2/SC-204-professional-home-dashboard.md",
    "roster-doc": "docs/screens/v2/SC-205-student-roster.md",
    "use-cases": "docs/use-cases/UC-002-role-onboarding-and-care-management.md",
    "acceptance": "docs/acceptance-criteria/AC-002-role-journeys-and-plan-ownership.md",
    "rules": "docs/business-rules/BR-002-role-assignment-and-plan-governance.md",
    "test-cases": "docs/test-cases/TC-002-role-and-assignment-controls.md",
    "plan": "docs/plans/2026-09-28-testing-structure-and-maestro-plan.md",
    "native-contract-doc": "docs/qa/native-pilot/declaration-contract.md",
    "auth-source": "app/auth/sign-in.tsx",
    "session-source": "features/auth/server-auth-source.ts",
    "account-source": "app/settings/account.tsx",
    "training-source": "app/professional/training/plans/[planId].tsx",
    "library-source": "features/plans/plan-source.ts",
    "exercise-source": "components/ds/patterns/ExerciseSearchModal.tsx",
    "connection-source": "app/student/professionals.tsx",
    "connection-observation-source": "scripts/testing/native-connection-observation.ts",
    "connection-snapshot-source": "scripts/testing/native-connection-snapshot.ts",
    "connection-snapshot-schema-source": "scripts/testing/schemas/connection-snapshot-v1.schema.json",
    "connection-checkpoints-source": "scripts/testing/native-connection-checkpoints.ts",
    "session-profile-checkpoints-source": "scripts/testing/native-session-profile-checkpoints.ts",
    "connection-hierarchy-source": "scripts/testing/native-connection-hierarchy.ts",
    "connection-attempt-binding-source": "scripts/testing/native-connection-attempt-binding.ts",
    "connection-journey-source": "scripts/testing/native-connection-journey.ts",
    "connection-journey-core-source": "scripts/testing/native-connection-journey-core.ts",
    "connection-platform-contract-source": "scripts/testing/native-connection-platform-contract.ts",
    "connection-public-evidence-source": "scripts/testing/native-connection-public-evidence.ts",
    "connection-public-evidence-core-source": "scripts/testing/native-connection-public-evidence-core.ts",
    "ios-connection-adapter-source": "scripts/testing/run-ios-connection-attempt.ts",
    "ios-t16-owned-entrypoint-source": "scripts/testing/t16b-owned-ios-native-entrypoint.ts",
    "t16-owned-bootstrap-source": "scripts/testing/t16b-owned-maestro-bootstrap.ts",
    "t16-owned-runtime-source": "scripts/testing/t16b-owned-maestro-runtime.ts",
    "t16-owned-mcp-connector-source": "scripts/testing/t16b-owned-maestro-mcp-connector.ts",
    "t16-owned-exploration-controller-source": "scripts/testing/t16b-owned-exploration-controller.ts",
    "t16-outer-cleanup-binding-source": "scripts/testing/t16b-outer-cleanup-binding.ts",
    "t16-owned-production-entrypoint-source": "scripts/testing/run-t16-owned-exploration.ts",
    "t16-owned-package-source": "package.json",
    "exploration-preparation-source": "scripts/testing/prepare-exploration.ts",
    "exploration-budget-policy-source": "scripts/testing/exploration-budget-policy.ts",
    "t16-owned-mcp-stdio-source": "scripts/testing/owned-maestro-mcp-stdio.ts",
    "android-connection-adapter-source": "scripts/testing/run-android-connection-attempt.ts",
    "android-connection-hierarchy-source": "scripts/testing/native-connection-hierarchy-android.ts",
    "android-connection-public-evidence-source": "scripts/testing/native-connection-public-evidence-android.ts",
    "connection-password-offer-witness-source": "scripts/testing/native-connection-password-offer-witness.ts",
    "ios-detox-connection-sidecar-source": "scripts/testing/detox-connection-ancestor-safe.py",
    "detox-artifact-root-source": "scripts/testing/detox-connection-artifact-root.ts",
    "detox-result-writer-source": "scripts/testing/detox-connection-result-writer.ts",
    "native-pilot-invocation-source": "scripts/testing/native-pilot-invocation.ts",
    "testing-repository-identity-source": "scripts/testing/testing-repository-identity.ts",
    "ios-cold-reset-producer-source": "scripts/testing/t15-cold-ios-reset-producer.ts",
    "ios-cold-reset-child-consumer-source": "scripts/testing/t15-cold-reset-child-consumption.ts",
    "ios-cold-reset-handoff-source": "scripts/testing/t15-cold-reset-handoff.ts",
    "ios-cold-runtime-link-source": "scripts/testing/t15-cold-runtime-link.ts",
    "t15-cold-dispatcher-source": "scripts/testing/t15-cold-dispatcher.ts",
    "t15-cold-owned-lifecycle-source": "scripts/testing/t15-cold-owned-lifecycle.ts",
    "t15-cold-production-runner-source": "scripts/testing/t15-cold-production-runner.ts",
    "t15-cold-ios-family-attempt-source": "scripts/testing/t15-cold-ios-family-attempt.ts",
    "t15-cold-android-maestro-build-reuse-source": "scripts/testing/t15-cold-android-maestro-build-reuse.ts",
    "t15-cold-android-maestro-family-attempt-source": "scripts/testing/t15-cold-android-maestro-family-attempt.ts",
    "t15-cold-android-maestro-public-finalizer-source": "scripts/testing/t15-cold-android-maestro-public-finalizer.ts",
    "t15-cold-android-maestro-public-consumer-source": "scripts/testing/t15-cold-android-maestro-public-consumer.ts",
    "native-comparison-source": "scripts/testing/compare-native-pilot.ts",
    "ios-detox-connection-public-bridge-source": "scripts/testing/native-detox-connection-public-bridge.ts",
    "ios-detox-connection-public-dispatch-source": "scripts/testing/native-detox-connection-public-dispatch.ts",
    "ios-detox-connection-public-staging-source": "scripts/testing/native-detox-connection-public-staging.ts",
    "ios-detox-training-public-dispatch-source": "scripts/testing/native-detox-training-public-dispatch.ts",
    "ios-detox-training-public-finalization-source": "scripts/testing/native-detox-training-public-finalization.ts",
    "native-detox-training-public-finalization-contract-source": "scripts/testing/native-detox-training-public-finalization-contract.ts",
    "detox-training-public-types-source": "scripts/testing/native-detox-training-public-types.ts",
    "native-detox-dispatch-lifecycle-source": "scripts/testing/native-detox-dispatch-lifecycle.ts",
    "android-detox-connection-public-dispatch-source": "scripts/testing/native-detox-connection-android-public-dispatch.ts",
    "android-detox-connection-public-staging-source": "scripts/testing/native-detox-connection-android-public-staging.ts",
    "android-detox-connection-producer-source": "scripts/testing/detox-android-connection-producer.ts",
    "android-detox-connection-cleanup-source": "scripts/testing/verify-owned-android-detox-connection-cleanup.ts",
    "android-detox-session-producer-source": "scripts/testing/detox-android-session-producer.ts",
    "android-detox-session-adapter-source": "scripts/testing/native-detox-android-session-public-adapter.ts",
    "android-detox-session-route-source": "scripts/testing/native-detox-android-session-native-pilot-route.ts",
    "android-detox-session-finalization-source": "scripts/testing/native-detox-android-session-public-finalization.ts",
    "android-detox-session-staging-source": "scripts/testing/native-detox-android-session-public-staging.ts",
    "native-connection-engine-contract-source": "scripts/testing/native-connection-engine-contract.ts",
    # Detox runtime qualification metadata and producer/verifier are explicit
    # declaration inputs. Runtime closure discovery alone is not a source row,
    # so freshness must bind these exact files to the iOS Detox scenario.
    "ios-detox-connection-runtime-dispatch-source": "scripts/testing/native-detox-connection-runtime-dispatch.ts",
    "ios-detox-connection-runtime-producer-source": "scripts/testing/native-detox-connection-runtime-producer.ts",
    "ios-detox-connection-runtime-verification-source": "scripts/testing/native-detox-connection-runtime-verification.ts",
    "detox-runtime-build-metadata-source": "scripts/testing/detox-runtime-build-metadata.ts",
    "android-connection-terminal-projection-source": "scripts/testing/run-ios-training-attempt.ts",
    "android-runner-slot-source": "scripts/ci/android-runner-slot.ts",
    "connection-view-verifier-source": "scripts/testing/native-view-evidence.ts",
    "testing-start-here-source": "docs/plans/2026-09-29-testing-modernization-start-here.md",
    "testing-handoff-source": "docs/plans/2026-09-29-testing-modernization-implementation-handoff.md",
    "pending-source": "app/professional/pending.tsx",
    "roster-source": "app/professional/students.tsx",
    "home-source": "app/professional/home.tsx",
    "lock-source": "scripts/ci/run-with-native-host-lock.sh",
    "host-preflight-source": "scripts/testing/native-host-contention.ts",
    "pilot-contract-source": "scripts/testing/native-pilot-contract.ts",
    "native-runtime-preflight-source": "scripts/testing/native-runtime-preflight.ts",
    "native-build-reuse-source": "scripts/testing/native-build-reuse.ts",
    "ios-incremental-build-cache-source": "scripts/testing/native-ios-incremental-build-cache.ts",
    "native-build-identity-source": "scripts/testing/native-build-identity.ts",
    "public-runner-source": "scripts/testing/run-native-pilot.ts",
    "runner-wrapper-source": "scripts/testing/run-native-pilot.sh",
    "node-wrapper-source": "scripts/testing/run-native-pilot.mjs",
    "owned-process-group-source": "scripts/testing/owned-process-group.ts",
    "owned-native-command-source": "scripts/testing/owned-native-command.ts",
    "public-receipt-schema-source": "scripts/testing/schemas/public-receipt-v1.schema.json",
    "schema-validator-source": "scripts/testing/schema-validation.ts",
    "native-auth-observation-source": "scripts/testing/native-auth-observation.ts",
    "ios-credential-entry-diagnostic-source": "scripts/testing/ios-credential-entry-diagnostic.ts",
    "ios-credential-entry-owned-seam-source": "scripts/testing/ios-credential-entry-owned-seam.ts",
    "ios-locale-capture-wiring-source": "scripts/testing/ios-locale-capture-wiring.ts",
    "ios-locale-runtime-adapter-source": "scripts/testing/ios-locale-runtime-adapter.ts",
    "ios-locale-storage-source": "scripts/testing/ios-locale-storage.ts",
    "ios-locale-quiescence-source": "scripts/testing/ios-locale-quiescence.ts",
    "locale-native-observation-source": "scripts/testing/locale-native-observation.ts",
    "locale-context-validator-source": "scripts/testing/locale-context-validator.ts",
    "native-locale-file-observation-source": "scripts/testing/native-locale-file-observation.ts",
    "native-locale-capture-seam-source": "scripts/testing/native-locale-capture-seam.ts",
    "inventory-validator-source": "scripts/testing/validate-native-inventory.mjs",
    "integration-preflight-source": "scripts/testing/integration-preflight.ts",
    "native-hierarchy-source": "scripts/testing/native-hierarchy.ts",
    "owned-expo-source": "scripts/testing/owned-expo.ts",
    "ios-simulator-app-source": "scripts/testing/owned-ios-simulator-app.ts",
    "declaration-source": "scripts/testing/generate-native-declaration.py",
    "maestro-training-driver": "scripts/testing/native-training-maestro-driver.ts",
    "maestro-quantity-contract": "scripts/testing/native-training-quantity-contract.ts",
    "maestro-assertion-failure-source": "scripts/testing/native-maestro-assertion-failure.ts",
    "training-journey-source": "scripts/testing/native-training-journey.ts",
    "training-evidence-source": "scripts/testing/native-training-pilot-evidence.ts",
    "training-view-verifier-source": "scripts/testing/native-view-evidence.ts",
    "training-attempt-source": "scripts/testing/native-training-attempt-binding.ts",
    "native-cleanup-evidence-source": "scripts/testing/native-cleanup-evidence.ts",
    "android-cleanup-source": "scripts/testing/verify-owned-android-cleanup.ts",
    "ios-cleanup-source": "scripts/testing/verify-owned-ios-cleanup.ts",
    "partial-backend-boundary-source": "scripts/testing/partial-backend-boundary.ts",
    "ios-training-adapter-source": "scripts/testing/run-ios-training-attempt.ts",
    "android-training-adapter-source": "scripts/testing/run-android-training-attempt.ts",
    "training-attempt-outcome-source": "scripts/testing/native-training-attempt-outcome.ts",
    "training-public-evidence-source": "scripts/testing/native-training-public-evidence.ts",
    "ios-capture-source": "scripts/testing/capture-native-testability.ts",
    "android-capture-source": "scripts/testing/capture-android-testability.ts",
    "android-session-checkpoint-copy-source": "scripts/testing/native-android-session-checkpoint-copy.ts",
    "android-driver-diagnostics-source": "scripts/testing/native-android-driver-diagnostics.ts",
    "android-driver-startup-sampling-source": "scripts/testing/native-android-driver-startup-sampling.ts",
    "android-build-identity-source": "scripts/testing/android-build-identity.ts",
    "android-input-reader-source": "scripts/testing/android-native-input-reader.ts",
    "android-input-reader-java-source": "scripts/testing/android-input-reader/InputReader.java",
    "android-input-reader-manifest-source": "scripts/testing/android-input-reader/AndroidManifest.xml",
    "android-emulator-owner-source": "scripts/testing/owned-android-emulator.ts",
    "android-port-owner-source": "scripts/testing/owned-android-port.ts",
    "ios-simulator-owner-source": "scripts/testing/owned-ios-simulator.ts",
    "adb-owner-source": "scripts/testing/owned-adb-server.ts",
    "fixture-source": "scripts/testing/owned-session.ts",
    "proxy-source": "scripts/testing/owned-api-proxy.ts",
    "camera-observer": "scripts/testing/native-camera-observation.ts",
    # Android camera remains a source-only candidate until the owned target,
    # locale file adapter, manual submission recorder and cleanup receipt are
    # qualified. These paths are still declared so freshness cannot omit the
    # producer once that runtime gate is available.
    "android-camera-capture-adapter-source": "scripts/testing/native-camera-android-capture-adapter.ts",
    "android-camera-saved-flow-source": "scripts/testing/native-camera-android-saved-flow.ts",
    "android-camera-saved-route-source": ".maestro/flows/camera-denied-android.yaml",
    "android-camera-contract-source": "scripts/testing/native-camera-android-contract.ts",
    "android-camera-observation-source": "scripts/testing/native-camera-android-observation.ts",
    "android-camera-producer-source": "scripts/testing/native-camera-android-producer.ts",
    "android-camera-runtime-locale-source": "scripts/testing/native-camera-android-runtime-locale.ts",
    "android-camera-sql-source": "scripts/testing/native-camera-android-sql-source.ts",
    "android-camera-runner-source": "scripts/testing/run-android-camera-attempt.ts",
    "android-camera-runner-core-source": "scripts/testing/run-android-camera-attempt-core.ts",
    "android-camera-public-attempt-source": "scripts/testing/run-android-camera-public-attempt.ts",
    "android-camera-public-staging-source": "scripts/testing/native-android-camera-public-staging.ts",
    # The private Android camera runtime collector/finalizer is a producer
    # input, not an inferred test-only dependency. Keep every runtime owner
    # source in the declaration so freshness rejects a stale collector or
    # finalizer before a public attempt can be selected.
    "android-camera-runtime-driver-source": "scripts/testing/native-android-camera-runtime-driver.ts",
    "android-camera-runtime-collector-source": "scripts/testing/native-android-camera-runtime-collector.ts",
    "android-camera-runtime-dispatch-source": "scripts/testing/native-android-camera-runtime-dispatch.ts",
    "android-camera-runtime-eligibility-source": "scripts/testing/native-android-camera-runtime-eligibility.ts",
    "android-camera-runtime-receipt-source": "scripts/testing/native-android-camera-runtime-receipt.ts",
    "android-camera-runtime-finalizer-source": "scripts/testing/native-android-camera-runtime-finalizer.ts",
    # The iOS integrated camera adapter and evidence validator are supplied by
    # the private camera v7 source packet before this declaration is generated.
    "ios-camera-adapter-source": "scripts/testing/run-ios-camera-attempt.ts",
    "camera-submission-evidence-source": "scripts/testing/native-camera-submission-evidence.ts",
    # Private iOS Detox camera route. These inputs are declared so a native run
    # cannot bypass freshness, descriptor-safe staging, outer verification or
    # the four-assertion terminal.
    "ios-detox-camera-contract-source": "scripts/testing/native-detox-camera-ios-contract.ts",
    "ios-detox-camera-evidence-source": "scripts/testing/native-detox-camera-ios-evidence.ts",
    "ios-detox-camera-ipc-source": "scripts/testing/native-detox-camera-ios-ipc.ts",
    "ios-detox-camera-owner-source": "scripts/testing/native-detox-camera-ios-owner.ts",
    "ios-detox-camera-producer-source": "scripts/testing/native-detox-camera-ios-producer.ts",
    "ios-detox-camera-stage-source": "scripts/testing/native-detox-camera-ios-stage.ts",
    "ios-detox-camera-current-owner-source": "scripts/testing/native-detox-camera-ios-current-owner.ts",
    "ios-detox-camera-inputs-source": "scripts/testing/native-detox-camera-ios-inputs.ts",
    "ios-detox-camera-verifier-source": "scripts/testing/native-detox-camera-ios-verifier.ts",
    "ios-detox-camera-runner-source": "scripts/testing/run-ios-detox-camera-attempt.ts",
    "ios-detox-camera-public-runner-source": "scripts/testing/run-native-pilot.ts",
    "ios-detox-camera-e2e-source": "e2e/detox-ios-camera-route.e2e.test.js",
    "ios-detox-camera-detox-config-source": "detox.camera.private.config.js",
    "ios-detox-camera-jest-config-source": "jest.detox-camera.private.config.js",
    "camera-adapter": "features/platform/qr-scanner-adapter.ts",
    "camera-permissions": "ios/mychampions/Info.plist",
    "camera-copy": "localization/en-US.ts",
    "save-retry-observer": "scripts/testing/native-save-retry-observation.ts",
    "save-retry-attempt-source": "scripts/testing/native-save-retry-attempt-binding.ts",
    "training-draft-observer-source": "scripts/testing/native-training-observation.ts",
    "ios-save-retry-adapter-source": "scripts/testing/run-ios-save-retry-attempt.ts",
    "save-retry-public-evidence-source": "scripts/testing/native-save-retry-public-evidence.ts",
    "android-save-retry-adapter-source": "scripts/testing/run-android-save-retry-attempt.ts",
    "android-save-retry-public-evidence-source": "scripts/testing/native-android-save-retry-public-evidence.ts",
    "android-session-public-contract-source": "scripts/testing/native-android-session-public-contract.ts",
    "android-session-public-dependency-source": "scripts/testing/native-android-session-public-dependency.ts",
    "android-session-public-receipt-source": "scripts/testing/native-android-session-public-receipt.ts",
    "android-session-public-dispatch-source": "scripts/testing/native-android-session-public-dispatch.ts",
    "android-session-public-staging-source": "scripts/testing/native-android-session-public-staging.ts",
    "android-session-public-adapter-source": "scripts/testing/run-android-session-attempt.ts",
    "ios-session-adapter-source": "scripts/testing/run-ios-session-attempt.ts",
    "ios-session-post-tap-diagnostic-source": "scripts/testing/ios-session-post-tap-diagnostic.ts",
    "session-helper-ledger-source": "scripts/testing/native-session-helper-ledger.ts",
    "session-public-finalization-source": "scripts/testing/native-session-public-finalization.ts",
    "session-public-dependency-source": "scripts/testing/native-session-public-dependency.ts",
    "session-public-staging-source": "scripts/testing/native-session-public-staging.ts",
    "exit-guard-source": "features/plans/use-plan-exit-guard.ts",
    "discard-observer": "scripts/testing/native-training-discard-observation.ts",
    "edit-observer": "scripts/testing/native-training-edit-observation.ts",
    "load-observer": "scripts/testing/native-training-load-observation.ts",
}

# These are static inputs of the public Detox dispatcher. They are source rows
# rather than an unbound owner-path list, so selection can verify their bytes
# before any public receipt/runtime artifact acquisition. The generated
# inventory remains the sole self-referential owner-path exception.
DETOX_DISPATCH_STATIC_SOURCE_PATHS = {
    "detox-dispatch-android-session-charter-source": "scripts/testing/android-session-charter.ts",
    "detox-dispatch-android-session-storage-producer-source": "scripts/testing/detox-android-session-storage-producer.ts",
    "detox-dispatch-connection-actionability-source": "scripts/testing/detox-connection-actionability.ts",
    "detox-dispatch-connection-evidence-source": "scripts/testing/detox-connection-evidence.ts",
    "detox-dispatch-connection-ipc-source": "scripts/testing/detox-connection-ipc.ts",
    "detox-dispatch-connection-lifecycle-source": "scripts/testing/detox-connection-lifecycle.ts",
    "detox-dispatch-integrated-connection-baseline-source": "scripts/testing/detox-integrated-connection-baseline.ts",
    "detox-dispatch-integrated-connection-driver-source": "scripts/testing/detox-integrated-connection-driver.ts",
    "detox-dispatch-integrated-session-baseline-source": "scripts/testing/detox-integrated-session-baseline.ts",
    "detox-dispatch-android-qualified-build-source": "scripts/testing/detox-android-qualified-build.ts",
    "detox-dispatch-native-hierarchy-source": "scripts/testing/detox-native-hierarchy.ts",
    "detox-dispatch-session-cache-observation-source": "scripts/testing/detox-session-cache-observation.ts",
    "detox-dispatch-session-cancel-evidence-source": "scripts/testing/detox-session-cancel-evidence.ts",
    "detox-dispatch-session-final-transport-source": "scripts/testing/detox-session-final-transport.ts",
    "detox-dispatch-training-child-client-source": "scripts/testing/detox-training-child-client.ts",
    "detox-dispatch-training-child-protocol-source": "scripts/testing/detox-training-child-protocol.mjs",
    "detox-dispatch-training-journey-source": "scripts/testing/detox-training-journey.ts",
    "detox-dispatch-training-owned-dispatch-source": "scripts/testing/detox-training-owned-dispatch.ts",
    "detox-dispatch-native-android-session-adapter-source": "scripts/testing/native-android-session-adapter.ts",
    "detox-dispatch-android-session-producer-source": "scripts/testing/detox-android-session-producer.ts",
    "detox-dispatch-android-session-adapter-source": "scripts/testing/native-detox-android-session-public-adapter.ts",
    "detox-dispatch-android-session-route-source": "scripts/testing/native-detox-android-session-native-pilot-route.ts",
    "detox-dispatch-android-session-finalization-source": "scripts/testing/native-detox-android-session-public-finalization.ts",
    "detox-dispatch-android-session-staging-source": "scripts/testing/native-detox-android-session-public-staging.ts",
}
SOURCE_PATHS.update(DETOX_DISPATCH_STATIC_SOURCE_PATHS)

# V10's iOS camera producer imports the complete shared session/Detox closure.
# Bind every discovered owner path to an actual source revision so the public
# selector cannot accept an owner that is absent from the generated declaration.
IOS_CAMERA_RUNTIME_CLOSURE_SOURCE_PATHS = {
    "detox-dispatch-save-retry-child-client-source": "scripts/testing/detox-save-retry-child-client.ts",
    "detox-dispatch-save-retry-child-protocol-source": "scripts/testing/detox-save-retry-child-protocol.mjs",
    "detox-dispatch-save-retry-driver-source": "scripts/testing/detox-save-retry-driver.ts",
    "detox-dispatch-save-retry-owned-dispatch-source": "scripts/testing/detox-save-retry-owned-dispatch.ts",
    "detox-dispatch-save-retry-runtime-finalizer-source": "scripts/testing/detox-save-retry-runtime-finalizer.ts",
    "ios-camera-runtime-session-native-pilot-route-source": "scripts/testing/native-detox-session-native-pilot-route.ts",
    "ios-camera-runtime-session-public-adapter-source": "scripts/testing/native-detox-session-public-adapter.ts",
    "ios-camera-runtime-session-public-staging-source": "scripts/testing/native-detox-session-public-staging.ts",
    "ios-camera-runtime-pilot-preflight-source": "scripts/testing/native-pilot-preflight.ts",
    "ios-camera-runtime-remote-service-helper-source": "scripts/testing/ios-detox-camera-remote-service-helper.ts",
    "ios-camera-runtime-remote-service-route-source": "scripts/testing/native-detox-camera-ios-remote-service-route.ts",
}
SOURCE_PATHS.update(IOS_CAMERA_RUNTIME_CLOSURE_SOURCE_PATHS)

# Shared session dependencies are also reached by the iOS camera owner. Bind
# them explicitly before graph generation so every discovered owner has a
# revision, regardless of the selected engine/platform.
SESSION_COLD_RUNTIME_SOURCE_PATHS = {
    "android-camera-identity-source": "scripts/testing/native-detox-camera-android-identity.ts",
    "android-cold-reset-producer-source": "scripts/testing/t15-cold-android-reset-producer.ts",
    "android-session-cold-route-source": "scripts/testing/t15-detox-android-session-cold-route.ts",
    "android-session-normalization-source": "scripts/testing/t15-detox-android-session-normalization.ts",
    "android-session-public-receipt-bridge-source": "scripts/testing/t15-detox-android-session-public-receipt-bridge.ts",
    "android-session-reset-preparation-source": "scripts/testing/t15-detox-android-session-reset-preparation.ts",
    "detox-cold-lifecycle-source": "scripts/testing/t15-detox-cold-lifecycle.ts",
}
SOURCE_PATHS.update(SESSION_COLD_RUNTIME_SOURCE_PATHS)

# The public runner imports this camera route on both platforms. Bind every
# discovered owner explicitly; missing revisions remain a generation error.
ANDROID_DETOX_CAMERA_RUNTIME_SOURCE_PATHS = {
    "android-camera-runtime-detox-child-source": "e2e/detox-android-camera-denied.e2e.test.js",
    "android-camera-runtime-detox-instrumentation-source": "android/app/src/androidTest/java/com/eduardo880/mychampions/DetoxTest.java",
    "android-camera-runtime-permission-bridge-source": "android/app/src/androidTest/java/com/edufelip/mychampions/DetoxCameraPermissionBridge.java",
    "android-camera-runtime-android-detox-camera-cold-reset-boundary-source": "scripts/testing/android-detox-camera-cold-reset-boundary.ts",
    "android-camera-runtime-native-detox-camera-android-bridge-source": "scripts/testing/native-detox-camera-android-bridge.ts",
    "android-camera-runtime-native-detox-camera-android-contract-source": "scripts/testing/native-detox-camera-android-contract.ts",
    "android-camera-runtime-native-detox-camera-android-native-pilot-route-source": "scripts/testing/native-detox-camera-android-native-pilot-route.ts",
    "android-camera-runtime-native-detox-camera-android-owned-session-source": "scripts/testing/native-detox-camera-android-owned-session.ts",
    "android-camera-runtime-native-detox-camera-android-producer-source": "scripts/testing/native-detox-camera-android-producer.ts",
    "android-camera-runtime-native-detox-camera-android-public-dispatch-source": "scripts/testing/native-detox-camera-android-public-dispatch.ts",
    "android-camera-runtime-native-detox-camera-android-public-finalizer-source": "scripts/testing/native-detox-camera-android-public-finalizer.ts",
    "android-camera-runtime-native-detox-camera-android-q-adapter-source": "scripts/testing/native-detox-camera-android-q-adapter.ts",
    "android-camera-runtime-native-detox-camera-android-reset-independent-source": "scripts/testing/native-detox-camera-android-reset-independent.ts",
    "android-camera-runtime-native-detox-camera-android-reset-source": "scripts/testing/native-detox-camera-android-reset.ts",
}
SOURCE_PATHS.update(ANDROID_DETOX_CAMERA_RUNTIME_SOURCE_PATHS)


VIEWS = [
    ("SCR-sign-in", "Email sign-in", "screen", "auth-doc auth-source"),
    ("SCR-pro-home", "Professional home", "screen", "pro-doc home-source"),
    ("SCR-student-home", "Student home", "screen", "connection-doc connection-source"),
    ("SCR-account", "Account settings", "screen", "account-doc account-source"),
    ("STATE-signout-confirm", "Sign-out confirmation", "modal", "account-doc account-source"),
    ("STATE-password-save", "iOS credential-save prompt", "system-prompt", "native-contract-doc auth-source plan"),
    ("SCR-training-library", "Professional training library", "screen", "training-doc library-source"),
    ("SCR-training-builder", "Training builder", "screen", "training-doc training-source"),
    ("STATE-session-editor", "Add session form", "state", "training-doc training-source"),
    ("STATE-exercise-search", "Exercise search sheet", "sheet", "training-doc exercise-source"),
    ("STATE-exercise-detail", "Exercise detail and quantity", "state", "training-doc exercise-source"),
    ("STATE-training-save-error", "Failed save with retained draft", "state", "training-doc training-source exit-guard-source save-retry-observer camera-copy plan"),
    ("STATE-training-load-error", "Builder load error", "state", "training-doc training-source load-observer proxy-source"),
    ("STATE-native-text-edit-menu", "Native text selection menu", "system-prompt", "training-doc training-source maestro-training-driver native-contract-doc"),
    ("STATE-item-removal-confirm", "Exercise removal confirmation", "modal", "training-doc training-source edit-observer camera-copy"),
    ("STATE-discard-confirm", "Unsaved draft discard", "modal", "training-doc training-source discard-observer camera-copy"),
    ("SCR-student-professionals", "Student relationships", "screen", "connection-doc connection-source"),
    ("SCR-pro-pending", "Professional pending requests", "screen", "connection-doc pending-source"),
    ("SCR-pro-roster", "Professional roster", "screen", "roster-doc roster-source"),
    ("STATE-connection-pending", "Student pending confirmation", "state", "connection-doc connection-source"),
    ("STATE-connection-active", "Student active assignment", "state", "connection-doc connection-source"),
    ("STATE-camera-prompt", "OS camera prompt", "system-prompt", "use-cases connection-source camera-observer camera-adapter camera-permissions"),
    ("STATE-camera-guidance", "Camera denied or unavailable guidance", "state", "use-cases connection-doc connection-source camera-observer camera-adapter camera-copy"),
]

# ID, source view, destination view, action, branch kind, governing sources.
TRANSITIONS = [
    ("password-save-offer", "SCR-pro-home", "STATE-password-save", "iOS offers credential saving after normal sign-in", "external", "native-contract-doc auth-source plan"),
    ("password-save-decline", "STATE-password-save", "SCR-pro-home", "Decline using the iOS Not Now control", "external", "native-contract-doc auth-source plan"),
    ("login", "SCR-sign-in", "SCR-pro-home", "Sign in as seeded coach", "guarded", "auth-doc auth-source session-source"),
    ("restore", "SCR-pro-home", "SCR-pro-home", "Terminate/relaunch; restore locked role session", "guarded", "test-cases session-source"),
    ("account", "SCR-pro-home", "SCR-account", "Open account tab", "normal", "account-doc account-source"),
    ("signout-open", "SCR-account", "STATE-signout-confirm", "Choose sign out", "normal", "account-doc account-source"),
    ("signout-cancel", "STATE-signout-confirm", "SCR-account", "Cancel sign out", "normal", "account-doc account-source"),
    ("signout", "STATE-signout-confirm", "SCR-sign-in", "Confirm sign out; relaunch remains signed out", "guarded", "account-doc account-source session-source"),
    ("training-library", "SCR-pro-home", "SCR-training-library", "Open training tab", "normal", "training-doc home-source"),
    ("training-new", "SCR-training-library", "SCR-training-builder", "Create local plan draft", "normal", "training-doc training-source"),
    ("session-open", "SCR-training-builder", "STATE-session-editor", "Add first session", "normal", "training-doc training-source"),
    ("session-confirm", "STATE-session-editor", "SCR-training-builder", "Confirm named session without backend write", "normal", "training-doc training-source"),
    ("exercise-open", "SCR-training-builder", "STATE-exercise-search", "Search local catalog", "normal", "training-doc exercise-source"),
    ("exercise-select", "STATE-exercise-search", "STATE-exercise-detail", "Choose exact catalog exercise ID", "normal", "training-doc exercise-source"),
    ("exercise-confirm", "STATE-exercise-detail", "SCR-training-builder", "Confirm quantity and notes into draft", "normal", "training-doc exercise-source"),
    ("save", "SCR-training-builder", "SCR-training-library", "Save draft through normal server route", "normal", "training-doc training-source"),
    ("title-selection-open", "SCR-training-builder", "STATE-native-text-edit-menu", "Open normal native text selection", "external", "training-doc training-source maestro-training-driver"),
    ("title-selection-clear", "STATE-native-text-edit-menu", "SCR-training-builder", "Select all and clear the editable title", "normal", "training-doc training-source maestro-training-driver"),
    ("title-paragraph-select", "SCR-training-builder", "SCR-training-builder", "Select entire editable title with normal paragraph gesture", "external", "training-doc training-source maestro-training-driver"),
    ("title-paragraph-clear", "SCR-training-builder", "SCR-training-builder", "Backspace selected title and require entirely empty value", "guarded", "training-doc training-source maestro-training-driver"),
    ("item-remove-open", "SCR-training-builder", "STATE-item-removal-confirm", "Request exercise item removal", "guarded", "training-doc training-source edit-observer camera-copy"),
    ("item-remove-confirm", "STATE-item-removal-confirm", "SCR-training-builder", "Confirm local exercise removal", "guarded", "training-doc training-source edit-observer camera-copy"),
    ("edit", "SCR-training-library", "SCR-training-builder", "Reopen and edit owned plan", "normal", "training-doc training-source"),
    ("reload-plan", "SCR-training-library", "SCR-training-builder", "Relaunch/reopen persisted exact values", "guarded", "training-doc training-source"),
    ("save-failure", "SCR-training-builder", "STATE-training-save-error", "Save with one private pre-forward rejection", "error", "plan training-source exit-guard-source save-retry-observer proxy-source"),
    ("save-retry", "STATE-training-save-error", "SCR-training-library", "Remove fault and retry retained draft", "normal", "plan training-doc training-source exit-guard-source save-retry-observer"),
    ("load-failure", "SCR-training-library", "STATE-training-load-error", "Supported failed builder read", "error", "training-doc training-source"),
    ("load-retry", "STATE-training-load-error", "SCR-training-builder", "Retry recoverable read", "normal", "training-doc training-source"),
    ("back-dirty", "SCR-training-builder", "STATE-discard-confirm", "Leave dirty draft", "guarded", "training-doc training-source"),
    ("keep-draft", "STATE-discard-confirm", "SCR-training-builder", "Cancel discard", "normal", "training-doc training-source"),
    ("discard", "STATE-discard-confirm", "SCR-training-library", "Confirm discard", "normal", "training-doc training-source"),
    ("student-login", "SCR-sign-in", "SCR-student-home", "Sign in as seeded student", "guarded", "auth-doc auth-source session-source"),
    ("relationships", "SCR-student-home", "SCR-student-professionals", "Open connections", "normal", "connection-doc connection-source"),
    ("submit-code", "SCR-student-professionals", "STATE-connection-pending", "Submit live specialty code through UI", "normal", "connection-doc use-cases connection-source"),
    ("switch-coach", "STATE-connection-pending", "SCR-pro-pending", "Sign out/login coach and open pending queue", "guarded", "connection-doc pending-source account-source"),
    ("confirm-connection", "SCR-pro-pending", "SCR-pro-roster", "Coach confirms exact pending student", "normal", "connection-doc roster-doc pending-source roster-source"),
    ("switch-student", "SCR-pro-roster", "STATE-connection-active", "Sign out/login student; verify active assignment", "guarded", "connection-doc connection-source account-source"),
    ("camera-request", "SCR-student-professionals", "STATE-camera-prompt", "Open scanner after camera permission reset", "external", "use-cases connection-source"),
    ("camera-deny", "STATE-camera-prompt", "STATE-camera-guidance", "Deny using platform system permission control", "external", "use-cases connection-source"),
    ("camera-manual", "STATE-camera-guidance", "STATE-connection-pending", "Submit manual code after denial", "normal", "use-cases connection-doc connection-source"),
]

FAMILIES = {
    "session": ("SCR-sign-in", "login restore account signout-open signout", "auth-doc account-doc test-cases plan", "coach", "auth-source session-source account-source", ["SC-217", "SC-213", "TC-296", "BL-018/P4-session", "FR-270", "BR-342", "AC-539", "TC-333"]),
    "training": ("SCR-pro-home", "training-library training-new session-open session-confirm exercise-open exercise-select exercise-confirm save edit title-paragraph-select title-paragraph-clear item-remove-open item-remove-confirm exercise-open exercise-select exercise-confirm save reload-plan", "training-doc test-cases acceptance rules plan", "coach", "training-source exercise-source library-source", ["SC-208", "TC-278", "TC-303", "BL-018/P4-training"]),
    "connection": ("SCR-sign-in", "student-login relationships submit-code switch-coach confirm-connection switch-student", "connection-doc pro-doc roster-doc use-cases acceptance rules test-cases plan", "student coach", "connection-source connection-observation-source connection-snapshot-source connection-snapshot-schema-source connection-checkpoints-source connection-hierarchy-source connection-attempt-binding-source connection-journey-source connection-journey-core-source connection-platform-contract-source connection-public-evidence-source connection-public-evidence-core-source connection-view-verifier-source fixture-source proxy-source integration-preflight-source native-build-identity-source home-source testing-start-here-source testing-handoff-source pending-source roster-source account-source", ['SC-211', 'UC-002.3', 'FR-120', 'FR-217', 'TC-213', 'TC-214', 'SC-204', 'FR-121', 'AC-213', 'AC-214', 'BR-213', 'BR-230', 'FR-107', 'AC-204', 'BR-204', 'FR-105', 'AC-206', 'TC-206', 'FR-122', 'BR-214', 'AC-215']),
    "camera-denied": ("SCR-sign-in", "student-login relationships camera-request camera-deny camera-manual", "connection-doc use-cases plan", "student", "connection-source", ["SC-211", "UC-002.9", "BL-018/P4-camera-denied"]),
    "save-retry": ("SCR-pro-home", "training-library training-new session-open session-confirm exercise-open exercise-select exercise-confirm save-failure save-retry reload-plan", "training-doc test-cases rules plan", "coach", "training-source exercise-source proxy-source", ["SC-208", "TC-303", "BL-018/P4-save-retry"]),
}


# T14-B shared purposes. These declarations are required outcomes, not executions.
TRAINING_ASSERTIONS = [
    ("normal-entry", ["SC-208"], ["ui", "api"], "Fresh owned coach and canonical catalog; no created plan", "Sign in normally, open library and new builder", "Correct coach role and usable builder; native sign-in/catalog reach the owned normal API"),
    ("local-draft", ["SC-208", "TC-303"], ["ui", "sql"], "Unsaved new builder", "Enter unique QA training attempt title, Strength session, canonical exercise and 3x8", "Exact draft values; no durable plan change before Save"),
    ("first-save", ["SC-208", "TC-278", "TC-303"], ["ui", "api", "sql"], "Valid unsaved draft", "Save once and reopen from normal library", "One owned created plan with exact title/session/exercise/3x8; UI, authenticated read and SQL agree"),
    ("edit-draft", ["SC-208", "TC-303"], ["ui", "sql"], "Reopened first-save plan", "Change title to original plus updated and quantity to 4x10", "Exact edited draft; durable state remains first-save values until explicit Save"),
    ("edited-save", ["SC-208", "TC-278", "TC-303"], ["ui", "api", "sql"], "Valid edited draft", "Save and reopen the same plan", "Same plan identity and ownership, updated title/4x10 in UI/API/SQL, no duplicate plan"),
    ("relaunch-read", ["SC-208", "TC-278"], ["ui", "api", "sql"], "Edited save settled", "Terminate/relaunch app, restart only owned API, reopen normally", "Same persisted identity/title/session/exercise/4x10 after restart; normal authenticated read and SQL agree"),
    ("unrelated-state", ["SC-208", "TC-303"], ["sql"], "Baseline fixed scoped snapshot retained", "Compare unrelated seeded records at write checkpoints and final state", "No unrelated mutation; exactly one intended new plan owned by the acting coach"),
]

def training_assertions():
    return [{"id": "NAT-training-" + ident, "requirementRefs": requirements,
             "requirementPaths": [SOURCE_PATHS["training-doc"], SOURCE_PATHS["test-cases"]],
             "evidenceKinds": kinds, "startingState": start, "action": action,
             "expected": expected,
             "evidencePathTemplates": ["assertions/{attemptId}/" + ident + "-" + kind + ".private.json" for kind in kinds]}
            for ident, requirements, kinds, start, action, expected in TRAINING_ASSERTIONS]


# T14-A shared purposes; the native session contract proves local native
# restoration/clearing per the owner decision of 2026-10-03. Native server
# revocation is outside scope; the browser contract remains unchanged.
SESSION_ASSERTIONS = [
    ("login", ["SC-217", "TC-296"], ["ui", "api"],
     "Fresh owned Postgres fixture with a signed-out coach and completed onboarding",
     "Sign in once with the seeded coach credentials through the rendered native UI",
     "The locked coach role/home is visible, exactly one native sign-in succeeds through the owned API, and the authenticated identity is bound to the same fixture coach"),
    ("restore", ["SC-217", "TC-296"], ["ui", "api"],
     "Successful native coach sign-in with the local bearer session persisted",
     "Terminate and relaunch the app without entering credentials; hydrate the profile through the normal authenticated route",
     "The same coach role/home is restored, the owned API observes the authenticated hydrate, and no second sign-in is sent"),
    ("account", ["SC-213"], ["ui"],
     "Restored coach home with an active local native session",
     "Open Account, open the sign-out confirmation, then cancel it",
     "The account screen and exact confirmation/cancel controls are visible and cancel leaves the session active"),
    ("signout", ["SC-213", "BL-018/P4-session", "FR-270", "BR-342", "AC-539", "TC-333"], ["ui", "api"],
     "Active restored coach session with the sign-out confirmation closed after cancellation",
     "Reopen the sign-out confirmation and confirm sign-out through the normal native UI once",
     "Sign-in is visible, local native session metadata is absent, authenticated native identity is cleared, and this native row does not claim server revocation"),
    ("signed-out-relaunch", ["SC-213", "TC-296", "FR-270", "BR-342", "AC-539", "TC-333"], ["ui", "api"],
     "Confirmed local native sign-out with persisted session metadata absent",
     "Terminate and relaunch the app without credentials",
     "Sign-in remains visible, no role/session is restored, and no authenticated hydrate follows the signed-out relaunch"),
    ("unrelated-state", ["TC-296"], ["sql"],
     "Scoped domain SQL baseline captured before the session journey",
     "Compare the declared domain snapshots before and after login, restoration and local sign-out",
     "Complete owned profile and domain rows remain identical except the verified fixture coach updatedAt may advance only across separately bound sign-in POST 201 and restore hydrate POST 200 spans; after restoration all fields are strictly unchanged through logout/relaunch; auth-session records remain outside the declared domain-mutation scope"),
]


def session_assertions():
    return [{"id": "NAT-session-" + ident, "requirementRefs": requirements,
             "requirementPaths": [SOURCE_PATHS["auth-doc"], SOURCE_PATHS["account-doc"], SOURCE_PATHS["test-cases"], SOURCE_PATHS["plan"]],
             "evidenceKinds": kinds, "startingState": start, "action": action,
             "expected": expected,
             "evidencePathTemplates": ["assertions/{attemptId}/" + ident + "-" + kind + ".private.json" for kind in kinds]}
            for ident, requirements, kinds, start, action, expected in SESSION_ASSERTIONS]


# T14-E shared purposes; private inventory observations are not public attempts.
SAVE_RETRY_ASSERTIONS = [
    ("error", ["SC-208", "TC-303"], ["ui", "api"], "Fresh owned coach with valid unsaved Native QA Draft / Strength / canonical exercise / 3x8", "Save once with one account-scoped pre-forward POST 503", "Actual native save error and exactly one matching injected request; no forwarded failing write"),
    ("retained-draft", ["SC-208", "TC-303"], ["ui", "sql"], "Failed save and baseline snapshot retained", "Dismiss the error and inspect the still-editable draft", "Exact title/session/exercise/3x8 and enabled Save remain; failed SQL equals baseline"),
    ("final-save", ["SC-208", "TC-303"], ["ui", "api", "sql"], "Same retained valid draft; scoped fault removed", "Retry Save once through the normal owned API", "Exactly one new owned durable plan, one forwarded POST 201 and its intended PATCH 200; no duplicate mutation"),
    ("reopen", ["SC-208", "TC-303"], ["ui", "api", "sql"], "Successful retry settled in normal library", "Open the exact newly saved library row through a normal detail GET", "Same plan identity/title/Strength/exercise/3x8; reopened SQL equals saved state and no additional write"),
    ("unrelated-state", ["SC-208", "TC-303"], ["sql"], "Original scoped plans/connections captured before fault", "Compare baseline, failed, saved and reopened snapshots", "No prior plan or connection mutation; exactly one intended new plan owned by the acting coach"),
]


# The native capture producers hash a complete helper input set. Keep the
# declaration owner paths derived from those same real module entry points so
# adding an imported helper cannot silently leave inventory freshness stale.
# Checked-in route source is selected by inventory and never promotes runtime evidence.
MAESTRO_FLOWS = {
    "SCN-camera-denied-android": ".maestro/flows/camera-denied-android.yaml",
}
NATIVE_CLOSURE_ENTRY_POINTS = {
    "save-retry": {
        "ios": [
            "scripts/testing/capture-native-testability.ts",
            "scripts/testing/run-ios-save-retry-attempt.ts",
        ],
        "android": [
            "scripts/testing/capture-android-testability.ts",
            "scripts/testing/run-android-save-retry-attempt.ts",
            "scripts/testing/native-android-save-retry-public-evidence.ts",
        ],
    },
    # Session freshness binds each actual platform runner and owned capture helper.
    "session": {
        "ios": [
            "scripts/testing/capture-native-testability.ts",
            "scripts/testing/ios-session-post-tap-diagnostic.ts",
            "scripts/testing/run-ios-session-attempt.ts",
        ],
        "android": [
            "scripts/testing/capture-android-testability.ts",
            "scripts/testing/run-android-session-attempt.ts",
            "scripts/testing/native-detox-android-session-native-pilot-route.ts",
            "scripts/testing/native-detox-android-session-public-adapter.ts",
            "scripts/testing/native-detox-android-session-public-finalization.ts",
            "scripts/testing/native-detox-android-session-public-staging.ts",
            "scripts/testing/detox-android-session-producer.ts",
            "scripts/testing/detox-android-connection-producer.ts",
            "scripts/testing/verify-owned-android-detox-connection-cleanup.ts",
        ],
    },
    # Camera uses the real iOS adapter/evidence path and the Android candidate
    # adapter/runner closure. The declaration remains source-only until both
    # platform producers return original descriptor-backed receipts.
    "camera-denied": {
        "ios": [
            "scripts/testing/capture-native-testability.ts",
            "scripts/testing/run-ios-camera-attempt.ts",
            "scripts/testing/run-native-pilot.ts",
            "scripts/testing/run-ios-detox-camera-attempt.ts",
            "scripts/testing/native-detox-camera-ios-contract.ts",
            "scripts/testing/native-detox-camera-ios-evidence.ts",
            "scripts/testing/native-detox-camera-ios-ipc.ts",
            "scripts/testing/native-detox-camera-ios-owner.ts",
            "scripts/testing/native-detox-camera-ios-producer.ts",
            "scripts/testing/native-detox-camera-ios-stage.ts",
            "scripts/testing/native-detox-camera-ios-current-owner.ts",
            "scripts/testing/native-detox-camera-ios-inputs.ts",
            "scripts/testing/native-detox-camera-ios-verifier.ts",
            "scripts/testing/detox-connection-evidence.ts",
            "scripts/testing/detox-connection-ancestor-safe.py",
            "e2e/detox-ios-camera-route.e2e.test.js",
            "detox.camera.private.config.js",
            "jest.detox-camera.private.config.js",
        ],
        "android": [
            "scripts/testing/capture-android-testability.ts",
            "scripts/testing/run-android-camera-attempt.ts",
            "scripts/testing/run-android-camera-public-attempt.ts",
            "scripts/testing/native-camera-android-capture-adapter.ts",
            "scripts/testing/native-camera-android-producer.ts",
            "scripts/testing/native-camera-android-runtime-locale.ts",
            "scripts/testing/native-camera-android-sql-source.ts",
            "scripts/testing/native-android-camera-runtime-driver.ts",
            "scripts/testing/native-android-camera-runtime-collector.ts",
            "scripts/testing/native-android-camera-runtime-dispatch.ts",
            "scripts/testing/native-android-camera-runtime-eligibility.ts",
            "scripts/testing/native-android-camera-runtime-receipt.ts",
            "scripts/testing/native-android-camera-runtime-finalizer.ts",
        ],
    },
    "connection": {
        "ios": [
            "scripts/testing/capture-native-testability.ts",
            "scripts/testing/run-ios-connection-attempt.ts",
            "scripts/testing/native-connection-journey.ts",
        ],
        "android": [
            "scripts/testing/capture-android-testability.ts",
            "scripts/testing/run-android-connection-attempt.ts",
            "scripts/testing/native-connection-journey.ts",
        ],
    },
    "training": {
        "ios": [
            "scripts/testing/capture-native-testability.ts",
            "scripts/testing/run-ios-training-attempt.ts",
            "scripts/testing/native-training-journey.ts",
        ],
        "android": [
            "scripts/testing/capture-android-testability.ts",
            "scripts/testing/run-android-training-attempt.ts",
            "scripts/testing/native-training-journey.ts",
        ],
    },
}
LOCAL_IMPORT_PATTERN = re.compile(
    r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'](\.{1,2}/[^"']+)["']'''
)
NATIVE_AUXILIARY_INPUTS = {
    # The iOS Detox connection writer launches this Python sidecar by path;
    # it is not discoverable through the TypeScript local-import parser.
    ("connection", "ios"): [
        "scripts/testing/detox-connection-ancestor-safe.py",
    ],
}

ANDROID_READER_SUPPLEMENTAL = [
    "scripts/testing/android-input-reader/AndroidManifest.xml",
    "scripts/testing/android-input-reader/InputReader.java",
]


def save_retry_assertions():
    return [{"id": "NAT-save-retry-" + ident, "requirementRefs": requirements,
             "requirementPaths": [SOURCE_PATHS["training-doc"], SOURCE_PATHS["test-cases"]],
             "evidenceKinds": kinds, "startingState": start, "action": action,
             "expected": expected,
             "evidencePathTemplates": ["assertions/{attemptId}/" + ident + "-" + kind + ".private.json" for kind in kinds]}
            for ident, requirements, kinds, start, action, expected in SAVE_RETRY_ASSERTIONS]


# T14-D shared purposes; camera denial is a real native permission branch and
# the manual code must reach the owned server after the denial.
CAMERA_DENIED_ASSERTIONS = [
    ("normal-entry", ["SC-211", "UC-002.9"], ["ui", "api", "sql"],
     "Fresh owned Postgres fixture with an unlinked student, live coach invite and camera permission reset",
     "Sign in as the student and open the relationships screen",
     "The relationships/manual-entry controls are visible, normal auth and relationship reads use the owned API, and the scoped SQL baseline is captured before any invite write"),
    ("denial-guidance", ["SC-211", "UC-002.9"], ["ui"],
     "Relationships screen with the target camera permission in a fresh undecided state",
     "Open the scanner and deny the platform camera permission using the system control",
     "The platform permission state is actually denied, the scanner returns safely, inline denial guidance is visible, and manual code entry remains enabled"),
    ("manual-submit", ["SC-211", "UC-002.9", "BL-018/P4-camera-denied"], ["ui", "api", "sql"],
     "Actual camera denial with guidance/manual input active and the student/coach pair still unlinked",
     "Enter the live coach invite code manually and activate Connect once",
     "Exactly one normal invite-submission request reaches the owned API, the UI shows pending confirmation, and SQL contains exactly the intended pending relationship"),
    ("unrelated-state", ["SC-211", "UC-002.9"], ["sql"],
     "Scoped connection, plan and unrelated-account baseline captured before the camera branch",
     "Compare snapshots after denial and the manual-code submission",
     "Only the intended pending connection/invite allocation changes; no unrelated account, connection, plan or other fixture row changes"),
]


CAMERA_DENIED_CANONICAL_IDS = (
    "NAT-camera-normal-entry",
    "NAT-camera-denial-guidance",
    "NAT-camera-manual-submit",
    "NAT-camera-unrelated-state",
)
CAMERA_DENIED_CANONICAL_EVIDENCE_KINDS = (
    ("ui", "api", "sql"),
    ("ui",),
    ("ui", "api", "sql"),
    ("sql",),
)


def camera_denied_assertions():
    rows = [{"id": "NAT-camera-" + ident, "requirementRefs": requirements,
             "requirementPaths": [SOURCE_PATHS["connection-doc"], SOURCE_PATHS["use-cases"], SOURCE_PATHS["plan"]],
             "evidenceKinds": kinds, "startingState": start, "action": action,
             "expected": expected,
             "evidencePathTemplates": ["assertions/{attemptId}/" + ident + "-" + kind + ".private.json" for kind in kinds]}
            for ident, requirements, kinds, start, action, expected in CAMERA_DENIED_ASSERTIONS]
    if tuple(row["id"] for row in rows) != CAMERA_DENIED_CANONICAL_IDS:
        raise RuntimeError("Camera declaration IDs differ from native-pilot-contract.ts")
    if tuple(tuple(row["evidenceKinds"]) for row in rows) != CAMERA_DENIED_CANONICAL_EVIDENCE_KINDS:
        raise RuntimeError("Camera declaration evidence kinds differ from native-pilot-contract.ts")
    return rows


# T14-C shared purposes; source declarations are not mutation or runtime evidence.
# This digest covers the ordered row semantics with assertion IDs excluded; IDs
# are independently frozen by nativeConnectionAssertionIds in the TS contract.
CONNECTION_ASSERTION_SEMANTIC_SHA256 = '83b7121c9fd74fea4f022b9a01da751aada9de5ef6678b87075105ce55b3a87d'
CONNECTION_ASSERTIONS = [
    ('normal-entry', ['SC-211', 'UC-002.3', 'FR-120', 'FR-217', 'TC-213'], ['ui', 'api', 'sql'], 'Fresh integration fixture with the unlinked mutation pair and a captured scoped SQL baseline.', 'Sign in normally as student and open relationships; sign in normally as coach and open home/pending/roster entry. Do not submit or confirm.', 'The exact relationship/pending/roster controls are present, normal auth/read requests are forwarded, and the baseline snapshot is bound to this attempt without writes.'),
    ('submit-pending', ['SC-211', 'UC-002.3', 'SC-204', 'FR-120', 'FR-121', 'AC-213', 'AC-214', 'BR-213', 'BR-230', 'TC-213'], ['ui', 'api', 'sql'], 'The exact student/coach pair is unlinked, has no same-pair pending or active connection, and the coach invite is active.', 'Acquire the invite code through the normal reviewed prerequisite, enter it in student.professionals.codeInput, and activate student.professionals.connectButton. Do not put the code in source or a public receipt.', 'Exactly one connection for the intended student/coach/specialty is pending_confirmation; no duplicate, active conflict, or unrelated row changes occur; the pending UI and server response agree.'),
    ('pending-state', ['SC-211', 'UC-002.3', 'FR-121', 'AC-214', 'BR-230', 'TC-213'], ['ui', 'api', 'sql'], 'The submit row exists for the target pair with pending_confirmation and has not been confirmed.', 'Read relationships as the student, then switch through normal sign-out/sign-in to the coach and open the pending queue and roster.', 'The exact pending identity appears in the coach queue and student pending view; pending guidance is present, the student has no End action, and no active row is shown.'),
    ('confirm-active', ['SC-211', 'UC-002.3', 'FR-121', 'AC-214', 'BR-213', 'BR-230', 'TC-214'], ['ui', 'api', 'sql'], 'The coach queue contains exactly one pending target produced by NAT-connection-submit-pending.', 'Activate the semantic confirmation control for the exact pending row; do not confirm a foreign or ambiguous row.', 'The response and persisted row both become active exactly once; pending state is released; no duplicate or unrelated row changes occur.'),
    ('active-student', ['SC-211', 'UC-002.3', 'FR-107', 'AC-204', 'AC-214', 'BR-204', 'BR-230', 'TC-214'], ['ui', 'api', 'sql'], 'The confirm response returned active for the target and the student can sign in normally.', 'Switch/sign in as the student and open relationships.', 'The intended active relationship and End action are visible exactly once; no pending duplicate remains; GET /connections and active specialty/tracking records agree.'),
    ('active-roster', ['SC-211', 'UC-002.3', 'FR-105', 'FR-107', 'AC-204', 'AC-206', 'BR-204', 'TC-206', 'TC-214'], ['ui', 'api', 'sql'], 'The target connection is active and the coach can sign in normally.', 'Open the coach roster and exit the pending view through semantic navigation.', 'The roster contains the exact student once as active fitness_coach, the student is absent from pending, and UI/API/SQL identities agree.'),
    ('unrelated-state', ['SC-211', 'FR-122', 'BR-214', 'AC-215'], ['sql'], 'Capture all scoped connection, invite, pending, access, specialty, and unrelated rows before submission.', 'Compare before, pending, active, and final snapshots while retaining the request history and exact target identity.', 'Exactly one intended connection lifecycle and its expected auxiliary allocation/release/access rows change; no unrelated account, connection, invite, specialty, plan, or other fixture record changes.'),
]


def connection_assertions():
    return [{"id": "NAT-connection-" + ident, "requirementRefs": requirements,
             "requirementPaths": [SOURCE_PATHS["connection-doc"], SOURCE_PATHS["pro-doc"], SOURCE_PATHS["use-cases"], SOURCE_PATHS["acceptance"], SOURCE_PATHS["rules"], SOURCE_PATHS["test-cases"], SOURCE_PATHS["plan"]],
             "evidenceKinds": kinds, "startingState": start, "action": action,
             "expected": expected,
             "evidencePathTemplates": ["assertions/{attemptId}/" + ident + "-" + kind + ".private.json" for kind in kinds]}
            for ident, requirements, kinds, start, action, expected in CONNECTION_ASSERTIONS]


def refs(names):
    return ["SRC-" + name for name in names.split()]


def _local_import_path(importer, specifier):
    absolute = (ROOT / importer).parent / specifier
    try:
        relative = absolute.resolve().relative_to(ROOT.resolve())
    except ValueError:
        return None
    candidates = [relative]
    if not relative.suffix:
        candidates.extend(Path(str(relative) + extension) for extension in (".ts", ".tsx", ".js", ".mjs", ".json"))
        candidates.extend(
            relative / ("index" + extension)
            for extension in (".ts", ".tsx", ".js", ".mjs", ".json")
        )
    for candidate in candidates:
        if (ROOT / candidate).is_file():
            return candidate.as_posix()
    raise RuntimeError(f"Unresolved local native declaration import: {importer} -> {specifier}")


def native_source_closure(family, platform):
    queue = list(NATIVE_CLOSURE_ENTRY_POINTS[family][platform])
    closure = set()
    while queue:
        current = queue.pop()
        if current in closure:
            continue
        current_path = ROOT / current
        if not current_path.is_file():
            raise RuntimeError(f"Missing native declaration closure input: {current}")
        closure.add(current)
        source = current_path.read_text()
        for specifier in LOCAL_IMPORT_PATTERN.findall(source):
            target = _local_import_path(current, specifier)
            # The native owner graph can cross the testing scripts root for
            # declared source inputs such as localized copy. Keep every
            # resolved local edge in the closure; scenario_owner_paths maps
            # only paths with an explicit SOURCE_PATHS row into the inventory.
            if target:
                queue.append(target)
    if "scripts/testing/android-native-input-reader.ts" in closure:
        closure.update(ANDROID_READER_SUPPLEMENTAL)
    closure.update(NATIVE_AUXILIARY_INPUTS.get((family, platform), []))
    return sorted(closure)


def unique_paths(paths):
    return list(dict.fromkeys(paths))


def capture_helper_paths(platform):
    if platform == "ios":
        relative = "scripts/testing/native-session-helper-ledger.ts"
        source = (ROOT / relative).read_text()
        start_marker = "export const nativeSessionHelperInputPaths = Object.freeze(["
        end_marker = "] as const);"
    elif platform == "android":
        relative = "scripts/testing/capture-android-testability.ts"
        source = (ROOT / relative).read_text()
        start_marker = "  const helperPaths = ["
        end_marker = "\n  ];\n  const helperIdentity"
    else:
        raise RuntimeError(f"Unsupported native helper platform: {platform}")
    start = source.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Missing helper declaration start in {relative}")
    end = source.find(end_marker, start + len(start_marker))
    if end < 0:
        raise RuntimeError(f"Missing helper declaration end in {relative}")
    raw = re.findall(r"[\"']([^\"']+)[\"']", source[start + len(start_marker):end])
    values = [
        value
        if value.startswith("scripts/") or value.startswith(".maestro/") or value == "package.json"
        else f"scripts/testing/{value}"
        for value in raw
    ]
    if not values or len(values) != len(set(values)):
        raise RuntimeError(f"Duplicate or empty {platform} capture helper declaration")
    for value in values:
        if not (
            value == "package.json"
            or value.startswith("scripts/testing/")
            or value.startswith("scripts/ci/")
            or value.startswith(".maestro/")
        ):
            raise RuntimeError(f"Unsupported {platform} capture helper path: {value}")
        if ".." in value.split("/") or not (ROOT / value).is_file():
            raise RuntimeError(f"Missing or unsafe {platform} capture helper path: {value}")
    return values


def detox_dispatch_runtime_paths():
    relative = "scripts/testing/native-detox-connection-public-dispatch.ts"
    source = (ROOT / relative).read_text()
    match = re.search(r"export const detoxDispatchRuntimeClosure = \[([\s\S]*?)\] as const;", source)
    if not match:
        raise RuntimeError("Missing explicit Detox dispatch runtime closure")
    paths = re.findall(r"'([^']+)'", match.group(1))
    if not paths or len(paths) != len(set(paths)):
        raise RuntimeError("Duplicate or empty Detox dispatch runtime closure")
    for relative in paths:
        if relative.startswith("/") or ".." in relative.split("/") or not (ROOT / relative).is_file():
            raise RuntimeError(f"Missing or unsafe Detox dispatch runtime input: {relative}")
    return paths



def detox_training_dispatch_runtime_paths():
    relative = "scripts/testing/native-detox-training-public-dispatch.ts"
    source = (ROOT / relative).read_text()
    match = re.search(r"export const detoxTrainingDispatchRuntimeClosure = \[([\s\S]*?)\] as const;", source)
    if not match:
        raise RuntimeError("Missing explicit Detox training dispatch runtime closure")
    paths = re.findall(r"'([^']+)'", match.group(1))
    if not paths or len(paths) != len(set(paths)):
        raise RuntimeError("Duplicate or empty Detox training dispatch runtime closure")
    for relative in paths:
        if relative.startswith("/") or ".." in relative.split("/") or not (ROOT / relative).is_file():
            raise RuntimeError(f"Missing or unsafe Detox training runtime input: {relative}")
    return paths

def scenario_owner_paths(owner_keys, family, platform):
    keys = unique_paths(owner_keys.split())
    paths = [SOURCE_PATHS[key] for key in keys]
    if family in NATIVE_CLOSURE_ENTRY_POINTS:
        paths.extend(native_source_closure(family, platform))
    paths.extend(capture_helper_paths(platform))
    if (family, platform) == ("connection", "ios"):
        # The generated inventory is a runtime input, so its path belongs here.
        # It is deliberately not a SOURCE_PATHS row: embedding its own byte hash
        # into the generated JSON would create a recursive revision. Runtime
        # dispatch hashes the finished inventory after generation.
        paths.extend(detox_dispatch_runtime_paths())
    if (family, platform) == ("training", "ios"):
        paths.extend(detox_training_dispatch_runtime_paths())
    return unique_paths(paths)


def flowcharts(value):
    view_map = {row["id"]: row for row in value["views"]}
    transition_map = {row["id"]: row for row in value["transitions"]}
    lines = ["# Native pilot source flowcharts", "", "Generated with `generate-native-declaration.py`. Every node and edge is declared only; local runtime receipts are not imported into this portable graph. These diagrams are not test results. The overview retains recovery candidates and the iOS credential-save setup branch outside the five core baseline paths.", ""]
    groups = [("Overview", value["transitions"])] + [(row["name"], [transition_map[ident] for ident in row["transitionIds"]]) for row in value["flows"]]
    for title, edges in groups:
        lines += ["## " + title, "", "```mermaid", "flowchart TD"]
        used = list(dict.fromkeys(ident for edge in edges for ident in [edge["fromViewId"], edge["toViewId"]] if ident))
        for ident in used:
            label = view_map[ident]["name"].replace('"', "'")
            lines.append(f'  {ident.replace("-", "_")}["{label} / source only"]')
        for edge in edges:
            if edge["toViewId"]:
                label = (edge["action"] + " / " + edge["kind"]).replace('"', "'")
                lines.append(f'  {edge["fromViewId"].replace("-", "_")} -. "{label}" .-> {edge["toViewId"].replace("-", "_")}')
        lines += ["```", ""]
    OUT.with_name("flowcharts.md").write_text("\n".join(lines))


def main():
    sources = []
    for name, relative in SOURCE_PATHS.items():
        data = (ROOT / relative).read_bytes()
        kind = "source" if name.endswith("source") else {"use-cases": "use-case", "rules": "rule", "test-cases": "test-case"}.get(name, "requirement")
        sources.append({"id": "SRC-" + name, "kind": kind, "ref": relative, "paths": [relative], "revision": hashlib.sha256(data).hexdigest()})
    views = [{"id": ident, "name": name, "kind": kind, "captureStatus": "source-discovered", "sourceRefs": refs(src), "ownerPaths": [SOURCE_PATHS[x] for x in src.split() if x.endswith("source")], "receiptIds": []} for ident, name, kind, src in VIEWS]
    transitions = [{"id": "TRN-" + ident, "fromViewId": start, "toViewId": end, "action": action, "kind": kind, "status": "discovered", "sourceRefs": refs(src), "receiptIds": []} for ident, start, end, action, kind, src in TRANSITIONS]
    for row in views:
        if row["id"] == "STATE-password-save":
            row["conditions"] = {"platforms": ["ios"], "locale": "en-US", "state": "fresh simulator credential-save offer; decline does not sign out"}
            row["captureStatus"] = "unverified"
    for row in transitions:
        if row["id"].startswith("TRN-password-save-"):
            row["conditions"] = {"platforms": ["ios"]}
    flows, scenarios = [], []
    for family, (entry, steps, src, roles, owners, requirements) in FAMILIES.items():
        owners += " host-preflight-source pilot-contract-source public-runner-source runner-wrapper-source node-wrapper-source declaration-source owned-process-group-source owned-native-command-source public-receipt-schema-source schema-validator-source native-cleanup-evidence-source detox-artifact-root-source detox-result-writer-source native-pilot-invocation-source"
        if family == "session":
            owners += " session-profile-checkpoints-source connection-snapshot-source connection-snapshot-schema-source native-auth-observation-source connection-view-verifier-source fixture-source proxy-source"
        if family == "training":
            owners += " training-journey-source training-evidence-source training-view-verifier-source training-attempt-source training-attempt-outcome-source proxy-source edit-observer maestro-training-driver"
        if family == "save-retry":
            owners += " save-retry-observer save-retry-attempt-source training-draft-observer-source training-view-verifier-source training-attempt-outcome-source fixture-source proxy-source"
        transition_ids = ["TRN-" + step for step in steps.split()]
        flows.append({"id": "FLW-" + family, "name": family, "entryViewId": entry, "transitionIds": transition_ids, "sourceRefs": refs(src)})
        for platform in ["ios", "android"]:
            ident = f"SCN-{family}-{platform}"
            # Both capture ledgers hash this producer, including iOS-only families.
            # Both capture ledgers hash the checkpoint producer and the shared
            # iOS session ledger/finalizer boundary. Keep their SourcePaths
            # explicit so declaration freshness cannot omit string-backed inputs.
            scenario_owners = owners + " android-session-checkpoint-copy-source session-helper-ledger-source session-public-finalization-source session-public-dependency-source session-public-staging-source testing-repository-identity-source"
            if platform == "ios":
                scenario_owners += " ios-cold-reset-producer-source ios-cold-reset-child-consumer-source ios-cold-reset-handoff-source ios-cold-runtime-link-source t15-cold-dispatcher-source t15-cold-owned-lifecycle-source t15-cold-production-runner-source t15-cold-ios-family-attempt-source native-comparison-source"
                # The iOS capture producer hashes its complete script closure, including
                # the shared Android input-reader/runner dependencies imported by owned
                # lifecycle helpers. Keep these freshness inputs explicit even though no
                # Android runtime is acquired by this iOS scenario.
                scenario_owners += " ios-capture-source ios-simulator-owner-source adb-owner-source ios-cleanup-source native-runtime-preflight-source native-build-identity-source native-build-reuse-source maestro-quantity-contract maestro-assertion-failure-source ios-connection-adapter-source native-auth-observation-source android-build-identity-source android-emulator-owner-source android-port-owner-source android-runner-slot-source android-input-reader-source android-input-reader-java-source android-input-reader-manifest-source save-retry-observer inventory-validator-source"
                if family == "training":
                    scenario_owners += " ios-training-adapter-source training-public-evidence-source"
                if family == "save-retry":
                    scenario_owners += " ios-save-retry-adapter-source save-retry-public-evidence-source ios-training-adapter-source"
                if family == "connection":
                    scenario_owners += " connection-password-offer-witness-source ios-detox-connection-public-bridge-source ios-detox-connection-public-dispatch-source ios-detox-connection-public-staging-source"
                    scenario_owners += " ios-t16-owned-entrypoint-source t16-owned-bootstrap-source t16-owned-runtime-source t16-owned-mcp-connector-source t16-owned-exploration-controller-source t16-outer-cleanup-binding-source t16-owned-production-entrypoint-source t16-owned-package-source exploration-preparation-source exploration-budget-policy-source t16-owned-mcp-stdio-source"
                    dispatch_paths = set(detox_dispatch_runtime_paths())
                    scenario_owners += " " + " ".join(
                        key for key, relative in SOURCE_PATHS.items() if relative in dispatch_paths
                    )
                if family == "session":
                    scenario_owners += " ios-session-adapter-source"
                if family == "camera-denied":
                    scenario_owners += " ios-camera-adapter-source camera-submission-evidence-source"
                    scenario_owners += " ios-detox-camera-contract-source ios-detox-camera-evidence-source ios-detox-camera-ipc-source ios-detox-camera-owner-source ios-detox-camera-producer-source ios-detox-camera-stage-source ios-detox-camera-current-owner-source ios-detox-camera-inputs-source ios-detox-camera-verifier-source ios-detox-camera-runner-source ios-detox-camera-public-runner-source ios-detox-camera-e2e-source ios-detox-camera-detox-config-source ios-detox-camera-jest-config-source"
                    scenario_owners += " detox-dispatch-integrated-session-baseline-source detox-dispatch-connection-evidence-source detox-dispatch-native-hierarchy-source owned-native-command-source camera-observer proxy-source fixture-source"
            else:
                scenario_owners += " android-capture-source android-driver-diagnostics-source android-driver-startup-sampling-source android-build-identity-source native-build-identity-source native-build-reuse-source android-emulator-owner-source android-port-owner-source adb-owner-source android-cleanup-source native-runtime-preflight-source android-connection-adapter-source android-connection-hierarchy-source android-connection-public-evidence-source android-runner-slot-source android-input-reader-source android-input-reader-java-source android-input-reader-manifest-source save-retry-observer inventory-validator-source"
                if family == "camera-denied":
                    scenario_owners += " android-camera-capture-adapter-source android-camera-saved-flow-source android-camera-saved-route-source android-camera-contract-source android-camera-observation-source android-camera-producer-source android-camera-runtime-locale-source android-camera-sql-source android-camera-runner-source android-camera-runner-core-source android-camera-runtime-driver-source android-camera-runtime-collector-source android-camera-runtime-dispatch-source android-camera-runtime-eligibility-source android-camera-runtime-receipt-source android-camera-runtime-finalizer-source ios-locale-capture-wiring-source ios-locale-runtime-adapter-source ios-locale-storage-source ios-locale-quiescence-source locale-native-observation-source locale-context-validator-source native-locale-file-observation-source native-locale-capture-seam-source proxy-source fixture-source connection-snapshot-source connection-snapshot-schema-source connection-view-verifier-source"
                if family == "save-retry":
                    scenario_owners += " android-save-retry-adapter-source android-save-retry-public-evidence-source"
                if family == "connection":
                    scenario_owners += " android-connection-terminal-projection-source android-detox-connection-public-dispatch-source android-detox-connection-public-staging-source android-detox-connection-producer-source android-detox-connection-cleanup-source native-connection-engine-contract-source detox-dispatch-integrated-connection-driver-source detox-dispatch-android-qualified-build-source"
                if family == "training":
                    scenario_owners += " android-training-adapter-source training-public-evidence-source"
            owner_keys = unique_paths(scenario_owners.split())
            if family in NATIVE_CLOSURE_ENTRY_POINTS:
                closure_paths = set(native_source_closure(family, platform))
                owner_keys = unique_paths(
                    owner_keys
                    + [
                        key
                        for key, relative in SOURCE_PATHS.items()
                        if relative in closure_paths
                    ]
                )
            owner_paths = scenario_owner_paths(" ".join(owner_keys), family, platform)
            # inventory.json is the sole recursive input: dispatch binds its
            # final bytes after generation. Every other owner must have both a
            # source revision; selection validates all declared source bytes.
            declared_owner_paths = set(SOURCE_PATHS.values())
            missing_revisions = sorted(
                relative for relative in owner_paths
                if relative != "docs/qa/native-pilot/inventory.json"
                and relative not in declared_owner_paths
            )
            if missing_revisions:
                raise RuntimeError(
                    f"{ident} owner paths lack source revisions: {', '.join(missing_revisions)}"
                )

            scenario = {"id": ident, "flowId": "FLW-" + family, "transitionIds": transition_ids, "platform": platform, "roles": roles.split(), "dataMode": "postgres", "fixtureRef": f"owned-postgres:{ident}:fresh-attempt", "behaviorStatus": "untested", "freshness": "unknown", "readiness": "remediation", "requirementRefs": requirements, "ownerPaths": owner_paths, "freshnessInputs": {"sourceIds": refs(src + " " + " ".join(owner_keys)), "requirementPaths": [SOURCE_PATHS[x] for x in src.split()], "ownerPaths": owner_paths.copy()}, "receiptIds": [], "tags": ["native-pilot", "integration", family, platform], "nextAction": "Qualify owned build/target/reset/networking and actual accessibility tree before authoring Maestro YAML."}
            if ident in MAESTRO_FLOWS:
                scenario["maestroFlow"] = MAESTRO_FLOWS[ident]
                scenario["maestroFlowSha256"] = hashlib.sha256(
                    (ROOT / MAESTRO_FLOWS[ident]).read_bytes()
                ).hexdigest()
            scenarios.append(scenario)
    for scenario in scenarios:
        if scenario["flowId"] == "FLW-session":
            scenario["pilotAssertions"] = session_assertions()
        if scenario["flowId"] == "FLW-training":
            scenario["pilotAssertions"] = training_assertions()
        if scenario["flowId"] == "FLW-save-retry":
            scenario["pilotAssertions"] = save_retry_assertions()
        if scenario["flowId"] == "FLW-connection":
            scenario["pilotAssertions"] = connection_assertions()
        if scenario["flowId"] == "FLW-camera-denied":
            scenario["pilotAssertions"] = camera_denied_assertions()
        if "pilotAssertions" in scenario:
            contract = {"dataMode": "postgres", "count": len(scenario["pilotAssertions"]), "sha256": hashlib.sha256(json.dumps(scenario["pilotAssertions"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()}
            if scenario["flowId"] == "FLW-connection":
                semantic_rows = [{key: child for key, child in row.items() if key != "id"} for row in scenario["pilotAssertions"]]
                semantic_sha = hashlib.sha256(json.dumps(semantic_rows, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
                if semantic_sha != CONNECTION_ASSERTION_SEMANTIC_SHA256:
                    raise RuntimeError("Connection assertion semantic digest changed; update the frozen contract deliberately")
                contract["semanticSha256"] = semantic_sha
            scenario["pilotAssertionContract"] = contract
    sha = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
    value = {"schemaVersion": "1.0", "run": {"id": "mychampions-native-pilot-declaration-v1", "createdAt": "2026-09-28T00:00:00Z", "updatedAt": "2026-09-28T00:00:00Z", "commit": sha, "dirty": True, "build": "unknown", "target": "native-dev-pilot-unqualified", "device": "unknown", "purpose": "Portable source declaration; no runtime passing evidence. Dates identify the plan edition, not an execution."}, "boundary": {"surfaces": ["native; five pilot families"], "platforms": ["ios", "android"], "roles": ["coach", "student"], "flags": ["integrated operation-under-test bypasses disabled"], "locales": ["en-US", "pt-BR", "es-ES"], "exclusions": ["whole-product coverage", "physical-device/provider/store acceptance", "TC-270 assigned-copy native branch", "TC-295 unlocked onboarding restart", "QR success/invalid payload branches", "response-lost-after-commit idempotency"]}, "sources": sources, "views": views, "transitions": transitions, "flows": flows, "scenarios": scenarios, "receipts": [], "blockers": ["Current owned build/target qualification and both-platform accessibility evidence pending."]}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(value, indent=2) + "\n")
    flowcharts(value)
    print(f"Declared {len(views)} source views, {len(transitions)} transitions and {len(scenarios)} scenarios; no runtime passes.")


if __name__ == "__main__":
    main()
