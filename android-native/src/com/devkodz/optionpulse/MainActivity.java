package com.devkodz.optionpulse;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebBackForwardList;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * OptionPulse for Android: the OptionPulse web app (bundled in assets/public) in a full-screen WebView,
 * served from https://localhost, plus a small bridge (window.OptionPulseNative) for what a web page
 * can't do itself: broker API calls without CORS limits, notifications, the Kite login redirect and
 * one-tap app updates.
 */
public class MainActivity extends Activity {

    static final String ORIGIN = "https://localhost";
    /** Hosts the web app may call through the native bridge. */
    static final Set<String> API_HOSTS = new HashSet<String>(Arrays.asList(
            "api.kite.trade", "kite.zerodha.com", "api.upstox.com", "api-hft.upstox.com", "api.dhan.co", "api.github.com"));
    /** Sites allowed to open inside the app (Kite login and order basket). */
    /** Broker login pages open inside the app so their redirect back to 127.0.0.1:47811 can be caught. */
    static final String[] IN_APP_HOSTS = {"kite.zerodha.com", "kite.trade", "upstox.com"};

    private WebView web;
    private volatile String currentUrl = "";
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private int notificationId = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " OptionPulseAndroid/" + Config.VERSION_NAME);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new Client());
        web.addJavascriptInterface(new Bridge(), "OptionPulseNative");

        WebBackForwardList restored = savedInstanceState != null ? web.restoreState(savedInstanceState) : null;
        if (restored == null || restored.getSize() == 0) web.loadUrl(ORIGIN + "/");
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // Let the app decide (go up a level, or leave from the home screen); on Kite pages go back.
        web.evaluateJavascript("(window.__opBackButton ? window.__opBackButton() : 'none')", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if ("\"handled\"".equals(value)) return;
                if ("\"exit\"".equals(value)) { moveTaskToBack(true); return; }
                if (web.canGoBack()) web.goBack();
                else web.loadUrl(ORIGIN + "/");
            }
        });
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    // ---------- page loading ----------

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if ("https".equals(u.getScheme()) && "localhost".equals(u.getHost()) && u.getPort() == -1) return asset(u.getPath());
            return null;
        }

        /** Android 7+ (called for links and redirects). */
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return route(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return route(Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            currentUrl = url == null ? "" : url;
            super.onPageStarted(view, url, favicon);
        }
    }

    /** true = handled here (don't load in the WebView). */
    private boolean route(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        String host = u.getHost() == null ? "" : u.getHost();
        // Kite / Upstox send you to the app's redirect URL after login (or a Kite basket): reopen the app with it.
        if ((host.equals("127.0.0.1") || host.equals("localhost")) && u.getPort() == 47811) {
            String q = u.getEncodedQuery();
            String path = "/upstox-callback".equals(u.getPath()) ? "/upstox-callback" : "/kite-callback";
            web.loadUrl(ORIGIN + path + (q != null ? "?" + q : ""));
            return true;
        }
        if (scheme.equals("https") && host.equals("localhost")) return false;
        if (scheme.equals("https")) {
            for (String h : IN_APP_HOSTS) if (host.equals(h) || host.endsWith("." + h)) return false;
        }
        openExternal(u.toString());
        return true;
    }

    private static final Map<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("mjs", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("txt", "text/plain");
        MIME.put("webmanifest", "application/manifest+json");
    }

    /** Serves the bundled web app; app routes without a file extension get index.html. */
    private WebResourceResponse asset(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        if (path.contains("..")) return notFound();
        String name = path.substring(path.lastIndexOf('/') + 1);
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase() : "";
        if (ext.isEmpty()) { path = "/index.html"; ext = "html"; }
        try {
            InputStream in = getAssets().open("public" + path);
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            boolean text = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg");
            WebResourceResponse r = new WebResourceResponse(mime, text ? "UTF-8" : null, in);
            Map<String, String> h = new HashMap<String, String>();
            h.put("Cache-Control", ext.equals("html") ? "no-cache" : "max-age=31536000");
            r.setResponseHeaders(h);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", new HashMap<String, String>(),
                new ByteArrayInputStream(new byte[0]));
    }

    // ---------- bridge ----------

    private boolean fromApp() {
        return currentUrl.startsWith(ORIGIN + "/");
    }

    private void resolve(String id, int status, String text, String error) {
        final String js = "window.__opNative&&window.__opNative.resolve(" + JSONObject.quote(id) + "," + status + ","
                + JSONObject.quote(text == null ? "" : text) + "," + (error == null ? "null" : JSONObject.quote(error)) + ")";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    void openExternal(String url) {
        Uri u = Uri.parse(url);
        if (!"https".equals(u.getScheme()) && !"http".equals(u.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    /** Exposed to the app's own pages as window.OptionPulseNative. */
    public class Bridge {

        /** HTTP for the broker APIs (no browser CORS limits). Answers via window.__opNative.resolve. */
        @JavascriptInterface
        public void request(final String id, final String json) {
            if (!fromApp()) return;
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    int status = 0;
                    String text = "";
                    String error = null;
                    HttpURLConnection c = null;
                    try {
                        JSONObject o = new JSONObject(json);
                        URL u = new URL(o.getString("url"));
                        if (!"https".equals(u.getProtocol()) || !API_HOSTS.contains(u.getHost().toLowerCase()) || u.getPort() != -1) {
                            throw new IOException("host not allowed: " + u.getHost());
                        }
                        String method = o.optString("method", "GET");
                        c = (HttpURLConnection) u.openConnection();
                        c.setInstanceFollowRedirects(false);
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(60000);
                        c.setRequestMethod(method);
                        JSONObject headers = o.optJSONObject("headers");
                        if (headers != null) {
                            Iterator<String> keys = headers.keys();
                            while (keys.hasNext()) {
                                String k = keys.next();
                                String lk = k.toLowerCase();
                                if (lk.equals("host") || lk.equals("content-length") || lk.equals("accept-encoding") || lk.equals("cookie")) continue;
                                c.setRequestProperty(k, headers.getString(k));
                            }
                        }
                        c.setRequestProperty("User-Agent", "OptionPulse-Android/" + Config.VERSION_NAME);
                        String body = o.optString("body", "");
                        if (body.length() > 0 && !"GET".equals(method) && !"DELETE".equals(method)) {
                            c.setDoOutput(true);
                            OutputStream os = c.getOutputStream();
                            os.write(body.getBytes("UTF-8"));
                            os.close();
                        }
                        status = c.getResponseCode();
                        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (in != null) text = readAll(in);
                    } catch (Exception e) {
                        error = e.getClass().getSimpleName() + ": " + e.getMessage();
                    } finally {
                        if (c != null) c.disconnect();
                    }
                    resolve(id, status, text, error);
                }
            });
        }

        @JavascriptInterface
        public void notifyUser(final String title, final String body) {
            if (!fromApp()) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showNotification(title, body);
                }
            });
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            if (!fromApp() || Build.VERSION.SDK_INT < 33) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 1);
                    }
                }
            });
        }

        @JavascriptInterface
        public void copyText(final String text) {
            if (!fromApp()) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("OptionPulse", text));
                }
            });
        }

        @JavascriptInterface
        public void openExternal(String url) {
            if (!fromApp()) return;
            MainActivity.this.openExternal(url);
        }

        @JavascriptInterface
        public void exitApp() {
            if (!fromApp()) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    moveTaskToBack(true);
                }
            });
        }

        /** One-tap update: downloads the APK from this app's own GitHub releases and opens the installer. */
        @JavascriptInterface
        public void installApk(final String id, final String url) {
            if (!fromApp()) return;
            String allowed = "https://github.com/" + Config.UPDATE_REPO + "/releases/download/";
            if (Config.UPDATE_REPO.isEmpty() || url == null || !url.startsWith(allowed) || !url.endsWith(".apk")) {
                resolve(id, 0, "", "Updates are only installed from this app's own GitHub releases.");
                return;
            }
            if (Build.VERSION.SDK_INT >= 26 && !canInstallPackages()) {
                openInstallSettings();
                resolve(id, 0, "", "PERMISSION");
                return;
            }
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        File f = ApkProvider.updateFile(MainActivity.this);
                        download(url, f, 0);
                        final Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(ApkProvider.updateUri(), "application/vnd.android.package-archive");
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    startActivity(i);
                                } catch (Exception e) {
                                    resolve(id, 0, "", "Couldn't open the installer: " + e.getMessage());
                                    return;
                                }
                                resolve(id, 200, "started", null);
                            }
                        });
                    } catch (Exception e) {
                        resolve(id, 0, "", "Update download failed: " + e.getMessage());
                    }
                }
            });
        }
    }

    // ---------- notifications ----------

    private void showNotification(String title, String body) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                // NotificationChannel is newer than the SDK this app is compiled with, so create it by reflection.
                Class<?> ch = Class.forName("android.app.NotificationChannel");
                Object channel = ch.getConstructor(String.class, CharSequence.class, int.class).newInstance("alerts", "OptionPulse alerts", 4);
                NotificationManager.class.getMethod("createNotificationChannel", ch).invoke(nm, channel);
                b = Notification.Builder.class.getConstructor(Context.class, String.class).newInstance(this, "alerts");
            } else {
                b = new Notification.Builder(this);
            }
            Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.setSmallIcon(android.R.drawable.stat_notify_more)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            nm.notify(notificationId++, b.build());
        } catch (Exception ignored) {
        }
    }

    // ---------- updates ----------

    private boolean canInstallPackages() {
        try {
            Object r = PackageManager.class.getMethod("canRequestPackageInstalls").invoke(getPackageManager());
            return Boolean.TRUE.equals(r);
        } catch (Exception e) {
            return true;
        }
    }

    private void openInstallSettings() {
        try {
            startActivity(new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES", Uri.parse("package:" + getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {
        }
    }

    private static void download(String address, File target, int redirects) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setInstanceFollowRedirects(false); // redirects are checked below
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        int code = c.getResponseCode();
        if (code >= 300 && code < 400 && redirects < 6) {
            String location = c.getHeaderField("Location");
            c.disconnect();
            if (location == null) throw new IOException("redirect without a location");
            URL next = new URL(new URL(address), location);
            String host = next.getHost();
            if (!"https".equals(next.getProtocol()) || !(host.equals("github.com") || host.endsWith(".githubusercontent.com"))) {
                throw new IOException("unexpected download host " + host);
            }
            download(next.toString(), target, redirects + 1);
            return;
        }
        if (code != 200) {
            c.disconnect();
            throw new IOException("HTTP " + code);
        }
        InputStream in = c.getInputStream();
        OutputStream out = new FileOutputStream(target);
        try {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        } finally {
            out.close();
            in.close();
            c.disconnect();
        }
    }
}
