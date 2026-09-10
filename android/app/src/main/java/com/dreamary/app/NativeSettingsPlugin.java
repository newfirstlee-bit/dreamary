package com.dreamary.app;

import android.content.Intent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeSettings")
public class NativeSettingsPlugin extends Plugin {
    private static final String DIARY_CHANNEL_ID = "diary";

    @PluginMethod
    public void openAppNotificationSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("Unable to open notification settings", error);
        }
    }

    @PluginMethod
    public void getNotificationStatus(PluginCall call) {
        try {
            boolean appEnabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
            boolean channelEnabled = true;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager manager = getContext().getSystemService(NotificationManager.class);
                NotificationChannel channel = manager != null ? manager.getNotificationChannel(DIARY_CHANNEL_ID) : null;
                if (channel != null) {
                    channelEnabled = channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
                }
            }

            JSObject ret = new JSObject();
            ret.put("supported", true);
            ret.put("enabled", appEnabled && channelEnabled);
            ret.put("authorizationStatus", appEnabled && channelEnabled ? "granted" : "denied");
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("Unable to read notification status", error);
        }
    }
}
