package com.local.uno.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.content.res.Configuration;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class MainActivity extends Activity {
    private static final String PREFS = "uno_android";
    private static final String LAST_HOST = "last_host";
    private static final int[] PROBE_PORTS = {80, 3000, 3001, 3002, 3003, 3004,
            3005, 3006, 3007, 3008, 3009, 3010, 3011};

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LinearLayout root;
    private EditText addressInput;
    private ProgressBar progress;
    private Button connectButton;
    private WebView webView;
    private String currentBaseUrl;
    private boolean errorDialogOpen;
    private boolean switchingHost;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String priorUrl = state == null ? null : state.getString("currentBaseUrl");
        if (priorUrl == null) showAddressScreen();
        else {
            currentBaseUrl = priorUrl;
            openGame(priorUrl);
        }
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private void showAddressScreen() {
        currentBaseUrl = null;
        boolean dark = isNightMode();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(36), dp(24), dp(24));
        root.setBackgroundColor(dark ? Color.rgb(16, 17, 18) : Color.rgb(246, 247, 249));

        TextView title = text("UNO LAN", 30, dark ? Color.WHITE : Color.rgb(32, 37, 43));
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        root.addView(title, new LinearLayout.LayoutParams(-1, dp(54)));

        TextView subtitle = text("连接运行 UNO 的电脑", 16, dark ? Color.rgb(190, 194, 198) : Color.rgb(78, 90, 102));
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(-1, dp(42));
        subtitleParams.bottomMargin = dp(22);
        root.addView(subtitle, subtitleParams);

        addressInput = new EditText(this);
        addressInput.setSingleLine(true);
        addressInput.setTextColor(dark ? Color.WHITE : Color.rgb(32, 37, 43));
        addressInput.setHintTextColor(dark ? Color.rgb(145, 150, 154) : Color.rgb(100, 110, 120));
        addressInput.setHint("例如 192.168.1.10 或 192.168.1.10:3000");
        addressInput.setText(getSharedPreferences(PREFS, MODE_PRIVATE).getString(LAST_HOST, ""));
        addressInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        addressInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        addressInput.setPadding(dp(14), 0, dp(14), 0);
        addressInput.setBackgroundTintList(android.content.res.ColorStateList.valueOf(dark ? Color.rgb(83, 88, 92) : Color.rgb(130, 145, 155)));
        root.addView(addressInput, new LinearLayout.LayoutParams(-1, dp(54)));
        addressInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) {
                connect();
                return true;
            }
            return false;
        });

        connectButton = new Button(this);
        connectButton.setText("连接主机");
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, dp(52));
        buttonParams.topMargin = dp(14);
        root.addView(connectButton, buttonParams);
        connectButton.setOnClickListener(view -> connect());

        progress = new ProgressBar(this);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(36), dp(36));
        progressParams.topMargin = dp(20);
        root.addView(progress, progressParams);

        TextView note = text("手机与主机需处于同一局域网。主机需先启动游戏并开放局域网访问。", 14, dark ? Color.rgb(155, 160, 164) : Color.rgb(85, 98, 109));
        note.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(-1, -2);
        noteParams.topMargin = dp(24);
        root.addView(note, noteParams);
        setContentView(root);
        addressInput.requestFocus();
    }

    private boolean isNightMode() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private static final class HostTarget {
        final String scheme;
        final String host;
        final int explicitPort;
        HostTarget(String scheme, String host, int explicitPort) {
            this.scheme = scheme;
            this.host = host;
            this.explicitPort = explicitPort;
        }
        String base(int port) {
            String formattedHost = host.contains(":") && !host.startsWith("[") ? "[" + host + "]" : host;
            return scheme + "://" + formattedHost + ":" + port;
        }
    }

    private HostTarget parseTarget(String raw) throws Exception {
        String value = raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("请输入主机 IP 或地址");
        if (!value.matches("(?i)^[a-z][a-z0-9+.-]*://.*")) value = "http://" + value;
        URI uri = new URI(value);
        String scheme = uri.getScheme();
        if (scheme == null) throw new IllegalArgumentException("主机地址格式无效");
        scheme = scheme.toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) throw new IllegalArgumentException("地址只支持 HTTP 或 HTTPS");
        String host = uri.getHost();
        if (host == null || host.isEmpty()) throw new IllegalArgumentException("主机地址格式无效");
        if (uri.getUserInfo() != null) throw new IllegalArgumentException("主机地址格式无效");
        if ((uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/")) || uri.getQuery() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("请输入主机地址，不要填写房间链接或其他路径");
        }
        return new HostTarget(scheme, host, uri.getPort() > 0 ? uri.getPort() : (scheme.equals("https") ? 443 : -1));
    }

    private void connect() {
        if (connectButton == null || !connectButton.isEnabled()) return;
        final HostTarget target;
        try {
            target = parseTarget(addressInput.getText().toString());
        } catch (Exception error) {
            showError(error.getMessage());
            return;
        }
        ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(addressInput.getWindowToken(), 0);
        connectButton.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        String address = addressInput.getText().toString().trim();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(LAST_HOST, address).apply();
        executor.execute(() -> {
            String found = null;
            String failure = "无法连接主机。请确认主机已启动、双方位于同一局域网，并检查防火墙。";
            int[] ports = target.explicitPort > 0 ? new int[]{target.explicitPort} : PROBE_PORTS;
            ExecutorService probes = Executors.newFixedThreadPool(ports.length);
            CompletionService<ProbeResult> completed = new ExecutorCompletionService<>(probes);
            try {
                for (int port : ports) {
                    String candidate = target.base(port);
                    completed.submit(() -> probe(candidate));
                }
                boolean lanClosed = false;
                boolean notUno = false;
                for (int i = 0; i < ports.length; i++) {
                    Future<ProbeResult> future = completed.take();
                    ProbeResult result = future.get();
                    if (result.baseUrl != null) {
                        found = result.baseUrl;
                        break;
                    }
                    lanClosed |= result.lanClosed;
                    notUno |= result.notUno;
                }
                if (found == null && lanClosed) {
                    failure = "已找到 UNO 主机，但主机尚未开放局域网访问。请在主机等待页开启后重试。";
                } else if (found == null && notUno) {
                    failure = "找到网页服务，但不是 UNO 游戏主机。请检查 IP 和端口。";
                }
            } catch (Exception ignored) {
                failure = "主机检测中断，请重试。";
            } finally {
                probes.shutdownNow();
            }
            final String result = found;
            final String message = failure;
            runOnUiThread(() -> {
                if (isFinishing() || connectButton == null || progress == null) return;
                connectButton.setEnabled(true);
                progress.setVisibility(View.GONE);
                if (result == null) {
                    showError(message);
                } else {
                    currentBaseUrl = result;
                    openGame(result + "/join");
                }
            });
        });
    }

    private static final class ProbeResult {
        final String baseUrl;
        final boolean lanClosed;
        final boolean notUno;
        ProbeResult(String baseUrl, boolean lanClosed, boolean notUno) {
            this.baseUrl = baseUrl;
            this.lanClosed = lanClosed;
            this.notUno = notUno;
        }
    }

    private ProbeResult probe(String baseUrl) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(baseUrl + "/api/join-info").openConnection();
            connection.setConnectTimeout(2500);
            connection.setReadTimeout(2500);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            JSONObject json = new JSONObject(readAll(stream));
            if (status == 403 && "LAN_CLOSED".equals(json.optString("code"))) {
                return new ProbeResult(null, true, false);
            }
            if (status >= 200 && status < 300 && json.optBoolean("ok") && "uno".equals(json.optString("app"))) {
                return new ProbeResult(baseUrl, false, false);
            }
            return new ProbeResult(null, false, status >= 200 && status < 500);
        } catch (Exception ignored) {
            return new ProbeResult(null, false, false);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String readAll(InputStream input) throws Exception {
        if (input == null) return "{}";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString("UTF-8");
        }
    }

    private void openGame(String url) {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setBackgroundColor(isNightMode() ? Color.rgb(16, 17, 18) : Color.rgb(246, 247, 249));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                Uri base = Uri.parse(currentBaseUrl);
                if (uri.getScheme() != null && uri.getScheme().equalsIgnoreCase(base.getScheme())
                        && uri.getHost() != null && uri.getHost().equalsIgnoreCase(base.getHost())
                        && uri.getPort() == base.getPort()) return false;
                if (request.isForMainFrame() && uri.getScheme() != null
                        && (uri.getScheme().equalsIgnoreCase("http") || uri.getScheme().equalsIgnoreCase("https"))
                        && uri.getHost() != null) switchHost(uri);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showLoadError();
            }
        });
        setContentView(webView);
        webView.loadUrl(url);
    }

    private void switchHost(Uri uri) {
        if (switchingHost) return;
        switchingHost = true;
        int port = uri.getPort() > 0 ? uri.getPort()
                : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80);
        String host = uri.getHost();
        String formatted = host.contains(":") ? "[" + host + "]" : host;
        String baseUrl = uri.getScheme() + "://" + formatted + ":" + port;
        executor.execute(() -> {
            ProbeResult result = probe(baseUrl);
            runOnUiThread(() -> {
                switchingHost = false;
                if (isFinishing() || webView == null) return;
                if (result.baseUrl != null) {
                    currentBaseUrl = baseUrl;
                    webView.loadUrl(uri.toString());
                } else if (result.lanClosed) {
                    showError("已找到 UNO 主机，但主机尚未开放局域网访问。");
                } else {
                    showError("无法连接该主机。请检查 IP、端口、虚拟局域网和防火墙。");
                }
            });
        });
    }

    private void showLoadError() {
        if (isFinishing() || errorDialogOpen) return;
        errorDialogOpen = true;
        new AlertDialog.Builder(this)
                .setTitle("无法加载游戏")
                .setMessage("请检查主机是否在线以及手机网络连接，然后重试或更换主机地址。")
                .setCancelable(false)
                .setPositiveButton("重试", (dialog, which) -> {
                    errorDialogOpen = false;
                    if (webView != null && currentBaseUrl != null) webView.reload();
                })
                .setNegativeButton("更换主机", (dialog, which) -> {
                    errorDialogOpen = false;
                    showAddressScreen();
                })
                .show();
    }

    private void showError(String message) {
        new AlertDialog.Builder(this).setMessage(message == null ? "连接失败" : message)
                .setPositiveButton("确定", null).show();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        if (webView != null && currentBaseUrl != null) state.putString("currentBaseUrl", currentBaseUrl);
        super.onSaveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (webView != null) {
            showAddressScreen();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        executor.shutdownNow();
        super.onDestroy();
    }
}
