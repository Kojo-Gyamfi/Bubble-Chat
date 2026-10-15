package com.bubblechat.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.webkit.JavascriptInterface

/**
 * `window.Android` for the /overlay page. Must match web/lib/bridge.ts.
 *
 * Methods run on the WebView's JavaBridge thread, so anything touching
 * Android UI/clipboard hops to the main thread. Every call is ignored unless
 * the WebView is showing our own site (the token must never leak elsewhere).
 */
class JsBridge(private val service: OverlayService) {

    private val prefs = Prefs(service)
    private val clipboard = service.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    private fun trusted(): Boolean = service.pageTrusted

    /** Custom token saved at link time, or "". */
    @JavascriptInterface
    fun getAuthToken(): String = if (trusted()) prefs.authToken.orEmpty() else ""

    /** The page signed in with the token; it's single-purpose, so delete it. */
    @JavascriptInterface
    fun onLinked() {
        if (trusted()) prefs.authToken = null
    }

    /** Last copied text. Android 10+ only allows this while our panel has focus. */
    @JavascriptInterface
    fun getClipboard(): String {
        if (!trusted()) return ""
        return service.callOnMain {
            clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(service)?.toString()
        }.orEmpty()
    }

    @JavascriptInterface
    fun copyToClipboard(text: String) {
        if (!trusted()) return
        service.runOnMain { clipboard.setPrimaryClip(ClipData.newPlainText("Bubble", text)) }
    }

    @JavascriptInterface
    fun minimize() {
        service.runOnMain { service.collapse() }
    }

    @JavascriptInterface
    fun openInBrowser(url: String) {
        if (!trusted()) return
        val scheme = android.net.Uri.parse(url).scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return
        service.runOnMain { service.openExternal(url) }
    }

    @JavascriptInterface
    fun getAppVersion(): String = BuildConfig.VERSION_NAME
}
