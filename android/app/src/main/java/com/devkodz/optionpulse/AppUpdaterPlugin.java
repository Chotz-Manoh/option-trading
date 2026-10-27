package com.devkodz.optionpulse;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * One-tap update: downloads the new APK from this app's own GitHub Releases and opens Android's installer.
 * Only https://github.com/{BuildConfig.UPDATE_REPO}/releases/download/... is accepted, and Android itself
 * refuses any APK that isn't signed with the same key as the installed app.
 * Android always shows its own "Update this app?" confirmation — apps cannot skip it.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static String downloadedUrl;
    private static File downloadedFile;

    @PluginMethod
    public void install(final PluginCall call) {
        final String address = call.getString("url");
        String repo = BuildConfig.UPDATE_REPO;
        if (repo == null || repo.isEmpty()) {
            call.reject("This copy was built without an update source.");
            return;
        }
        String allowed = "https://github.com/" + repo + "/releases/download/";
        if (address == null || !address.startsWith(allowed) || !address.endsWith(".apk")) {
            call.reject("Updates are only installed from github.com/" + repo + ".");
            return;
        }
        final Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(settings);
            call.reject("Turn on \"Allow from this source\" for OptionPulse, come back, then tap Update again.", "PERMISSION");
            return;
        }
        new Thread(() -> {
            try {
                File apk;
                synchronized (AppUpdaterPlugin.class) {
                    if (address.equals(downloadedUrl) && downloadedFile != null && downloadedFile.length() > 1024 * 1024) {
                        apk = downloadedFile; // already downloaded (e.g. the installer was blocked last time)
                    } else {
                        File dir = new File(context.getCacheDir(), "updates");
                        if (!dir.exists() && !dir.mkdirs()) {
                            throw new Exception("cannot create the download folder");
                        }
                        apk = new File(dir, "OptionPulse-update.apk");
                        download(address, apk, 0);
                        downloadedUrl = address;
                        downloadedFile = apk;
                    }
                }
                Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
                final Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                final Activity activity = getActivity();
                activity.runOnUiThread(() -> {
                    try {
                        activity.startActivity(intent);
                        JSObject result = new JSObject();
                        result.put("started", true);
                        call.resolve(result);
                    } catch (Exception e) {
                        call.reject("Downloaded — tap Update now again to install. (" + e.getMessage() + ")");
                    }
                });
            } catch (Exception e) {
                call.reject("Update download failed: " + e.getMessage());
            }
        }).start();
    }

    private static void download(String address, File target, int redirects) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setInstanceFollowRedirects(false); // redirects are checked below
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);
        int code = connection.getResponseCode();
        if (code >= 300 && code < 400 && redirects < 5) {
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null) {
                throw new Exception("redirect without a location");
            }
            URL next = new URL(new URL(address), location);
            String host = next.getHost();
            if (!"https".equals(next.getProtocol()) || !(host.equals("github.com") || host.endsWith(".githubusercontent.com"))) {
                throw new Exception("unexpected download host " + host);
            }
            download(next.toString(), target, redirects + 1);
            return;
        }
        if (code != 200) {
            connection.disconnect();
            throw new Exception("HTTP " + code);
        }
        try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = in.read(buffer)) != -1) {
                out.write(buffer, 0, n);
            }
        } finally {
            connection.disconnect();
        }
    }
}
