package com.bubblechat.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.view.GestureDetector
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import kotlin.math.abs

/**
 * The expanded chat panel: rounded card hosting the service's shared WebView,
 * with a grab bar on top (drag to move, double-tap to reset) and a corner grip
 * at the bottom right (drag to resize). Tapping outside or pressing Back
 * collapses it. Reports where the keyboard starts so the service can keep the
 * panel above it (adjustResize alone is unreliable for overlay windows).
 */
@SuppressLint("ViewConstructor")
class ChatPanelView(context: Context, private val callbacks: Callbacks) : FrameLayout(context) {

    interface Callbacks {
        fun onPanelDismiss()
        fun onPanelRetry()
        /** keyboardTop is in screen coordinates; null when the keyboard is hidden. */
        fun onKeyboardChanged(keyboardTop: Int?)

        /** Grab bar dragged by (dx, dy) px since the drag started. */
        fun onPanelMoveStart()
        fun onPanelMove(dx: Int, dy: Int)
        fun onPanelMoveEnd()

        /** Corner grip dragged by (dx, dy) px since the drag started. */
        fun onPanelResizeStart()
        fun onPanelResize(dx: Int, dy: Int)
        fun onPanelResizeEnd()

        /** Double-tap on the grab bar: back to the default size and position. */
        fun onPanelResetLayout()
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

        // Anti-tapjacking: if another app's overlay sits on top of the chat, drop the touch
        // rather than let it drive the composer or buttons through the overlay.
        filterTouchesWhenObscured = true

        val gripColor = ContextCompat.getColor(context, R.color.text_secondary)

        val moveHandle = DragHandle(
            context,
            onStart = callbacks::onPanelMoveStart,
            onDrag = callbacks::onPanelMove,
            onEnd = callbacks::onPanelMoveEnd,
            onDoubleTap = callbacks::onPanelResetLayout,
        ).apply {
            contentDescription = context.getString(R.string.panel_move)
            addView(View(context).apply {
                background = GradientDrawable().apply {
                    cornerRadius = context.dp(2).toFloat()
                    setColor(gripColor)
                }
                alpha = 0.6f
            }, LayoutParams(context.dp(40), context.dp(4), Gravity.CENTER))
        }

        val resizeHandle = DragHandle(
            context,
            onStart = callbacks::onPanelResizeStart,
            onDrag = callbacks::onPanelResize,
            onEnd = callbacks::onPanelResizeEnd,
        ).apply {
            contentDescription = context.getString(R.string.panel_resize)
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_resize_corner)
                imageTintList = ColorStateList.valueOf(gripColor)
                alpha = 0.8f
            }, LayoutParams(context.dp(16), context.dp(16), Gravity.BOTTOM or Gravity.END).apply {
                marginEnd = context.dp(6)
                bottomMargin = context.dp(2)
            })
        }

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

        val content = FrameLayout(context).apply {
            addView(webContainer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            addView(errorView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }

        // Grab bar · chat · thin strip with the resize grip at its right end (below the
        // web composer, so it never covers its buttons).
        val bottomStrip = FrameLayout(context).apply {
            addView(resizeHandle, LayoutParams(context.dp(48), LayoutParams.MATCH_PARENT, Gravity.END))
        }
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(moveHandle, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, context.dp(GRAB_BAR_DP)))
            addView(content, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
            addView(bottomStrip, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, context.dp(RESIZE_STRIP_DP)))
        }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

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

    /**
     * Reports drags in raw screen pixels since ACTION_DOWN (the window moves under
     * the finger, so view-relative coordinates would jitter), like BubbleView.
     */
    @SuppressLint("ViewConstructor")
    private class DragHandle(
        context: Context,
        private val onStart: () -> Unit,
        private val onDrag: (Int, Int) -> Unit,
        private val onEnd: () -> Unit,
        onDoubleTap: (() -> Unit)? = null,
    ) : FrameLayout(context) {

        private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var dragging = false
        private val exclusionRect = Rect()
        private val exclusionRects = listOf(exclusionRect)

        private val doubleTaps = onDoubleTap?.let { action ->
            GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
                override fun onDoubleTap(e: MotionEvent): Boolean {
                    action()
                    return true
                }
            })
        }

        init {
            isClickable = true
        }

        override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
            super.onLayout(changed, left, top, right, bottom)
            // The panel can sit against a screen edge; keep edge-swipe Back from stealing the drag.
            exclusionRect.set(0, 0, width, height)
            ViewCompat.setSystemGestureExclusionRects(this, exclusionRects)
        }

        @SuppressLint("ClickableViewAccessibility") // no click action: it's a drag handle
        override fun onTouchEvent(event: MotionEvent): Boolean {
            doubleTaps?.onTouchEvent(event)
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    dragging = false
                    alpha = 0.6f
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - downX).toInt()
                    val dy = (event.rawY - downY).toInt()
                    if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                        dragging = true
                        onStart()
                    }
                    if (dragging) onDrag(dx, dy)
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    alpha = 1f
                    if (dragging) onEnd()
                    dragging = false
                }
            }
            return true
        }
    }

    companion object {
        const val GRAB_BAR_DP = 22
        const val RESIZE_STRIP_DP = 18
    }
}
