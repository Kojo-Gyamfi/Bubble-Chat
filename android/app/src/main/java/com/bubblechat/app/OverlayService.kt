package com.bubblechat.app

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * Foreground service that owns the overlay windows: the draggable bubble and
 * the expanded chat panel. A single WebView lives for the whole service so the
 * chat isn't reloaded each time the panel opens.
 */
class OverlayService : Service(), BubbleView.Callbacks, ChatPanelView.Callbacks {

    private lateinit var wm: WindowManager
    private lateinit var prefs: Prefs
    private lateinit var themed: Context
    private val main = Handler(Looper.getMainLooper())

    private var bubble: BubbleView? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var dragStartX = 0
    private var dragStartY = 0
    private var snapAnimator: ValueAnimator? = null

    private var panel: ChatPanelView? = null
    private var panelParams: WindowManager.LayoutParams? = null
    private var panelFullHeight = 0

    private var webView: WebView? = null
    private var pageFailed = false

    /** True while the WebView shows our own site; JsBridge refuses calls otherwise. */
    @Volatile
    var pageTrusted = false
        private set

    private val baseUri: Uri = Uri.parse(BuildConfig.BASE_URL)
    private val overlayUrl = "${BuildConfig.BASE_URL}/overlay"

    // Debug builds often point at a free ngrok tunnel, which otherwise shows an
    // interstitial "visit site" page instead of the app.
    private val loadHeaders: Map<String, String> =
        if (BuildConfig.DEBUG) mapOf("ngrok-skip-browser-warning" to "1") else emptyMap()

    // ---------------------------------------------------------------- lifecycle

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        prefs = Prefs(this)
        themed = ContextThemeWrapper(this, R.style.Theme_BubbleChat)

        val canDraw = Settings.canDrawOverlays(this)
        // Show the bubble before startForeground(): on Android 15 a visible
        // overlay window is what lets a restarted service go foreground.
        if (canDraw) showBubble()
        // startForeground() must always be called after startForegroundService(),
        // even if we're about to stop.
        if (!goForeground() || !canDraw) {
            stopSelf()
            return
        }
        createWebView()
        watchNetwork()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_STOP -> {
                prefs.bubbleEnabled = false
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_LINK -> {
                // A fresh token arrived: reload now so the page signs in while the
                // one-hour token is still valid.
                prefs.bubbleEnabled = true
                val web = webView
                if (web == null) {
                    createWebView() // loads the overlay itself
                } else {
                    resumeWebView() // it must run now, even with the panel closed
                    web.loadUrl(overlayUrl, loadHeaders)
                }
            }
            ACTION_START -> prefs.bubbleEnabled = true
            // null intent = system restart after the process was killed (START_STICKY).
        }
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        main.removeCallbacksAndMessages(null)
        networkCallback?.let { callback ->
            try {
                getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(callback)
            } catch (e: Exception) {
                // Not registered.
            }
        }
        networkCallback = null
        snapAnimator?.cancel()
        panel?.let { removeWindow(it) }
        bubble?.let { removeWindow(it) }
        panel = null
        bubble = null
        webView?.apply {
            stopLoading()
            removeJavascriptInterface(BRIDGE_NAME)
            destroy()
        }
        webView = null
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Rotation / fold: re-place the bubble from its saved edge + height fraction.
        bubbleParams?.let { params ->
            placeBubbleFromPrefs(params)
            bubble?.let { wm.updateViewLayout(it, params) }
        }
        panel?.let { view ->
            val params = buildPanelParams()
            panelParams = params
            panelFullHeight = params.height
            wm.updateViewLayout(view, params)
        }
    }

    // ---------------------------------------------------------------- foreground notification

    /** Returns false if Android refused (e.g. a background restart it doesn't allow). */
    private fun goForeground(): Boolean {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW).apply {
                description = getString(R.string.notif_channel_desc)
                setShowBadge(false)
            },
        )
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
            true
        } catch (e: Exception) {
            // e.g. ForegroundServiceStartNotAllowedException on a background restart.
            Log.w(TAG, "Could not start in the foreground", e)
            false
        }
    }

    private fun buildNotification(): Notification {
        val stop = PendingIntent.getService(
            this, 1, Intent(this, OverlayService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val open = PendingIntent.getActivity(
            this, 2, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_bubble)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setContentIntent(open)
            .addAction(0, getString(R.string.notif_stop), stop)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    // ---------------------------------------------------------------- screen geometry

    private fun screenBounds(): Rect =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            wm.currentWindowMetrics.bounds
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)
            Rect(0, 0, metrics.widthPixels, metrics.heightPixels)
        }

    /** Status bar, navigation bar and cutout insets, so windows stay clear of them. */
    private fun systemInsets(): Rect =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val insets = wm.currentWindowMetrics.windowInsets.getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
            )
            Rect(insets.left, insets.top, insets.right, insets.bottom)
        } else {
            Rect(0, dp(24), 0, dp(48))
        }

    private fun bubbleWindowSize(): Int = dp(BubbleView.SIZE_DP + 2 * BubbleView.SHADOW_PAD_DP)

    /** Allowed range for the bubble window's top-left corner. */
    private fun bubbleLimits(): Rect {
        val screen = screenBounds()
        val insets = systemInsets()
        val size = bubbleWindowSize()
        return Rect(
            0,
            insets.top,
            (screen.width() - size).coerceAtLeast(0),
            (screen.height() - insets.bottom - size).coerceAtLeast(insets.top),
        )
    }

    // ---------------------------------------------------------------- bubble

    private fun showBubble() {
        if (bubble != null) return
        val params = bubbleParams ?: WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START }
        placeBubbleFromPrefs(params)
        val view = BubbleView(themed, this)
        try {
            wm.addView(view, params)
            bubble = view
            bubbleParams = params
        } catch (e: Exception) {
            Log.e(TAG, "Could not add the bubble window", e)
            // "Display over other apps" was turned off while running: stop rather
            // than keep an invisible foreground service around.
            if (!Settings.canDrawOverlays(this)) stopSelf()
        }
    }

    private fun placeBubbleFromPrefs(params: WindowManager.LayoutParams) {
        val limits = bubbleLimits()
        params.x = if (prefs.bubbleOnRight) limits.right else limits.left
        params.y = limits.top + ((limits.bottom - limits.top) * prefs.bubbleYFraction).toInt()
    }

    override fun onBubbleDragStart() {
        snapAnimator?.cancel()
        val params = bubbleParams ?: return
        dragStartX = params.x
        dragStartY = params.y
    }

    override fun onBubbleDrag(dx: Int, dy: Int) {
        val params = bubbleParams ?: return
        val view = bubble ?: return
        val limits = bubbleLimits()
        params.x = (dragStartX + dx).coerceIn(limits.left, limits.right)
        params.y = (dragStartY + dy).coerceIn(limits.top, limits.bottom)
        wm.updateViewLayout(view, params)
    }

    /** Snap to the nearest side edge and remember the position. */
    override fun onBubbleDragEnd() {
        val params = bubbleParams ?: return
        val limits = bubbleLimits()
        val toRight = params.x + bubbleWindowSize() / 2 > screenBounds().width() / 2
        val targetX = if (toRight) limits.right else limits.left

        prefs.bubbleOnRight = toRight
        val range = (limits.bottom - limits.top).coerceAtLeast(1)
        prefs.bubbleYFraction = (params.y - limits.top).toFloat() / range

        snapAnimator?.cancel()
        snapAnimator = ValueAnimator.ofInt(params.x, targetX).apply {
            duration = 220
            interpolator = DecelerateInterpolator()
            addUpdateListener { animator ->
                val view = bubble ?: return@addUpdateListener
                params.x = animator.animatedValue as Int
                wm.updateViewLayout(view, params)
            }
            start()
        }
    }

    override fun onBubbleTap() = expand()

    // ---------------------------------------------------------------- panel

    private fun buildPanelParams(): WindowManager.LayoutParams {
        val screen = screenBounds()
        val insets = systemInsets()
        val usableHeight = screen.height() - insets.top - insets.bottom
        val width = min((screen.width() * 0.92f).toInt(), dp(480))
        val height = min((usableHeight * 0.62f).toInt(), dp(680)).coerceAtLeast(dp(320))
        return WindowManager.LayoutParams(
            width,
            height,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // Focusable (no FLAG_NOT_FOCUSABLE) so the keyboard can open; not touch-modal
            // so taps outside reach the app below and arrive here as ACTION_OUTSIDE.
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (screen.width() - width) / 2
            // Near the top, leaving the bottom of the screen for the keyboard.
            y = insets.top + dp(12)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            windowAnimations = android.R.style.Animation_Dialog
        }
    }

    fun expand() {
        if (panel != null) return
        val web = webView ?: createWebView()
        if (web == null) {
            // System WebView is updating/unavailable; createWebView() keeps retrying.
            Toast.makeText(this, R.string.webview_unavailable, Toast.LENGTH_SHORT).show()
            return
        }
        resumeWebView()
        snapAnimator?.cancel()
        bubble?.let { removeWindow(it) }
        bubble = null

        val view = ChatPanelView(themed, this)
        view.attachWebView(web)
        view.showError(pageFailed)
        val params = buildPanelParams()
        try {
            wm.addView(view, params)
            panel = view
            panelParams = params
            panelFullHeight = params.height
        } catch (e: Exception) {
            Log.e(TAG, "Could not add the chat panel", e)
            view.detachWebView(web)
            showBubble()
        }
    }

    fun collapse() {
        val view = panel ?: return
        webView?.let { view.detachWebView(it) }
        removeWindow(view)
        panel = null
        panelParams = null
        pauseWebView()
        showBubble()
    }

    override fun onPanelDismiss() = collapse()

    override fun onPanelRetry() = reloadOverlay()

    private fun reloadOverlay() {
        pageFailed = false
        panel?.showError(false)
        val web = webView
        if (web == null) {
            createWebView()
        } else {
            resumeWebView()
            web.loadUrl(overlayUrl, loadHeaders)
        }
    }

    // While collapsed, the hidden page doesn't need to run: pausing its
    // JavaScript timers saves battery and CPU. Firestore catches up on resume.
    private var webPaused = false

    private fun pauseWebView() {
        val web = webView ?: return
        if (webPaused) return
        web.onPause()
        web.pauseTimers()
        webPaused = true
    }

    private fun resumeWebView() {
        val web = webView ?: return
        if (!webPaused) return
        web.resumeTimers()
        web.onResume()
        webPaused = false
    }

    // ---------------------------------------------------------------- network

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /** If the page failed to load while offline, reload it as soon as a network is back. */
    private fun watchNetwork() {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post { if (pageFailed) reloadOverlay() }
            }
        }
        try {
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (e: Exception) {
            Log.w(TAG, "Could not watch network changes", e)
        }
    }

    override fun onKeyboardChanged(keyboardTop: Int?) {
        val view = panel ?: return
        val params = panelParams ?: return
        val target = if (keyboardTop == null) {
            panelFullHeight
        } else {
            (keyboardTop - params.y - dp(8)).coerceIn(dp(200), panelFullHeight)
        }
        if (target != params.height) {
            params.height = target
            wm.updateViewLayout(view, params)
        }
    }

    private fun removeWindow(view: View) {
        try {
            wm.removeViewImmediate(view)
        } catch (e: IllegalArgumentException) {
            // Already removed.
        }
    }

    // ---------------------------------------------------------------- WebView

    private fun isAppUrl(uri: Uri?): Boolean =
        uri != null && uri.scheme == baseUri.scheme && uri.host == baseUri.host && uri.port == baseUri.port

    /**
     * Creates the shared WebView and starts loading /overlay, or returns null if the
     * system WebView can't be created right now (e.g. "Android System WebView" or
     * Chrome is mid-update); then it retries shortly instead of crashing.
     */
    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWebView(): WebView? {
        webView?.let { return it }
        val web = try {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG) // chrome://inspect in debug builds
            WebView(themed)
        } catch (e: Exception) {
            Log.e(TAG, "WebView unavailable; retrying", e)
            main.postDelayed({ if (isRunning && webView == null) createWebView() }, WEBVIEW_RETRY_MS)
            return null
        }
        web.apply {
            setBackgroundColor(ContextCompat.getColor(themed, R.color.panel_background))
            settings.apply {
                // ngrok's free tier serves an HTML warning page instead of every
                // script/style unless the User-Agent isn't a stock browser one
                // (the skip header above only covers the main document).
                if (BuildConfig.DEBUG && baseUri.host.orEmpty().contains("ngrok")) {
                    userAgentString = "BubbleChatDebug/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})"
                }
                javaScriptEnabled = true
                domStorageEnabled = true // Firebase keeps the session in IndexedDB
                setSupportMultipleWindows(false)
                javaScriptCanOpenWindowsAutomatically = false
                allowFileAccess = false
                allowContentAccess = false
            }
            addJavascriptInterface(JsBridge(this@OverlayService), BRIDGE_NAME)
            webViewClient = OverlayWebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    if (BuildConfig.DEBUG) Log.d(TAG, "console: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                    return true
                }
            }
        }
        webView = web
        webPaused = false
        // Load right away (not on first tap) so a fresh link token is used within its hour.
        web.loadUrl(overlayUrl, loadHeaders)
        return web
    }

    private inner class OverlayWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (isAppUrl(request.url)) return false
            // Never navigate the WebView (which holds the bridge) off our site.
            openExternal(request.url.toString())
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            pageTrusted = isAppUrl(url?.let(Uri::parse))
            // A new load clears the error; onReceivedError sets it again if this one fails too.
            pageFailed = false
            panel?.showError(false)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            pageTrusted = isAppUrl(url?.let(Uri::parse))
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                pageFailed = true
                panel?.showError(true)
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The renderer crashed or was killed for memory: rebuild instead of crashing the app.
            Log.w(TAG, "WebView renderer gone (crash=${detail.didCrash()})")
            panel?.detachWebView(view)
            view.destroy()
            if (webView === view) webView = null
            createWebView()?.let { fresh -> panel?.attachWebView(fresh) }
            return true
        }
    }

    fun openExternal(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            collapse()
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No app can open $url")
        }
    }

    // ---------------------------------------------------------------- threading helpers for JsBridge

    fun runOnMain(block: () -> Unit) {
        main.post { block() }
    }

    /** Runs [block] on the main thread and waits briefly for the result (bridge calls are synchronous). */
    fun <T> callOnMain(block: () -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val task = FutureTask(Callable { block() })
        main.post(task)
        return try {
            task.get(1, TimeUnit.SECONDS)
        } catch (e: Exception) {
            null
        }
    }

    companion object {
        private const val TAG = "OverlayService"
        private const val CHANNEL_ID = "bubble"
        private const val NOTIFICATION_ID = 1
        private const val BRIDGE_NAME = "Android"
        private const val WEBVIEW_RETRY_MS = 15_000L

        const val ACTION_START = "com.bubblechat.app.action.START"
        const val ACTION_STOP = "com.bubblechat.app.action.STOP"
        const val ACTION_LINK = "com.bubblechat.app.action.LINK"

        /** Whether the service is alive in this process (for the main screen's toggle). */
        @Volatile
        var isRunning = false
            private set

        fun start(context: Context) = startWith(context, ACTION_START)

        /** Start (or wake) the service after a new link token was saved. */
        fun link(context: Context) = startWith(context, ACTION_LINK)

        fun stop(context: Context) {
            context.startService(Intent(context, OverlayService::class.java).setAction(ACTION_STOP))
        }

        private fun startWith(context: Context, action: String) {
            ContextCompat.startForegroundService(context, Intent(context, OverlayService::class.java).setAction(action))
        }
    }
}
