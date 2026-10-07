package com.edufelip.mychampions

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Install the Android 12+ SplashScreen API.
    // Theme.App.SplashScreen (declared in styles.xml) is the activity theme and must extend
    // Theme.SplashScreen from androidx.core:core-splashscreen for this to work.
    // The returned SplashScreen handle is intentionally discarded; we rely on the default
    // auto-dismiss behaviour (splash hides as soon as the first frame is drawn).
    installSplashScreen()
    persistDetoxCameraBridgeLaunchConfiguration(intent)
    super.onCreate(null)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    persistDetoxCameraBridgeLaunchConfiguration(intent)
  }

  /**
   * The Android Detox instrumentation starts before device.launchApp supplies
   * its run-bound launch extras. Persist only the camera bridge's explicit,
   * test-owned whitelist so the instrumentation can observe the same launch.
   */
  private fun persistDetoxCameraBridgeLaunchConfiguration(launchIntent: Intent?) {
    val launchArgs = launchIntent?.getBundleExtra(DETOX_CAMERA_BRIDGE_LAUNCH_ARGS)
    if (launchArgs?.getString(DETOX_CAMERA_BRIDGE_ENABLED) != DETOX_CAMERA_BRIDGE_ENABLED_VALUE) {
      return
    }

    val preferences = getSharedPreferences(DETOX_CAMERA_BRIDGE_PREFERENCES, MODE_PRIVATE)
    val values = DETOX_CAMERA_BRIDGE_KEYS.associateWith { key -> launchArgs.getString(key) }
    val editor = preferences.edit().clear()
    if (values.values.any { value -> value == null }) {
      check(editor.commit()) { "Unable to clear incomplete Detox camera bridge configuration" }
      return
    }

    values.forEach { (key, value) -> editor.putString(key, value) }
    check(editor.commit()) { "Unable to persist Detox camera bridge configuration" }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  companion object {
    private const val DETOX_CAMERA_BRIDGE_PREFERENCES = "detox.camera.bridge.v1"
    private const val DETOX_CAMERA_BRIDGE_LAUNCH_ARGS = "launchArgs"
    private const val DETOX_CAMERA_BRIDGE_ENABLED = "detoxCameraBridge"
    private const val DETOX_CAMERA_BRIDGE_ENABLED_VALUE = "enabled"
    private val DETOX_CAMERA_BRIDGE_KEYS = arrayOf(
      DETOX_CAMERA_BRIDGE_ENABLED,
      "detoxCameraCaptureRunId",
      "detoxCameraOwnerRunId",
      "detoxCameraAttemptId",
      "detoxCameraSerial",
      "detoxCameraAppId",
      "detoxCameraLocale",
      "detoxCameraDeadlineAtEpochMs",
      "detoxCameraCancelRelativePath",
    )
  }

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
