package in.leadup.playwithtv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
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
                if (!failed && !url.startsWith("about:")) offline.setVisibility(TextView.GONE);
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
    }

    private void showOffline(String why) {
        offline.setText("Can't reach the game server\n" + BuildConfig.PLATFORM_URL + "\n(" + why + ")\n\nPress OK to try again");
        offline.setVisibility(TextView.VISIBLE);
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (offline.getVisibility() == TextView.VISIBLE
                && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER)) {
            offline.setVisibility(TextView.GONE);
            failed = false;
            web.loadUrl(BuildConfig.PLATFORM_URL);
            return true;
        }
        return super.onKeyDown(code, e);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
