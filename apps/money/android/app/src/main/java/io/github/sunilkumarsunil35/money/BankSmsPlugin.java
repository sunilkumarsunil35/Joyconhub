package io.github.sunilkumarsunil35.money;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Settings;
import android.provider.Telephony;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Reads the SMS inbox so the web layer can turn bank messages into entries. Read-only: nothing
 * is sent, deleted or uploaded, and the app has no internet permission.
 */
@CapacitorPlugin(name = "BankSms", permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }) })
public class BankSmsPlugin extends Plugin {

    /** Inbox messages received after `since` (ms since epoch, as a string), newest first. */
    @PluginMethod
    public void read(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted", "PERMISSION_DENIED");
            return;
        }
        long since;
        try {
            since = Long.parseLong(call.getString("since", "0"));
        } catch (NumberFormatException e) {
            since = 0;
        }
        int limit = call.getInt("limit", 1000);

        JSArray messages = new JSArray();
        String[] columns = { Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        try (
            Cursor c = getContext()
                .getContentResolver()
                .query(
                    Telephony.Sms.Inbox.CONTENT_URI,
                    columns,
                    Telephony.Sms.DATE + " > ?",
                    new String[] { String.valueOf(since) },
                    Telephony.Sms.DATE + " DESC"
                )
        ) {
            while (c != null && c.moveToNext() && messages.length() < limit) {
                JSObject m = new JSObject();
                m.put("id", String.valueOf(c.getLong(0)));
                m.put("address", c.getString(1) == null ? "" : c.getString(1));
                m.put("body", c.getString(2) == null ? "" : c.getString(2));
                m.put("date", c.getLong(3));
                messages.put(m);
            }
        } catch (SecurityException e) {
            call.reject("SMS permission not granted", "PERMISSION_DENIED");
            return;
        } catch (Exception e) {
            call.reject("Couldn't read SMS: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("messages", messages);
        call.resolve(ret);
    }

    /** Opens this app's page in Android Settings (permissions, "Allow restricted settings"). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
