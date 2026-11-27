package com.oestewdio.maite;

import android.os.Bundle;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.analytics.FirebaseAnalytics;
import java.util.Arrays;
import java.util.List;

@CapacitorPlugin(name = "MaiteAnalytics")
public class MaiteAnalyticsPlugin extends Plugin {
    private static final List<String> EVENTS = Arrays.asList(
        "character_created", "chat_message_completed", "chapter_created", "chat_image_created",
        "illustration_created", "heart_purchase_completed", "rewarded_ad_granted", "attendance_claimed",
        "pass_reward_claimed", "character_purchased", "chapter_purchased"
    );

    @PluginMethod
    public void record(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.resolve();
            return;
        }
        String name = call.getString("name");
        FirebaseAnalytics analytics = FirebaseAnalytics.getInstance(getContext());
        if ("screen_view".equals(name)) {
            String screen = call.getString("screen");
            if (screen != null && screen.matches("[a-z_]{1,32}")) {
                Bundle params = new Bundle();
                params.putString(FirebaseAnalytics.Param.SCREEN_NAME, screen);
                params.putString(FirebaseAnalytics.Param.SCREEN_CLASS, "MAITE");
                analytics.logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, params);
            }
        } else if (EVENTS.contains(name)) {
            analytics.logEvent(name, null);
        }
        call.resolve();
    }
}
