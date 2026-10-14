package com.edufelip.mychampions.qa.inputreader;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Read-only title observation. No UI actions, app data, network or permission mutation. */
public final class InputReader extends Instrumentation {
    private static final String APP = "com.edufelip.mychampions.dev";
    private static final String TITLE = "pro.training_plan.name";
    private Bundle request;
    private long started;
    private int visited;
    private final List<AccessibilityNodeInfo> fields = new ArrayList<>();

    @Override public void onCreate(Bundle arguments) {
        request = arguments;
        start();
    }

    private static String text(CharSequence value) {
        return value == null ? "" : value.toString();
    }

    private void inspect(AccessibilityNodeInfo node, int depth) {
        if (node == null) return;
        if (++visited > 10000 || depth > 200 || SystemClock.elapsedRealtime() - started > 5000) {
            throw new IllegalStateException("Bounded native query exhausted");
        }
        String id = node.getViewIdResourceName();
        if (TITLE.equals(id) || (APP + ":id/" + TITLE).equals(id)) fields.add(node);
        for (int i = 0; i < node.getChildCount(); i++) inspect(node.getChild(i), depth + 1);
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        String phase = "request";
        try {
            String capture = request.getString("captureRunId"), label = request.getString("label");
            if (capture == null || !capture.matches("[a-f0-9]{24}") || label == null
                    || !label.matches("[a-z0-9-]{1,80}") || Build.VERSION.SDK_INT < 26) {
                throw new IllegalArgumentException("Invalid scoped reader request");
            }
            phase = "automation";
            UiAutomation automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            AccessibilityServiceInfo info = automation.getServiceInfo();
            info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                    | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
            automation.setServiceInfo(info);
            phase = "idle";
            automation.waitForIdle(250, 5000);
            started = SystemClock.elapsedRealtime();
            phase = "windows";
            List<AccessibilityWindowInfo> windows = automation.getWindows();
            if (windows.isEmpty() || windows.size() > 20) throw new IllegalStateException("Window query unavailable");
            for (AccessibilityWindowInfo window : windows) inspect(window.getRoot(), 0);
            phase = "field";
            if (fields.size() != 1) throw new IllegalStateException("Title missing or ambiguous");
            AccessibilityNodeInfo field = fields.get(0);
            Rect bounds = new Rect();
            field.getBoundsInScreen(bounds);
            JSONObject value = new JSONObject();
            value.put("schemaVersion", 1);
            value.put("kind", "read-only-owned-android-input-observation");
            value.put("captureRunId", capture);
            value.put("label", label);
            value.put("matchingFields", fields.size());
            value.put("packageName", text(field.getPackageName()));
            value.put("selectorId", field.getViewIdResourceName());
            value.put("className", text(field.getClassName()));
            value.put("enabled", field.isEnabled());
            value.put("editable", field.isEditable());
            value.put("visible", field.isVisibleToUser());
            value.put("isShowingHintText", field.isShowingHintText());
            value.put("nativeText", text(field.getText()));
            value.put("hintText", text(field.getHintText()));
            value.put("bounds", new JSONArray(new int[]{bounds.left, bounds.top, bounds.right, bounds.bottom}));
            value.put("apiLevel", Build.VERSION.SDK_INT);
            value.put("readOnly", true);
            result.putString("nativeInput", value.toString());
            finish(Activity.RESULT_OK, result);
        } catch (Exception failure) {
            // Do not dump arbitrary node text, exception messages or other windows.
            result.putString("nativeInputError", "scoped-read-unavailable");
            result.putString("nativeInputErrorStage", phase);
            result.putString("nativeInputErrorClass", failure.getClass().getSimpleName());
            finish(Activity.RESULT_CANCELED, result);
        }
    }
}
