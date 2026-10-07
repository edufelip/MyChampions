package com.edufelip.mychampions;

import android.content.Context;
import android.preference.PreferenceManager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.ActivityTestRule;

import com.wix.detox.Detox;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DetoxTest {
  private static final String REACT_NATIVE_DEBUG_SERVER_HOST = "debug_http_host";
  private static final String DETOX_METRO_HOST = BuildConfig.DETOX_METRO_HOST;
  private static final String CAMERA_BOOTSTRAP_PREFERENCES = "detox.camera.bootstrap.v1";

  @Rule
  public ActivityTestRule<MainActivity> activityRule =
      new ActivityTestRule<>(MainActivity.class, false, false);

  private void routeMetroThroughAdbReverse() {
    Context targetContext =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    boolean committed =
        PreferenceManager.getDefaultSharedPreferences(targetContext)
            .edit()
            .putString(REACT_NATIVE_DEBUG_SERVER_HOST, DETOX_METRO_HOST)
            .commit();

    if (!committed) {
      throw new IllegalStateException(
          "Unable to configure the Detox Metro host through adb reverse");
    }
  }

  private void publishCameraBootstrap(Context targetContext, String state) {
    if (!state.matches("[A-Za-z0-9_-]{1,128}"))
      throw new IllegalArgumentException("Detox camera bootstrap state is invalid");
    boolean committed = targetContext
        .getSharedPreferences(CAMERA_BOOTSTRAP_PREFERENCES, Context.MODE_PRIVATE)
        .edit()
        .putString("state", state)
        .commit();
    if (!committed) throw new IllegalStateException("Unable to publish Detox camera bootstrap state");
  }

  @Test
  public void runDetoxTests() {
    Context targetContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
    DetoxCameraPermissionBridge cameraBridge =
        DetoxCameraPermissionBridge.fromInstrumentation(
            targetContext,
            androidx.test.uiautomator.UiDevice.getInstance(
                InstrumentationRegistry.getInstrumentation()));
    if (cameraBridge == null) {
      routeMetroThroughAdbReverse();
      Detox.runTests(activityRule);
      return;
    }
    publishCameraBootstrap(targetContext, "entered");
    routeMetroThroughAdbReverse();
    cameraBridge.start();
    Throwable childFailure = null;
    try {
      Detox.runTests(activityRule);
      publishCameraBootstrap(targetContext, "detox-returned");
    } catch (Throwable error) {
      childFailure = error;
      publishCameraBootstrap(targetContext, "detox-failed-" + error.getClass().getSimpleName());
      throw error;
    } finally {
      cameraBridge.finish(childFailure);
      if (childFailure == null) cameraBridge.requireCompleted();
    }
  }
}
