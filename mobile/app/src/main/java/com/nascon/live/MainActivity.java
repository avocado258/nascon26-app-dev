package com.nascon.live;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

/**
 * Native shell for the Guest Web Player: nascon:// deep links open the Match Live / Co-Stream
 * screen directly (no login screen), QR codes are scanned natively, and the backend address is
 * editable (emulator 10.0.2.2:8080, phone = laptop LAN IP).
 */
public class MainActivity extends Activity {
    private static final String PREFS = "nascon";
    private static final String KEY_BASE = "base_url";
    private static final String DEFAULT_BASE = "http://10.0.2.2:8080";

    private WebView web;
    private TextView route;
    private LinearLayout root;
    private String pendingPath;
    private Bundle pendingState;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        pendingState = savedInstanceState;
        if (savedInstanceState == null) handleIntent(getIntent());
        // WebView construction is slow on low-end phones; create it after the first frame so a
        // deep link brings the activity to the foreground well inside the 2 s budget (D2 6.3).
        root.post(this::attachWebView);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private Button barButton(String label, String description) {
        Button b = new Button(this);
        b.setText(label);
        b.setContentDescription(description);
        b.setAllCaps(false);
        b.setMinHeight(dp(48));
        b.setMinWidth(dp(48));
        return b;
    }

    private void buildUi() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0F1724"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), dp(4), dp(8), dp(4));
        bar.setBackgroundColor(Color.parseColor("#172133"));

        route = new TextView(this);
        route.setId(R.id.route);
        route.setTextColor(Color.parseColor("#F2F5FA"));
        route.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        route.setSingleLine(true);
        route.setText("NaSCon Live");
        bar.addView(route, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button scan = barButton("Scan QR", "Scan a match or club QR code");
        scan.setOnClickListener(v -> startScan());
        bar.addView(scan);

        Button server = barButton("Server", "Change the backend server address");
        server.setOnClickListener(v -> editServer());
        bar.addView(server);

        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);
    }

    private void attachWebView() {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                Uri u = Uri.parse(url);
                route.setText(u.getPath() == null ? url : u.getPath());
            }
        });

        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        if (pendingState != null) {
            web.restoreState(pendingState);
            pendingState = null;
        } else if (pendingPath != null) {
            web.loadUrl(base() + pendingPath);
        }
        pendingPath = null;
    }

    private String base() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_BASE, DEFAULT_BASE);
    }

    private void setBase(String url) {
        String clean = url.trim().replaceAll("/+$", "");
        if (!clean.startsWith("http://") && !clean.startsWith("https://")) clean = "http://" + clean;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_BASE, clean).apply();
    }

    /** Maps nascon://entity/{id} and nascon://stream/{id} to Guest Web Player routes. */
    static String routeFor(Uri uri) {
        String kind = uri.getHost();
        String id = uri.getLastPathSegment();
        if (id == null || kind == null) return "/web/matches/match-m1/live";
        if ("stream".equals(kind) || id.startsWith("cs-session-")) return "/web/costream/" + id;
        if (id.startsWith("player-")) return "/web/players/" + id;
        if (id.startsWith("club-")) return "/web/clubs/" + id;
        return "/web/matches/" + id + "/live";
    }

    private void open(String path) {
        route.setText(path);
        if (web == null) pendingPath = path;
        else web.loadUrl(base() + path);
    }

    private void handleIntent(Intent intent) {
        String override = intent.getStringExtra(KEY_BASE);
        if (override != null && !override.isEmpty()) setBase(override);
        Uri data = intent.getData();
        if (data != null && "nascon".equals(data.getScheme())) {
            open(routeFor(data));
        } else if (web == null ? pendingPath == null : web.getUrl() == null) {
            open("/web/matches/match-m1/live");
        }
    }

    // ---- QR scanning (ZXing) ----
    private void startScan() {
        IntentIntegrator integrator = new IntentIntegrator(this);
        integrator.setDesiredBarcodeFormats(IntentIntegrator.QR_CODE);
        integrator.setPrompt("Point the camera at a NaSCon QR code");
        integrator.setBeepEnabled(false);
        integrator.setOrientationLocked(false);
        integrator.initiateScan();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (result == null) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        String text = result.getContents();
        if (text == null) return;
        Uri u = Uri.parse(text.trim());
        if ("nascon".equals(u.getScheme())) {
            open(routeFor(u));
        } else if (u.getPath() != null && (u.getPath().startsWith("/q/") || u.getPath().startsWith("/web/"))) {
            // QR posters encode http://localhost:8080/q/...; resolve through this app's configured server.
            open(u.getPath() + (u.getQuery() == null ? "" : "?" + u.getQuery()));
        } else {
            Toast.makeText(this, "That QR code is not a NaSCon link.", Toast.LENGTH_LONG).show();
        }
    }

    // ---- settings ----
    private void editServer() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(base());
        input.setContentDescription("Backend server address");
        new AlertDialog.Builder(this)
                .setTitle("Backend server")
                .setMessage("Emulator: http://10.0.2.2:8080 · Phone: http://<laptop LAN IP>:8080")
                .setView(input)
                .setPositiveButton("Save", (d, w) -> {
                    setBase(input.getText().toString());
                    String path = route.getText().toString();
                    open(path.startsWith("/") ? path : "/web/matches/match-m1/live");
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
