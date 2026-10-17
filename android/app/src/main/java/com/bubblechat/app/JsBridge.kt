package com.bubblechat.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import org.json.JSONObject

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

    /** Signed-in account (email) for the setup screen's Account section; "" = signed out. */
    @JavascriptInterface
    fun setAccount(account: String) {
        if (trusted()) prefs.linkedAccount = account.trim().take(MAX_ACCOUNT_CHARS)
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

    // ---- photos, screen, voice, read aloud (web/lib/bridge.ts NativeCapabilities) ----

    /** What this phone + app version can do, so the page only shows buttons that work. */
    @JavascriptInterface
    fun getCapabilities(): String {
        val pm = service.packageManager
        val voice = pm.queryIntentActivities(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0).isNotEmpty()
        val speech = pm.queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0).isNotEmpty()
        return JSONObject()
            .put("photo", true)
            // Screen capture as a foreground service needs Android 10+.
            .put("screen", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            .put("voice", voice)
            .put("speech", speech)
            .toString()
    }

    @JavascriptInterface
    fun pickImage(source: String) {
        if (!trusted()) return
        val kind = when (source) {
            "camera" -> ActionActivity.KIND_CAMERA
            "gallery" -> ActionActivity.KIND_GALLERY
            else -> return
        }
        service.runOnMain { service.launchAction(kind) }
    }

    @JavascriptInterface
    fun captureScreen() {
        if (!trusted()) return
        service.runOnMain { service.launchAction(ActionActivity.KIND_SCREEN) }
    }

    @JavascriptInterface
    fun startVoiceInput() {
        if (!trusted()) return
        service.runOnMain { service.launchAction(ActionActivity.KIND_VOICE) }
    }

    /** Shared text / voice result / photo waiting for the page, as JSON ("" if none). Taken once. */
    @JavascriptInterface
    fun takePending(): String = if (trusted()) service.takePendingJson() else ""

    @JavascriptInterface
    fun speak(text: String) {
        if (!trusted()) return
        val clean = text.take(MAX_SPEECH_CHARS)
        service.runOnMain { service.speak(clean) }
    }

    @JavascriptInterface
    fun stopSpeaking() {
        service.runOnMain { service.stopSpeaking() }
    }

    private companion object {
        const val MAX_ACCOUNT_CHARS = 200
        const val MAX_SPEECH_CHARS = 20_000
    }
}
