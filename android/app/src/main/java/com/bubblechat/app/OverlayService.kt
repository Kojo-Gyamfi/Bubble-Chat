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
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import kotlin.math.min
import org.json.JSONObject

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
        instance = this
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
            // From AskActivity / ActionActivity when we weren't running yet.
            ACTION_DELIVER -> receive(
                text = intent?.getStringExtra(EXTRA_TEXT),
                voice = intent?.getStringExtra(EXTRA_VOICE),
                imagePath = intent?.getStringExtra(EXTRA_IMAGE),
                error = intent?.getStringExtra(EXTRA_ERROR),
            )
            // null intent = system restart after the process was killed (START_STICKY).
        }
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        if (instance === this) instance = null
        main.removeCallbacksAndMessages(null)
        tts?.shutdown()
        tts = null
        endCapture()
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
            keyboardRestY = null
            wm.updateViewLayout(view, params)
        }
    }

    // ---------------------------------------------------------------- foreground notification

    /**
     * Returns false if Android refused (e.g. a background restart it doesn't allow).
     * [capturing] adds the mediaProjection type while a screenshot is being taken.
     */
    private fun goForeground(capturing: Boolean = false): Boolean {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW).apply {
                description = getString(R.string.notif_channel_desc)
                setShowBadge(false)
            },
        )
        val projection = if (capturing && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        } else {
            0
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or projection
        } else {
            projection
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

    /**
     * Screen area the panel may use: full width, between the system bars, and
     * clear of the pull-down-notifications and swipe-up-for-Home zones (these
     * can't be excluded, so they'd steal drags on the grab bar / resize grip).
     */
    private fun panelArea(): Rect {
        val screen = screenBounds()
        val insets = systemInsets()
        val gestures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            wm.currentWindowMetrics.windowInsets
                .getInsetsIgnoringVisibility(WindowInsets.Type.mandatorySystemGestures())
                .let { Rect(it.left, it.top, it.right, it.bottom) }
        } else {
            Rect()
        }
        return Rect(
            0,
            maxOf(insets.top, gestures.top),
            screen.width(),
            screen.height() - maxOf(insets.bottom, gestures.bottom),
        )
    }

    /** The user's saved size/position (Prefs.panelLayout), or the default, fitted to the current screen. */
    private fun buildPanelParams(): WindowManager.LayoutParams {
        val area = panelArea()
        val saved = prefs.panelLayout
        val width = (saved?.let { (it.width * area.width()).toInt() } ?: min((area.width() * 0.92f).toInt(), dp(480)))
            .coerceIn(min(dp(MIN_PANEL_WIDTH_DP), area.width()), area.width())
        val height = (saved?.let { (it.height * area.height()).toInt() } ?: min((area.height() * 0.62f).toInt(), dp(680)))
            .coerceIn(min(dp(MIN_PANEL_HEIGHT_DP), area.height()), area.height())
        // Default: centred near the top, leaving the bottom of the screen for the keyboard.
        val x = saved?.let { (it.x * area.width()).toInt() } ?: ((area.width() - width) / 2)
        val y = saved?.let { area.top + (it.y * area.height()).toInt() } ?: (area.top + dp(12))
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
            this.x = x.coerceIn(area.left, area.right - width)
            this.y = y.coerceIn(area.top, area.bottom - height)
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
            keyboardRestY = null
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

    // ---------------------------------------------------------------- panel: keyboard, move, resize

    /** The panel's own y before the keyboard pushed it up; null when it isn't pushed. */
    private var keyboardRestY: Int? = null

    /** A move/resize is in progress: the user decides the layout, not the keyboard. */
    private var panelGesture = false
    private var gestureStartX = 0
    private var gestureStartY = 0
    private var gestureStartWidth = 0
    private var gestureStartHeight = 0

    /**
     * Keeps the composer above the keyboard: shrink the panel, and if it sits so
     * low that too little would be left, lift it too (put back when the keyboard closes).
     */
    override fun onKeyboardChanged(keyboardTop: Int?) {
        if (panelGesture) return
        val view = panel ?: return
        val params = panelParams ?: return
        val gap = dp(8)
        // The panel's own inset is misleading when the keyboard covers it completely;
        // the screen-level IME inset gives the keyboard's real top edge.
        val keyboardTop = keyboardTop?.let { reported ->
            val screenIme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                wm.currentWindowMetrics.windowInsets.getInsets(WindowInsets.Type.ime()).bottom
            } else {
                0
            }
            if (screenIme > 0) screenBounds().height() - screenIme else reported
        }
        if (keyboardTop == null) {
            params.y = keyboardRestY ?: params.y
            params.height = panelFullHeight
            keyboardRestY = null
        } else {
            val restY = keyboardRestY ?: params.y
            val needed = min(panelFullHeight, dp(KEYBOARD_MIN_PANEL_DP))
            val y = if (keyboardTop - gap - restY >= needed) restY else (keyboardTop - gap - needed).coerceAtLeast(panelArea().top)
            keyboardRestY = if (y != restY) restY else null
            params.y = y
            params.height = (keyboardTop - gap - y).coerceIn(min(dp(160), panelFullHeight), panelFullHeight)
        }
        wm.updateViewLayout(view, params)
    }

    override fun onPanelMoveStart() = startPanelGesture()

    override fun onPanelMove(dx: Int, dy: Int) {
        val view = panel ?: return
        val params = panelParams ?: return
        val area = panelArea()
        params.x = (gestureStartX + dx).coerceIn(area.left, (area.right - params.width).coerceAtLeast(area.left))
        params.y = (gestureStartY + dy).coerceIn(area.top, (area.bottom - params.height).coerceAtLeast(area.top))
        wm.updateViewLayout(view, params)
    }

    override fun onPanelMoveEnd() = endPanelGesture()

    override fun onPanelResizeStart() = startPanelGesture()

    /** Bottom-right corner follows the finger; the top-left corner stays put. */
    override fun onPanelResize(dx: Int, dy: Int) {
        val view = panel ?: return
        val params = panelParams ?: return
        val area = panelArea()
        val maxWidth = area.right - params.x
        val maxHeight = area.bottom - params.y
        params.width = (gestureStartWidth + dx).coerceIn(min(dp(MIN_PANEL_WIDTH_DP), maxWidth), maxWidth)
        params.height = (gestureStartHeight + dy).coerceIn(min(dp(MIN_PANEL_HEIGHT_DP), maxHeight), maxHeight)
        panelFullHeight = params.height
        wm.updateViewLayout(view, params)
    }

    override fun onPanelResizeEnd() = endPanelGesture()

    override fun onPanelResetLayout() {
        val view = panel ?: return
        val params = panelParams ?: return
        prefs.panelLayout = null
        val defaults = buildPanelParams()
        params.x = defaults.x
        params.y = defaults.y
        params.width = defaults.width
        params.height = defaults.height
        panelFullHeight = defaults.height
        keyboardRestY = null
        wm.updateViewLayout(view, params)
        view.requestApplyInsets() // the keyboard may be open
    }

    private fun startPanelGesture() {
        val params = panelParams ?: return
        panelGesture = true
        // Where the user drops it is now its real place, even if the keyboard had lifted it.
        keyboardRestY = null
        gestureStartX = params.x
        gestureStartY = params.y
        gestureStartWidth = params.width
        gestureStartHeight = params.height
    }

    /** Remember the layout (as screen fractions, so it survives rotation) and re-fit to the keyboard. */
    private fun endPanelGesture() {
        panelGesture = false
        val params = panelParams ?: return
        val area = panelArea()
        prefs.panelLayout = Prefs.PanelLayout(
            x = params.x.toFloat() / area.width(),
            y = (params.y - area.top).toFloat() / area.height(),
            width = params.width.toFloat() / area.width(),
            height = panelFullHeight.toFloat() / area.height(),
        )
        panel?.requestApplyInsets()
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

    // ---------------------------------------------------------------- handing things to the page

    // Text, voice results and photos waiting for the page to take them (Android.takePending()).
    private val pendingLock = Any()
    private var pendingText: String? = null
    private var pendingVoice: String? = null
    private var pendingImagePath: String? = null
    private var pendingError: String? = null

    /** Something arrived for the chat (share sheet, "Ask Bubble", a picker): open the panel and tell the page. */
    fun receive(text: String? = null, voice: String? = null, imagePath: String? = null, error: String? = null) {
        prefs.bubbleEnabled = true
        synchronized(pendingLock) {
            text?.let { pendingText = listOfNotNull(pendingText, it).joinToString("\n") }
            voice?.let { pendingVoice = listOfNotNull(pendingVoice, it).joinToString(" ") }
            imagePath?.let { path ->
                pendingImagePath?.let { File(it).delete() } // one photo per message
                pendingImagePath = path
            }
            error?.let { pendingError = it }
        }
        bubble?.visibility = View.VISIBLE
        expand()
        // The page may still be loading; it also checks on mount.
        main.postDelayed({ notifyPage("pending") }, 150)
    }

    /** JSON for the page (NativePending in web/lib/bridge.ts), or "" if nothing is waiting. Bridge thread. */
    fun takePendingJson(): String {
        val taken = synchronized(pendingLock) {
            val all = listOf(pendingText, pendingVoice, pendingImagePath, pendingError)
            pendingText = null
            pendingVoice = null
            pendingImagePath = null
            pendingError = null
            all
        }
        val (text, voice, imagePath, error) = taken
        if (taken.all { it == null }) return ""
        val image = imagePath?.let { ImageUtils.takeAsDataUrl(this, it) }
        return JSONObject().apply {
            text?.let { put("text", it) }
            voice?.let { put("voice", it) }
            image?.let { put("image", it) }
            error?.let { put("error", it) }
        }.toString()
    }

    /** Fires window "bubble-native" with {type} on the page. */
    private fun notifyPage(type: String) {
        if (!pageTrusted) return
        webView?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('bubble-native',{detail:{type:${JSONObject.quote(type)}}}))",
            null,
        )
    }

    /** Opens the camera / photo picker / voice typing / capture consent over other apps. */
    fun launchAction(kind: String) {
        try {
            // Start it while our panel is still visible (that's what allows a start from the
            // background), then move the panel out of the way: overlays sit above every activity.
            startActivity(ActionActivity.intent(this, kind))
            collapse()
        } catch (e: Exception) {
            Log.w(TAG, "Could not open $kind", e)
            receive(error = getString(R.string.action_failed))
        }
    }

    // ---------------------------------------------------------------- read aloud

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsQueued: String? = null

    /** Bumped per speak()/stop so a finished older answer doesn't reset the page's button. */
    @Volatile
    private var ttsGeneration = 0

    fun speak(text: String) {
        if (tts == null) {
            ttsQueued = text
            tts = TextToSpeech(this) { status -> onTtsReady(status == TextToSpeech.SUCCESS) }
            return
        }
        if (ttsReady) speakNow(text) else ttsQueued = text
    }

    private fun onTtsReady(ok: Boolean) {
        ttsReady = ok
        if (!ok) {
            ttsQueued = null
            notifyPage("tts-end")
            return
        }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) = finished(utteranceId)

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = finished(utteranceId)
            override fun onError(utteranceId: String?, errorCode: Int) = finished(utteranceId)
        })
        ttsQueued?.let { speakNow(it) }
        ttsQueued = null
    }

    /** Engine thread. */
    private fun finished(utteranceId: String?) {
        if (utteranceId == "bubble-$ttsGeneration-last") main.post { notifyPage("tts-end") }
    }

    private fun speakNow(text: String) {
        val engine = tts ?: return
        engine.stop()
        val generation = ++ttsGeneration
        val chunks = text.chunkedAtSpaces(TextToSpeech.getMaxSpeechInputLength() - 100)
        chunks.forEachIndexed { i, chunk ->
            val id = if (i == chunks.lastIndex) "bubble-$generation-last" else "bubble-$generation-$i"
            engine.speak(chunk, TextToSpeech.QUEUE_ADD, null, id)
        }
    }

    fun stopSpeaking() {
        ttsQueued = null
        ttsGeneration++
        tts?.stop()
    }

    private fun String.chunkedAtSpaces(max: Int): List<String> {
        val out = mutableListOf<String>()
        var rest = this
        while (rest.length > max) {
            val cut = rest.lastIndexOf(' ', max).takeIf { it > max / 2 } ?: max
            out += rest.substring(0, cut)
            rest = rest.substring(cut).trimStart()
        }
        if (rest.isNotBlank()) out += rest
        return out
    }

    // ---------------------------------------------------------------- "Ask about my screen"

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    /** One screenshot with the consent from ActionActivity; capturing stops right after. */
    fun captureScreen(resultCode: Int, data: Intent) {
        // Android 14+: the service must be a mediaProjection foreground service first.
        if (!goForeground(capturing = true)) {
            receive(error = getString(R.string.capture_failed))
            return
        }
        val mp = try {
            getSystemService(MediaProjectionManager::class.java).getMediaProjection(resultCode, data)
        } catch (e: Exception) {
            Log.w(TAG, "No media projection", e)
            null
        }
        if (mp == null) {
            goForeground()
            receive(error = getString(R.string.capture_failed))
            return
        }
        projection = mp
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                main.post { endCapture() }
            }
        }, main)
        // Keep our own windows out of the picture and let the consent dialog go away first.
        bubble?.visibility = View.INVISIBLE
        main.postDelayed({ startCapture(mp) }, CAPTURE_DELAY_MS)
    }

    private fun startCapture(mp: MediaProjection) {
        if (projection !== mp) return
        val bounds = screenBounds()
        val width = bounds.width()
        val height = bounds.height()
        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        var done = false

        fun fail() {
            done = true
            endCapture()
            receive(error = getString(R.string.capture_failed))
        }

        reader.setOnImageAvailableListener({ r ->
            if (done) return@setOnImageAvailableListener
            val image = r.acquireLatestImage() ?: return@setOnImageAvailableListener
            done = true
            val bitmap = try {
                val plane = image.planes[0]
                val rowPixels = plane.rowStride / plane.pixelStride
                val padded = Bitmap.createBitmap(rowPixels, height, Bitmap.Config.ARGB_8888)
                padded.copyPixelsFromBuffer(plane.buffer)
                if (rowPixels == width) padded else Bitmap.createBitmap(padded, 0, 0, width, height).also { padded.recycle() }
            } catch (e: Exception) {
                Log.w(TAG, "Could not read the screenshot", e)
                null
            } finally {
                image.close()
            }
            endCapture()
            if (bitmap == null) {
                receive(error = getString(R.string.capture_failed))
                return@setOnImageAvailableListener
            }
            val app = applicationContext
            Thread {
                val path = ImageUtils.save(app, bitmap)
                bitmap.recycle()
                main.post { receive(imagePath = path) }
            }.start()
        }, main)

        try {
            virtualDisplay = mp.createVirtualDisplay(
                "bubble-capture", width, height, resources.displayMetrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.surface, null, main,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not start the capture", e)
            fail()
            return
        }
        main.postDelayed({ if (!done) fail() }, CAPTURE_TIMEOUT_MS)
    }

    /** Stops capturing (safe to call twice) and goes back to a plain foreground service. */
    private fun endCapture() {
        val mp = projection ?: return
        projection = null
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        try {
            mp.stop()
        } catch (e: Exception) {
            // Already stopped.
        }
        bubble?.visibility = View.VISIBLE
        if (isRunning) goForeground()
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
        private const val MIN_PANEL_WIDTH_DP = 260
        private const val MIN_PANEL_HEIGHT_DP = 300
        /** With the keyboard open, at least this much of the panel stays visible above it. */
        private const val KEYBOARD_MIN_PANEL_DP = 240
        private const val CAPTURE_DELAY_MS = 450L
        private const val CAPTURE_TIMEOUT_MS = 3_000L
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_VOICE = "voice"
        private const val EXTRA_IMAGE = "image"
        private const val EXTRA_ERROR = "error"

        const val ACTION_START = "com.bubblechat.app.action.START"
        const val ACTION_STOP = "com.bubblechat.app.action.STOP"
        const val ACTION_LINK = "com.bubblechat.app.action.LINK"
        const val ACTION_DELIVER = "com.bubblechat.app.action.DELIVER"

        /** The running service (same process), so helpers can hand results over directly. Main thread only. */
        private var instance: OverlayService? = null

        /** Whether the service is alive in this process (for the main screen's toggle). */
        @Volatile
        var isRunning = false
            private set

        fun start(context: Context) = startWith(context, ACTION_START)

        /** Start (or wake) the service after a new link token was saved. */
        fun link(context: Context) = startWith(context, ACTION_LINK)

        /**
         * Hands text / a voice result / a saved photo / an error to the chat and opens it.
         * All null = just reopen the panel (e.g. the picker was cancelled).
         */
        fun deliver(
            context: Context,
            text: String? = null,
            voice: String? = null,
            imagePath: String? = null,
            error: String? = null,
        ) {
            instance?.let {
                it.receive(text, voice, imagePath, error)
                return
            }
            ContextCompat.startForegroundService(
                context,
                Intent(context, OverlayService::class.java).setAction(ACTION_DELIVER)
                    .putExtra(EXTRA_TEXT, text)
                    .putExtra(EXTRA_VOICE, voice)
                    .putExtra(EXTRA_IMAGE, imagePath)
                    .putExtra(EXTRA_ERROR, error),
            )
        }

        /** Screen-capture consent arrived (from ActionActivity). */
        fun captureScreen(context: Context, resultCode: Int, data: Intent) {
            val service = instance
            if (service == null) {
                deliver(context, error = context.getString(R.string.capture_failed))
                return
            }
            service.captureScreen(resultCode, data)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, OverlayService::class.java).setAction(ACTION_STOP))
        }

        private fun startWith(context: Context, action: String) {
            ContextCompat.startForegroundService(context, Intent(context, OverlayService::class.java).setAction(action))
        }
    }
}
