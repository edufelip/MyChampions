package com.edufelip.mychampions;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;

import androidx.annotation.Nullable;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import androidx.test.uiautomator.BySelector;

import org.json.JSONObject;

import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * The single Android Detox instrumentation owner uses this helper when the
 * camera-denied charter is explicitly enabled. It observes the real Android
 * permission-controller surface with UiAutomator; it never clicks by bounds or
 * changes permission state with a synthetic shell command.
 */
final class DetoxCameraPermissionBridge {
  static final String ENABLED = "enabled";
  static final String PREFERENCES_NAME = "detox.camera.bridge.v1";
  static final String KEY_ENABLED = "detoxCameraBridge";
  static final String KEY_CAPTURE_RUN_ID = "detoxCameraCaptureRunId";
  static final String KEY_OWNER_RUN_ID = "detoxCameraOwnerRunId";
  static final String KEY_ATTEMPT_ID = "detoxCameraAttemptId";
  static final String KEY_SERIAL = "detoxCameraSerial";
  static final String KEY_APP_ID = "detoxCameraAppId";
  static final String KEY_LOCALE = "detoxCameraLocale";
  static final String KEY_DEADLINE = "detoxCameraDeadlineAtEpochMs";
  static final String KEY_CANCEL_RELATIVE_PATH = "detoxCameraCancelRelativePath";
  static final String[] PERMISSION_CONTROLLERS = {
      "com.android.permissioncontroller",
      "com.google.android.permissioncontroller"
  };
  static final String CAMERA_PERMISSION = Manifest.permission.CAMERA;
  static final int MAX_FRAME_BYTES = 16 * 1024 * 1024;
  static final int MAX_RECEIPT_BYTES = 256 * 1024;
  static final long POLL_MS = 50L;
  static final long JOIN_MS = 5000L;

  private static final Pattern TITLE_PATTERN = Pattern.compile(
      "(?iu).*(?:camera|take pictures|record video|c[aá]mara|c[aâ]mera|c[aá]mera).*"
  );
  private static final Pattern DENY_PATTERN = Pattern.compile(
      "(?iu)^(?:don't allow|don’t allow|deny|n(?:ã|a)o permitir|não permitir|negar|no permitir|denegar)$"
  );

  private final Context targetContext;
  private final UiDevice device;
  @Nullable private volatile BridgeConfiguration configuration;
  private final AtomicBoolean stopRequested = new AtomicBoolean(false);
  private volatile Thread worker;
  private volatile Throwable childFailure;
  private volatile BridgeState state = BridgeState.NOT_STARTED;
  private volatile String failureCode = "none";
  // Bounded stage/class diagnostics distinguish bridge mechanics without
  // publishing app text, user data, stack traces, or system UI contents.
  private volatile String bridgeStage = "not-started";
  private volatile String bridgeErrorClass = "none";
  private volatile long observedAtEpochMs;
  private volatile PromptObservation prompt;
  private volatile FileReceipt entryHierarchy;
  private volatile FileReceipt entryScreenshot;
  private volatile FileReceipt promptHierarchy;
  private volatile FileReceipt promptScreenshot;
  private volatile FileReceipt deniedHierarchy;
  private volatile FileReceipt deniedScreenshot;
  private volatile FileReceipt manualHierarchy;
  private volatile FileReceipt manualScreenshot;
  private volatile String permissionBefore = "unknown";
  private volatile String permissionAfter = "unknown";
  private volatile boolean receiptWritten = false;
  private final long startedAtEpochMs = System.currentTimeMillis();

  private enum BridgeState {
    NOT_STARTED,
    WAITING,
    OBSERVED,
    BLOCKED,
    CANCELLED,
    DEADLINE,
    COMPLETE,
  }

  private DetoxCameraPermissionBridge(
      Context targetContext,
      UiDevice device,
      @Nullable BridgeConfiguration configuration
  ) {
    this.targetContext = targetContext;
    this.device = device;
    this.configuration = configuration;
  }

  /**
   * Detox instrumentation starts before device.launchApp provides the run-bound
   * intent extras. The owned runner writes a strict, run-bound configuration
   * before instrumentation starts; do not clear that target-private handoff.
   * Direct instrumentation arguments remain a matching fallback.
   */
  static DetoxCameraPermissionBridge fromInstrumentation(
      Context targetContext,
      UiDevice device
  ) {
    android.os.Bundle args = androidx.test.platform.app.InstrumentationRegistry.getArguments();
    return new DetoxCameraPermissionBridge(
        targetContext,
        device,
        configurationFromValues(targetContext, new ConfigurationValues() {
          @Override public String get(String key) { return args.getString(key); }
        })
    );
  }

  @Nullable
  private static BridgeConfiguration configurationFromValues(
      Context targetContext,
      ConfigurationValues values
  ) {
    if (!ENABLED.equals(values.get(KEY_ENABLED))) return null;
    String captureRunId = requireRunId(values.get(KEY_CAPTURE_RUN_ID), "captureRunId");
    String ownerRunId = requireRunId(values.get(KEY_OWNER_RUN_ID), "ownerRunId");
    String attemptId = values.get(KEY_ATTEMPT_ID);
    if (!(ownerRunId + ":first").equals(attemptId))
      throw new IllegalArgumentException("detoxCameraAttemptId must be the first owned attempt");
    String serial = requireSerial(values.get(KEY_SERIAL));
    String appId = requireAppId(targetContext.getPackageName());
    String expectedAppId = values.get(KEY_APP_ID);
    if (!appId.equals(expectedAppId))
      throw new IllegalArgumentException("detoxCameraAppId does not match the target package");
    String locale = values.get(KEY_LOCALE);
    if (!("en-US".equals(locale) || "pt-BR".equals(locale) || "es-ES".equals(locale)))
      throw new IllegalArgumentException("detoxCameraLocale is unsupported");
    String rawDeadline = values.get(KEY_DEADLINE);
    long deadline;
    try {
      deadline = Long.parseLong(rawDeadline == null ? "" : rawDeadline);
    } catch (NumberFormatException error) {
      throw new IllegalArgumentException("detoxCameraDeadlineAtEpochMs is invalid", error);
    }
    long now = System.currentTimeMillis();
    if (deadline <= now || deadline - now > 600_000L)
      throw new IllegalArgumentException("detoxCameraDeadlineAtEpochMs is outside the owned window");

    // This test image does not provision a usable private files directory for
    // the separately installed test APK. UiAutomator may write from the
    // instrumentation process, but the instrumented development app is the
    // authoritative, run-as-readable evidence owner.
    File files = targetContext.getFilesDir();
    File canonicalFiles;
    try {
      canonicalFiles = files.getCanonicalFile();
    } catch (IOException error) {
      throw new IllegalArgumentException("camera bridge parent could not be canonicalized", error);
    }
    requirePrivateDirectory(canonicalFiles);
    final int targetUid;
    try {
      targetUid = lstatPrivate(canonicalFiles).st_uid;
    } catch (IOException error) {
      throw new IllegalArgumentException("camera bridge target owner cannot be read", error);
    }
    File root = containedChild(canonicalFiles, "detox-camera/" + captureRunId);
    File cancel = containedChild(
        root,
        safeRelative(values.get(KEY_CANCEL_RELATIVE_PATH))
    );
    return new BridgeConfiguration(
        captureRunId,
        ownerRunId,
        attemptId,
        serial,
        appId,
        locale,
        deadline,
        targetUid,
        root,
        cancel
    );
  }

  @Nullable
  private BridgeConfiguration loadLaunchConfiguration() {
    android.content.SharedPreferences preferences = targetContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE
    );
    return configurationFromValues(targetContext, new ConfigurationValues() {
      @Override public String get(String key) { return preferences.getString(key, null); }
    });
  }

  private BridgeConfiguration requireConfiguration() {
    BridgeConfiguration current = configuration;
    if (current == null) throw new IllegalStateException("camera bridge launch configuration is unavailable");
    return current;
  }

  void start() {
    if (!state.equals(BridgeState.NOT_STARTED)) throw new IllegalStateException("bridge already started");
    state = BridgeState.WAITING;
    bridgeStage = configuration == null ? "waiting-for-launch-config" : "waiting-for-prompt";
    worker = new Thread(this::observe, "detox-camera-permission-bridge");
    worker.setDaemon(true);
    worker.start();
  }

  void finish(@Nullable Throwable failure) {
    childFailure = failure;
    stopRequested.set(true);
    Thread current = worker;
    if (current != null && current != Thread.currentThread()) {
      BridgeConfiguration currentConfiguration = configuration;
      long remaining = currentConfiguration == null
          ? JOIN_MS
          : Math.max(1L, Math.min(JOIN_MS, currentConfiguration.deadlineAtEpochMs - System.currentTimeMillis()));
      try {
        current.join(remaining);
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        setFailureCode("cancelled");
      }
      if (current.isAlive()) {
        setFailureCode("deadline");
        current.interrupt();
      }
    }
    if (configuration == null || receiptWritten) return;
    if (failure != null && (state == BridgeState.WAITING || state == BridgeState.OBSERVED)) {
      state = BridgeState.BLOCKED;
      setFailureCode("child-failed");
    }
    if (failure == null && state == BridgeState.WAITING) {
      state = BridgeState.BLOCKED;
      setFailureCode("prompt-not-dismissed");
    }
    writeReceipt();
  }

  void requireCompleted() {
    if (configuration == null) return;
    if (state != BridgeState.COMPLETE || !receiptWritten)
      throw new AssertionError("Android camera semantic bridge did not produce a complete receipt");
  }

  private void observe() {
    try {
      while (!stopRequested.get()) {
        if (configuration == null) {
          bridgeStage = "waiting-for-launch-config";
          BridgeConfiguration launched = loadLaunchConfiguration();
          if (launched == null) {
            SystemClock.sleep(POLL_MS);
            continue;
          }
          // Publish the validated binding before creating its directory so a
          // creation failure still has enough identity to emit a bounded marker.
          configuration = launched;
          mkdirPrivate(launched.artifactRoot);
        }
        checkDeadlineAndCancellation();
        bridgeStage = "waiting-for-prompt";
        if (targetAppVisible() && (!frameExists(entryHierarchy) || !frameExists(entryScreenshot))) {
          bridgeStage = "capturing-entry";
          entryHierarchy = captureHierarchy("entry");
          entryScreenshot = captureScreenshot("entry");
        }
        if (prompt == null) {
          bridgeStage = "finding-prompt";
          PromptObservation candidate = findPrompt();
          if (candidate != null) {
            bridgeStage = "checking-permission-before";
            permissionBefore = permissionState();
            if (!"denied".equals(permissionBefore)) {
              fail("permission-precondition");
              return;
            }
            prompt = candidate;
            bridgeStage = "capturing-prompt";
            promptHierarchy = captureHierarchy("prompt");
            promptScreenshot = captureScreenshot("prompt");
            bridgeStage = "denying-prompt";
            candidate.deny.click();
            bridgeStage = "waiting-for-dismissal";
            waitForPromptGone(candidate.systemPackage);
            // The disappearance of the owning PermissionController is the
            // only bridge lifecycle fence required here. The independently
            // owned Detox child continues its authenticated app assertions;
            // waiting for a second UiAutomator foreground signal has proven
            // unreliable on Android 17 despite the target already advancing.
            bridgeStage = "checking-permission-after";
            permissionAfter = permissionState();
            if (!"denied".equals(permissionAfter)) {
              fail("permission-outcome");
              return;
            }
            bridgeStage = "capturing-denied";
            deniedHierarchy = captureHierarchy("denied");
            deniedScreenshot = captureScreenshot("denied");
            state = BridgeState.OBSERVED;
            observedAtEpochMs = System.currentTimeMillis();
            // Detox acknowledges cleanup before it terminates instrumentation. Publish
            // while the child is still alive, after the real prompt has been dismissed,
            // rather than relying on the JUnit finally block to win that teardown race.
            SystemClock.sleep(250L);
            bridgeStage = "capturing-manual";
            manualHierarchy = captureHierarchy("manual");
            manualScreenshot = captureScreenshot("manual");
            state = BridgeState.COMPLETE;
            writeReceipt();
            return;
          }
        }
        SystemClock.sleep(POLL_MS);
      }
      if (configuration == null) return;
      if (prompt != null && childFailure == null && state == BridgeState.OBSERVED) {
        checkDeadlineAndCancellation();
        manualHierarchy = captureHierarchy("manual");
        manualScreenshot = captureScreenshot("manual");
        state = BridgeState.COMPLETE;
      } else if (childFailure != null && (state == BridgeState.WAITING || state == BridgeState.OBSERVED)) {
        fail("child-failed");
      }
    } catch (BridgeCancelled ignored) {
      state = BridgeState.CANCELLED;
      setFailureCode("cancelled");
    } catch (BridgeDeadline ignored) {
      state = BridgeState.DEADLINE;
      setFailureCode("deadline");
    } catch (Throwable error) {
      state = BridgeState.BLOCKED;
      bridgeErrorClass = error.getClass().getSimpleName();
      setFailureCode("bridge-error");
      if (configuration == null) writeUnconfiguredReceiptFailureDiagnostic();
    } finally {
      writeReceipt();
    }
  }

  private void checkDeadlineAndCancellation() throws BridgeCancelled, BridgeDeadline {
    BridgeConfiguration current = requireConfiguration();
    if (cancellationRequested()) throw new BridgeCancelled();
    if (System.currentTimeMillis() >= current.deadlineAtEpochMs) throw new BridgeDeadline();
    if (Thread.currentThread().isInterrupted()) throw new BridgeCancelled();
  }

  private boolean cancellationRequested() {
    File cancelFile = requireConfiguration().cancelFile;
    if (!cancelFile.exists()) return false;
    try {
      StructStat stat = lstatPrivate(cancelFile);
      if (!isPrivateRegular(stat, requireConfiguration().targetUid) || stat.st_nlink != 1)
        throw new IllegalStateException("camera bridge cancellation file is not private");
      return true;
    } catch (IOException error) {
      throw new IllegalStateException("camera bridge cancellation file cannot be inspected", error);
    }
  }

  private boolean targetAppVisible() {
    // Package-root selectors are not a reliable proxy for foreground state on
    // Android 17: the permission transition can leave no matching UiObject2
    // root even after the target is interactive. UiAutomator's focused-package
    // observation is the direct lifecycle fact required by this bridge.
    return requireConfiguration().appId.equals(device.getCurrentPackageName());
  }

  @Nullable
  private PromptObservation findPrompt() {
    String appLabel = String.valueOf(targetContext.getApplicationInfo().loadLabel(
        targetContext.getPackageManager()));
    for (String systemPackage : PERMISSION_CONTROLLERS) {
      // UiAutomator's package-root selector is not a stable ancestor for all
      // PermissionController surfaces. Find the actual visible controls and
      // verify their packages instead of composing a descendant selector.
      UiObject2 title = device.findObject(By.text(TITLE_PATTERN));
      UiObject2 deny = device.findObject(By.text(DENY_PATTERN));
      if (title == null || deny == null) continue;
      if (title.getVisibleBounds().isEmpty() || deny.getVisibleBounds().isEmpty()) continue;
      if (!title.isEnabled() || !deny.isEnabled()) continue;
      if (!systemPackage.equals(title.getApplicationPackage()) ||
          !systemPackage.equals(deny.getApplicationPackage())) continue;
      String titleText = safeText(title);
      String normalizedTitle = titleText.toLowerCase(Locale.ROOT);
      if (!normalizedTitle.contains(appLabel.toLowerCase(Locale.ROOT))) continue;
      if (!normalizedTitle.contains("camera") && !normalizedTitle.contains("picture") &&
          !normalizedTitle.contains("video") && !normalizedTitle.contains("câmera") &&
          !normalizedTitle.contains("cámara")) continue;
      return new PromptObservation(
          systemPackage,
          titleText,
          safeText(deny),
          safeResourceName(title),
          sha256(appLabel.getBytes(StandardCharsets.UTF_8)),
          title,
          deny
      );
    }
    return null;
  }

  private void waitForPromptGone(String systemPackage) throws BridgeCancelled, BridgeDeadline {
    long waitDeadline = Math.min(requireConfiguration().deadlineAtEpochMs, System.currentTimeMillis() + 5000L);
    while (System.currentTimeMillis() < waitDeadline) {
      checkDeadlineAndCancellation();
      UiObject2 root = device.findObject(By.pkg(systemPackage));
      if (root == null || root.getVisibleBounds().isEmpty()) return;
      SystemClock.sleep(POLL_MS);
    }
    fail("prompt-not-dismissed");
  }

  private String permissionState() {
    return targetContext.checkSelfPermission(CAMERA_PERMISSION) == PackageManager.PERMISSION_GRANTED
        ? "granted" : "denied";
  }

  private boolean frameExists(@Nullable FileReceipt receipt) {
    if (receipt == null) return false;
    try {
      File file = containedChild(requireConfiguration().artifactRoot, receipt.path);
      StructStat stat = lstatPrivate(file);
      return isPrivateRegular(stat, requireConfiguration().targetUid) && stat.st_nlink == 1 && stat.st_size == receipt.sizeBytes;
    } catch (IOException | IllegalArgumentException error) {
      return false;
    }
  }

  private FileReceipt captureHierarchy(String label) throws IOException {
    File file = newFile(label + ".xml");
    device.dumpWindowHierarchy(file);
    return stableFile(file, "hierarchy");
  }

  private FileReceipt captureScreenshot(String label)
      throws IOException, BridgeCancelled, BridgeDeadline {
    // Android can reject a screenshot while it removes PermissionController's
    // surface. Retry a fresh output path under the same run-bound deadline;
    // never turn a transient compositor handoff into a false camera failure.
    long captureDeadline = Math.min(
        requireConfiguration().deadlineAtEpochMs,
        System.currentTimeMillis() + 2000L
    );
    int attempt = 0;
    while (System.currentTimeMillis() < captureDeadline) {
      checkDeadlineAndCancellation();
      File file = newFile(label + "-" + attempt + ".png");
      if (device.takeScreenshot(file)) return stableFile(file, "screenshot");
      attempt += 1;
      SystemClock.sleep(POLL_MS);
    }
    throw new IOException("Android screenshot capture remained unavailable");
  }

  private File newFile(String name) throws IOException {
    File artifactRoot = requireConfiguration().artifactRoot;
    mkdirPrivate(artifactRoot);
    File file = containedChild(artifactRoot, name);
    FileDescriptor descriptor = openNoFollow(
        file,
        OsConstants.O_WRONLY | OsConstants.O_CREAT | OsConstants.O_EXCL,
        0600
    );
    try {
      Os.fchmod(descriptor, 0600);
    } catch (ErrnoException error) {
      throw new IOException("camera evidence mode could not be set", error);
    } finally {
      closeDescriptor(descriptor);
    }
    return file;
  }

  private FileReceipt stableFile(File file, String kind) throws IOException {
    StructStat before = lstatPrivate(file);
    if (!isPrivateRegular(before, requireConfiguration().targetUid) || before.st_nlink != 1 || before.st_size <= 0 ||
        before.st_size > MAX_FRAME_BYTES) throw new IOException("camera evidence file is not private");
    MessageDigest digest = digest();
    long total = 0L;
    FileDescriptor stableDescriptor = openNoFollow(file, OsConstants.O_RDONLY, 0);
    try (FileInputStream descriptor = new FileInputStream(stableDescriptor);
         BufferedInputStream input = new BufferedInputStream(descriptor)) {
      StructStat descriptorBefore = Os.fstat(stableDescriptor);
      if (!sameIdentity(before, descriptorBefore))
        throw new IOException("camera evidence descriptor identity changed before read");
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) >= 0) {
        if (read == 0) continue;
        total += read;
        if (total > MAX_FRAME_BYTES) throw new IOException("camera evidence file exceeds cap");
        digest.update(buffer, 0, read);
      }
    } catch (ErrnoException error) {
      throw new IOException("camera evidence descriptor identity could not be read", error);
    }
    StructStat after = lstatPrivate(file);
    if (!sameIdentity(before, after) || total != before.st_size)
      throw new IOException("camera evidence changed during read");
    return new FileReceipt(
        requireConfiguration().artifactRoot.toURI().relativize(file.toURI()).getPath(),
        kind,
        total,
        hex(digest.digest()),
        before.st_uid,
        before.st_mode & 0777,
        before.st_dev,
        before.st_ino,
        before.st_nlink,
        before.st_mtime,
        before.st_ctime
    );
  }

  private void writeReceipt() {
    BridgeConfiguration current = configuration;
    if (receiptWritten || current == null) return;
    try {
      mkdirPrivate(current.artifactRoot);
      JSONObject root = new JSONObject();
      root.put("kind", "private-detox-android-camera-prompt-receipt");
      root.put("schemaVersion", 1);
      root.put("status", stateName());
      root.put("captureRunId", current.captureRunId);
      root.put("ownerRunId", current.ownerRunId);
      root.put("attemptId", current.attemptId);
      root.put("serial", current.expectedSerial);
      root.put("appId", current.appId);
      root.put("permission", CAMERA_PERMISSION);
      root.put("locale", current.expectedLocale);
      root.put("systemPackage", prompt == null ? PERMISSION_CONTROLLERS[0] : prompt.systemPackage);
      root.put("permissionBefore", permissionBefore);
      root.put("permissionAfter", permissionAfter);
      root.put("failureCode", failureCode);
      root.put("bridgeStage", bridgeStage);
      root.put("bridgeErrorClass", bridgeErrorClass);
      root.put("startedAtEpochMs", startedAtEpochMs);
      root.put("observedAtEpochMs", observedAtEpochMs);
      root.put("completedAtEpochMs", System.currentTimeMillis());
      JSONObject promptJson = new JSONObject();
      if (prompt != null) {
        promptJson.put("titleSelectorKind", "text-pattern");
        promptJson.put("titlePatternId", "camera-permission-title-v1");
        promptJson.put("titleTextSha256", sha256(prompt.titleText.getBytes(StandardCharsets.UTF_8)));
        promptJson.put("denySelectorKind", "text");
        promptJson.put("denySelectorValue", prompt.denyText);
        promptJson.put("denyResourceName", prompt.denyResourceName);
        promptJson.put("denyTextSha256", sha256(prompt.denyText.getBytes(StandardCharsets.UTF_8)));
        promptJson.put("appLabelSha256", prompt.appLabelSha256);
      }
      root.put("prompt", promptJson);
      root.put("frames", framesJson());
      root.put("targetApiLevel", Build.VERSION.SDK_INT);
      root.put("deviceSerial", current.expectedSerial);
      root.put("childResult", childFailure == null ? "completed" : "failed");
      root.put("childFailureClass", childFailure == null ? "none" : childFailure.getClass().getSimpleName());
      byte[] receiptBytes = root.toString().getBytes(StandardCharsets.UTF_8);
      if (receiptBytes.length == 0 || receiptBytes.length > MAX_RECEIPT_BYTES)
        throw new IOException("camera receipt exceeds its cap");
      File receipt = containedChild(current.artifactRoot, "camera-prompt-observation.private.json");
      FileDescriptor receiptDescriptor = openNoFollow(
          receipt,
          OsConstants.O_WRONLY | OsConstants.O_CREAT | OsConstants.O_EXCL,
          0600
      );
      try (FileOutputStream output = new FileOutputStream(receiptDescriptor)) {
        Os.fchmod(receiptDescriptor, 0600);
        output.write(receiptBytes);
        output.getFD().sync();
      }
      chmodPrivate(receipt, 0600);
      StructStat published = lstatPrivate(receipt);
      if (!isPrivateRegular(published, current.targetUid) || published.st_nlink != 1 || published.st_size != receiptBytes.length)
        throw new IOException("camera receipt publication identity is invalid");
      receiptWritten = true;
    } catch (Throwable error) {
      receiptWritten = false;
      state = BridgeState.BLOCKED;
      bridgeErrorClass = error.getClass().getSimpleName();
      setFailureCode("receipt-write-failure");
      writeReceiptFailureDiagnostic(current);
    }
  }

  /**
   * A terminal receipt failure must remain diagnosable without publishing a
   * stack trace, app text, or test data. This is not qualifying evidence: it
   * is a bounded private marker that explains why the terminal receipt is
   * absent and lets the owner fail closed with the bridge stage/class.
   */
  private void writeReceiptFailureDiagnostic(BridgeConfiguration current) {
    writeReceiptFailureDiagnostic(
        current.artifactRoot,
        current.captureRunId,
        current.ownerRunId,
        current.attemptId,
        current.targetUid
    );
  }

  /**
   * Configuration failures occur before a BridgeConfiguration can be retained.
   * Recover only the run binding required by the host's bounded reader from the
   * target-private handoff, and write the same redacted marker in the
   * instrumentation sandbox. Invalid or incomplete values produce no marker.
   */
  private void writeUnconfiguredReceiptFailureDiagnostic() {
    try {
      android.content.SharedPreferences preferences = targetContext.getSharedPreferences(
          PREFERENCES_NAME,
          Context.MODE_PRIVATE
      );
      String captureRunId = requireRunId(preferences.getString(KEY_CAPTURE_RUN_ID, null), "captureRunId");
      String ownerRunId = requireRunId(preferences.getString(KEY_OWNER_RUN_ID, null), "ownerRunId");
      String attemptId = preferences.getString(KEY_ATTEMPT_ID, null);
      if (!(ownerRunId + ":first").equals(attemptId)) return;
      File files = targetContext.getFilesDir().getCanonicalFile();
      requirePrivateDirectory(files);
      int artifactUid = lstatPrivate(files).st_uid;
      File artifactRoot = containedChild(files, "detox-camera/" + captureRunId);
      writeReceiptFailureDiagnostic(artifactRoot, captureRunId, ownerRunId, attemptId, artifactUid);
    } catch (Throwable ignored) {
      // A failed startup marker must never look like successful camera evidence.
    }
  }

  private void writeReceiptFailureDiagnostic(
      File artifactRoot,
      String captureRunId,
      String ownerRunId,
      String attemptId,
      int artifactUid
  ) {
    try {
      mkdirPrivate(artifactRoot);
      JSONObject root = new JSONObject();
      root.put("kind", "private-detox-android-camera-receipt-failure");
      root.put("schemaVersion", 1);
      root.put("captureRunId", captureRunId);
      root.put("ownerRunId", ownerRunId);
      root.put("attemptId", attemptId);
      root.put("bridgeStage", bridgeStage);
      root.put("bridgeErrorClass", bridgeErrorClass);
      root.put("failureCode", failureCode);
      byte[] bytes = root.toString().getBytes(StandardCharsets.UTF_8);
      if (bytes.length == 0 || bytes.length > 4096)
        throw new IOException("camera receipt failure diagnostic exceeds its cap");
      File diagnostic = containedChild(artifactRoot, "camera-prompt-observation-error.private.json");
      FileDescriptor descriptor = openNoFollow(
          diagnostic,
          OsConstants.O_WRONLY | OsConstants.O_CREAT | OsConstants.O_EXCL,
          0600
      );
      try (FileOutputStream output = new FileOutputStream(descriptor)) {
        Os.fchmod(descriptor, 0600);
        output.write(bytes);
        output.getFD().sync();
      }
      chmodPrivate(diagnostic, 0600);
      StructStat published = lstatPrivate(diagnostic);
      if (!isPrivateRegular(published, artifactUid) || published.st_nlink != 1 || published.st_size != bytes.length)
        throw new IOException("camera receipt failure diagnostic identity is invalid");
    } catch (Throwable ignored) {
      // A failed diagnostic must never look like successful camera evidence.
    }
  }

  private JSONObject framesJson() throws Exception {
    JSONObject frames = new JSONObject();
    putFrame(frames, "entry", entryHierarchy, entryScreenshot);
    putFrame(frames, "prompt", promptHierarchy, promptScreenshot);
    putFrame(frames, "denied", deniedHierarchy, deniedScreenshot);
    putFrame(frames, "manual", manualHierarchy, manualScreenshot);
    return frames;
  }

  private static void putFrame(JSONObject frames, String label, FileReceipt hierarchy, FileReceipt screenshot)
      throws Exception {
    JSONObject frame = new JSONObject();
    if (hierarchy != null) frame.put("hierarchy", hierarchy.toJson());
    if (screenshot != null) frame.put("screenshot", screenshot.toJson());
    frames.put(label, frame);
  }

  private String stateName() {
    switch (state) {
      case COMPLETE: return "observed";
      case CANCELLED: return "cancelled";
      case DEADLINE: return "deadline";
      case BLOCKED: return "blocked";
      default: return "blocked";
    }
  }

  private void fail(String code) {
    setFailureCode(code);
    state = BridgeState.BLOCKED;
    stopRequested.set(true);
  }

  private void setFailureCode(String code) {
    if ("none".equals(failureCode)) failureCode = code;
  }

  private static String requireRunId(String value, String label) {
    if (value == null || !value.matches("[a-f0-9]{24}"))
      throw new IllegalArgumentException(label + " is invalid");
    return value;
  }

  private static String requireSerial(String value) {
    if (value == null || !value.matches("(?:emulator-[0-9]+|[A-Za-z0-9._:-]{1,127})"))
      throw new IllegalArgumentException("serial is invalid");
    return value;
  }

  private static String requireAppId(String value) {
    if (value == null || !value.matches("[a-z][a-z0-9_]*(?:\\.[a-z0-9_]+)+"))
      throw new IllegalArgumentException("target app ID is invalid");
    return value;
  }

  private static String safeRelative(String value) {
    if (value == null || value.length() == 0) return "cancel.signal";
    if (value.startsWith("/") || value.contains("..") || value.indexOf('\0') >= 0)
      throw new IllegalArgumentException("camera bridge cancellation path is unsafe");
    return value;
  }

  private static File containedChild(File parent, String relative) {
    try {
      File canonicalParent = parent.getCanonicalFile();
      File child = new File(canonicalParent, relative).getCanonicalFile();
      if (!child.getPath().startsWith(canonicalParent.getPath() + File.separator))
        throw new IllegalArgumentException("camera bridge path escaped its owner");
      return child;
    } catch (IOException error) {
      throw new IllegalArgumentException("camera bridge path could not be canonicalized", error);
    }
  }

  private static void requirePrivateDirectory(@Nullable File directory) {
    if (directory == null || !directory.isDirectory())
      throw new IllegalArgumentException("camera bridge parent is not a private directory");
    try {
      // Android may expose the app-private directory through /data/user while
      // canonical resolution uses /data/data. The caller has already anchored
      // this path to Context.getFilesDir() and containedChild() canonicalizes
      // every derived path, so alias equality is not a security property here.
      directory.getCanonicalFile();
      StructStat stat = lstatPrivate(directory);
      // Context.getFilesDir() is framework-selected and sandbox-private. Android
      // may expose a test-package parent with a UID/mode that differs from the
      // target process, so only its canonical directory type is trusted here.
      // Every bridge-controlled child is canonicalized beneath it and created 0700.
      if ((stat.st_mode & OsConstants.S_IFMT) != OsConstants.S_IFDIR)
        throw new IllegalArgumentException("camera bridge parent is not a directory");
    } catch (IOException error) {
      throw new IllegalArgumentException("camera bridge parent cannot be inspected", error);
    }
  }

  private static void mkdirPrivate(File directory) {
    if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("camera bridge directory create failed");
    chmodPrivate(directory, 0700);
    requirePrivateDirectory(directory);
  }

  private static FileDescriptor openNoFollow(File file, int flags, int mode) throws IOException {
    File parent = file.getParentFile();
    if (parent == null) throw new IOException("camera bridge file has no private parent");
    requirePrivateDirectory(parent);
    try {
      return Os.open(file.getAbsolutePath(), flags | OsConstants.O_NOFOLLOW, mode);
    } catch (ErrnoException error) {
      throw new IOException("camera bridge descriptor could not be opened", error);
    }
  }

  private static void closeDescriptor(FileDescriptor descriptor) throws IOException {
    try {
      Os.close(descriptor);
    } catch (ErrnoException error) {
      throw new IOException("camera bridge descriptor could not be closed", error);
    }
  }

  private static StructStat lstatPrivate(File file) throws IOException {
    try {
      return Os.lstat(file.getAbsolutePath());
    } catch (Exception error) {
      throw new IOException("camera bridge file identity could not be read", error);
    }
  }

  private static void chmodPrivate(File file, int mode) {
    try {
      Os.chmod(file.getAbsolutePath(), mode);
    } catch (Exception error) {
      throw new IllegalStateException("camera bridge file mode could not be set", error);
    }
  }

  private static boolean isPrivateRegular(StructStat stat, int expectedUid) {
    return expectedUid >= 0 &&
        (stat.st_mode & OsConstants.S_IFMT) == OsConstants.S_IFREG &&
        (stat.st_mode & 0777) == 0600 && stat.st_uid == expectedUid;
  }

  private static boolean sameIdentity(StructStat left, StructStat right) {
    return left.st_dev == right.st_dev && left.st_ino == right.st_ino &&
        left.st_uid == right.st_uid && left.st_gid == right.st_gid &&
        left.st_mode == right.st_mode && left.st_nlink == right.st_nlink &&
        left.st_size == right.st_size && left.st_mtime == right.st_mtime &&
        left.st_ctime == right.st_ctime;
  }

  private static String safeText(UiObject2 object) {
    CharSequence text = object.getText();
    return text == null ? "" : text.toString();
  }

  private static String safeResourceName(UiObject2 object) {
    try {
      String name = object.getResourceName();
      return name == null ? "" : name;
    } catch (Throwable ignored) {
      return "";
    }
  }

  private static MessageDigest digest() throws IOException {
    try {
      return MessageDigest.getInstance("SHA-256");
    } catch (Exception error) {
      throw new IOException("SHA-256 is unavailable", error);
    }
  }

  private static String sha256(byte[] bytes) {
    try {
      return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  private static String hex(byte[] bytes) {
    StringBuilder output = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) output.append(String.format(Locale.ROOT, "%02x", value & 0xff));
    return output.toString();
  }

  private interface ConfigurationValues {
    @Nullable String get(String key);
  }

  private static final class BridgeConfiguration {
    final String captureRunId;
    final String ownerRunId;
    final String attemptId;
    final String expectedSerial;
    final String appId;
    final String expectedLocale;
    final long deadlineAtEpochMs;
    final int targetUid;
    final File artifactRoot;
    final File cancelFile;

    BridgeConfiguration(
        String captureRunId,
        String ownerRunId,
        String attemptId,
        String expectedSerial,
        String appId,
        String expectedLocale,
        long deadlineAtEpochMs,
        int targetUid,
        File artifactRoot,
        File cancelFile
    ) {
      this.captureRunId = captureRunId;
      this.ownerRunId = ownerRunId;
      this.attemptId = attemptId;
      this.expectedSerial = expectedSerial;
      this.appId = appId;
      this.expectedLocale = expectedLocale;
      this.deadlineAtEpochMs = deadlineAtEpochMs;
      this.targetUid = targetUid;
      this.artifactRoot = artifactRoot;
      this.cancelFile = cancelFile;
    }
  }

  private static final class PromptObservation {
    final String systemPackage;
    final String titleText;
    final String denyText;
    final String denyResourceName;
    final String appLabelSha256;
    final UiObject2 title;
    final UiObject2 deny;

    PromptObservation(String systemPackage, String titleText, String denyText, String denyResourceName,
        String appLabelSha256, UiObject2 title, UiObject2 deny) {
      this.systemPackage = systemPackage;
      this.titleText = titleText;
      this.denyText = denyText;
      this.denyResourceName = denyResourceName;
      this.appLabelSha256 = appLabelSha256;
      this.title = title;
      this.deny = deny;
    }
  }

  private static final class FileReceipt {
    final String path;
    final String kind;
    final long sizeBytes;
    final String sha256;
    final int ownerUid;
    final int mode;
    final long dev;
    final long ino;
    final long nlink;
    final long mtime;
    final long ctime;

    FileReceipt(String path, String kind, long sizeBytes, String sha256, int ownerUid, int mode,
        long dev, long ino, long nlink, long mtime, long ctime) {
      this.path = path;
      this.kind = kind;
      this.sizeBytes = sizeBytes;
      this.sha256 = sha256;
      this.ownerUid = ownerUid;
      this.mode = mode;
      this.dev = dev;
      this.ino = ino;
      this.nlink = nlink;
      this.mtime = mtime;
      this.ctime = ctime;
    }

    JSONObject toJson() throws Exception {
      JSONObject result = new JSONObject();
      result.put("path", path);
      result.put("kind", kind);
      result.put("sizeBytes", sizeBytes);
      result.put("sha256", sha256);
      result.put("ownerUid", ownerUid);
      result.put("mode", mode);
      result.put("dev", dev);
      result.put("ino", ino);
      result.put("nlink", nlink);
      result.put("mtime", mtime);
      result.put("ctime", ctime);
      result.put("verification", "android-detox-uiautomator-owned-stable-reader-v1");
      return result;
    }
  }

  private static final class BridgeCancelled extends Exception {}
  private static final class BridgeDeadline extends Exception {}

}
