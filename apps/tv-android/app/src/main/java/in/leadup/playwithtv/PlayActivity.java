package in.leadup.playwithtv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.net.Uri;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * Android/Google TV has no full web browser, so this app shows the platform's TV page full screen.
 * The remote's D-pad arrives as arrow keys, which the page uses to move between games and buttons.
 * Phones never need an app: they scan the QR code on screen and play in their own browser.
 */
public class PlayActivity extends Activity {
    private WebView web;
    private TextView offline;
    private boolean failed; // onPageFinished also fires for a failed load, which must not hide the offline screen
    private final Handler ui = new Handler(Looper.getMainLooper());
    private int retries;
    private ConnectivityManager.NetworkCallback netWatch;
    /** Tries again by itself (a TV waking up often has no DNS for a few seconds): 3 s, 6 s, 12 s ... at most 30 s. */
    private final Runnable autoRetry = this::retry;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b0820"));
        // Debug builds only: lets a developer inspect the page and measure frame rates over USB/ADB.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);               // the TV keeps its room across reloads (sessionStorage)
        s.setMediaPlaybackRequiresUserGesture(false); // game sounds without a click
        s.setUserAgentString(s.getUserAgentString() + " PlayWithTV/1"); // the page knows it is already the TV app
        web.setBackgroundColor(Color.parseColor("#0b0820"));
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    failed = true;
                    showOffline(err.getDescription().toString());
                }
            }

            /**
             * The local-network hub uses a self-signed certificate (phones need HTTPS for motion sensors).
             * Accept it only in debug builds and only for the configured platform host; anything else is refused.
             */
            @Override
            public void onReceivedSslError(WebView v, SslErrorHandler h, SslError err) {
                String host = Uri.parse(BuildConfig.PLATFORM_URL).getHost();
                boolean ours = host != null && host.equals(Uri.parse(err.getUrl()).getHost());
                if (BuildConfig.DEBUG && ours) h.proceed();
                else h.cancel();
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (!failed && !url.startsWith("about:")) { offline.setVisibility(TextView.GONE); retries = 0; }
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        offline = new TextView(this);
        offline.setTextColor(Color.WHITE);
        offline.setTextSize(22);
        offline.setGravity(Gravity.CENTER);
        offline.setBackgroundColor(Color.parseColor("#0b0820"));
        offline.setVisibility(TextView.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        web.loadUrl(BuildConfig.PLATFORM_URL);
        web.requestFocus();
        // Wi-Fi (re)connected while the offline screen is up: try at once instead of waiting for the timer
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            netWatch = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network n) {
                    ui.post(() -> { if (failed) { retries = 0; ui.removeCallbacks(autoRetry); ui.postDelayed(autoRetry, 1000); } });
                }
            };
            try { cm.registerDefaultNetworkCallback(netWatch); } catch (RuntimeException ignored) { netWatch = null; }
        }
    }

    private void retry() {
        ui.removeCallbacks(autoRetry);
        offline.setVisibility(TextView.GONE);
        failed = false;
        web.loadUrl(BuildConfig.PLATFORM_URL);
    }

    private void showOffline(String why) {
        long wait = Math.min(30_000L, 3_000L << Math.min(retries++, 4));
        offline.setText("Can't reach the game server\n" + BuildConfig.PLATFORM_URL + "\n(" + why + ")\n\nTrying again in " + (wait / 1000) + " s · press OK to try now");
        offline.setVisibility(TextView.VISIBLE);
        ui.removeCallbacks(autoRetry);
        ui.postDelayed(autoRetry, wait);
    }

    /**
     * Keys go to the focused WebView before onKeyDown would ever see them, so OK on the offline screen did nothing
     * and the TV stayed stuck. Catch it here, ahead of the WebView.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (offline.getVisibility() == TextView.VISIBLE
                && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER)) {
            if (e.getAction() == KeyEvent.ACTION_UP) { retries = 0; retry(); }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(autoRetry);
        if (netWatch != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            try { if (cm != null) cm.unregisterNetworkCallback(netWatch); } catch (RuntimeException ignored) { }
        }
        web.destroy();
        super.onDestroy();
    }
}
