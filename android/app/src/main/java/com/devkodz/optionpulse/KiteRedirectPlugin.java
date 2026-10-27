package com.devkodz.optionpulse;

import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Zerodha Kite (and Upstox, at /upstox-callback) send the browser to the app's registered redirect URL
 * (http://127.0.0.1:47811/kite-callback?request_token=...) after login or a basket order.
 * On the phone nothing listens on that address, so we catch the navigation here and
 * reload the app with the same query string; the web code then finishes the login.
 */
@CapacitorPlugin(name = "KiteRedirect")
public class KiteRedirectPlugin extends Plugin {

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String host = url.getHost();
        if (host == null || url.getPort() != 47811) {
            return null;
        }
        if (!host.equals("127.0.0.1") && !host.equals("localhost")) {
            return null;
        }
        Uri app = Uri.parse(getBridge().getAppUrl());
        String query = url.getEncodedQuery();
        String path = "/upstox-callback".equals(url.getPath()) ? "/upstox-callback" : "/kite-callback";
        final String target = app.getScheme() + "://" + app.getEncodedAuthority() + path + (query != null ? "?" + query : "");
        getBridge().executeOnMainThread(() -> getBridge().getWebView().loadUrl(target));
        return true;
    }
}
