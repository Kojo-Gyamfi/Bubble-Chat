package com.bubblechat.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible

/**
 * The expanded chat panel: rounded card hosting the service's shared WebView.
 * Tapping outside or pressing Back collapses it. Reports where the keyboard
 * starts so the service can shrink the panel above it (adjustResize alone is
 * unreliable for overlay windows).
 */
@SuppressLint("ViewConstructor")
class ChatPanelView(context: Context, private val callbacks: Callbacks) : FrameLayout(context) {

    interface Callbacks {
        fun onPanelDismiss()
        fun onPanelRetry()
        /** keyboardTop is in screen coordinates; null when the keyboard is hidden. */
        fun onKeyboardChanged(keyboardTop: Int?)
    }

    private val webContainer = FrameLayout(context)
    private val errorView: LinearLayout

    init {
        background = GradientDrawable().apply {
            cornerRadius = context.dp(20).toFloat()
            setColor(ContextCompat.getColor(context, R.color.panel_background))
            setStroke(context.dp(1), ContextCompat.getColor(context, R.color.panel_border))
        }
        outlineProvider = ViewOutlineProvider.BACKGROUND
        clipToOutline = true
        addView(webContainer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        errorView = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(ContextCompat.getColor(context, R.color.panel_background))
            isVisible = false
            addView(TextView(context).apply {
                setText(R.string.panel_offline)
                setTextColor(ContextCompat.getColor(context, R.color.text_primary))
                textSize = 15f
                gravity = Gravity.CENTER
            })
            addView(Button(context).apply {
                setText(R.string.panel_retry)
                setOnClickListener { callbacks.onPanelRetry() }
            }, LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
                topMargin = context.dp(12)
            })
        }
        addView(errorView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        ViewCompat.setOnApplyWindowInsetsListener(this) { view, insets ->
            val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            val overlap = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            when {
                // Keyboard covers part of the panel: tell the service where it starts.
                imeVisible && overlap > 0 -> {
                    val location = IntArray(2)
                    view.getLocationOnScreen(location)
                    callbacks.onKeyboardChanged(location[1] + view.height - overlap)
                }
                !imeVisible -> callbacks.onKeyboardChanged(null)
                // Visible but no overlap: the panel already fits above it.
            }
            insets
        }
    }

    fun attachWebView(webView: WebView) {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webContainer.addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    fun detachWebView(webView: WebView) {
        webContainer.removeView(webView)
    }

    fun showError(show: Boolean) {
        errorView.isVisible = show
    }

    // FLAG_WATCH_OUTSIDE_TOUCH delivers ACTION_OUTSIDE (no coordinates): treat it purely as "collapse".
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_OUTSIDE) {
            callbacks.onPanelDismiss()
            return true
        }
        return super.dispatchTouchEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) callbacks.onPanelDismiss()
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}
