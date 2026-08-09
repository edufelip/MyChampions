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

  @Test
  public void runDetoxTests() {
    routeMetroThroughAdbReverse();
    Detox.runTests(activityRule);
  }
}
