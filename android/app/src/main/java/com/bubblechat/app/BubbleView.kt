package com.bubblechat.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.content.ContextCompat
import kotlin.math.abs

/**
 * The floating 56 dp bubble. Reports drags and taps; OverlayService owns the
 * window and does the actual moving/snapping.
 */
@SuppressLint("ViewConstructor")
class BubbleView(context: Context, private val callbacks: Callbacks) : FrameLayout(context) {

    interface Callbacks {
        /** Finger moved by (dx, dy) px since the drag started. */
        fun onBubbleDrag(dx: Int, dy: Int)
        fun onBubbleDragStart()
        fun onBubbleDragEnd()
        fun onBubbleTap()
    }

    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var downTime = 0L
    private var dragging = false

    init {
        // Room around the circle so its elevation shadow isn't clipped by the window.
        val pad = context.dp(SHADOW_PAD_DP)
        setPadding(pad, pad, pad, pad)
        clipToPadding = false
        contentDescription = context.getString(R.string.bubble_content_desc)

        val circle = ImageView(context).apply {
            background = ContextCompat.getDrawable(context, R.drawable.bubble_background)
            setImageResource(R.drawable.ic_launcher_foreground)
            scaleType = ImageView.ScaleType.CENTER_CROP
            elevation = context.dp(6).toFloat()
        }
        addView(circle, LayoutParams(context.dp(SIZE_DP), context.dp(SIZE_DP), Gravity.CENTER))
    }

    @SuppressLint("ClickableViewAccessibility") // taps go through performClick()
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.rawX
                downY = event.rawY
                downTime = SystemClock.uptimeMillis()
                dragging = false
                animate().scaleX(0.92f).scaleY(0.92f).setDuration(90).start()
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = (event.rawX - downX).toInt()
                val dy = (event.rawY - downY).toInt()
                if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                    dragging = true
                    callbacks.onBubbleDragStart()
                }
                if (dragging) callbacks.onBubbleDrag(dx, dy)
            }
            MotionEvent.ACTION_UP -> {
                animate().scaleX(1f).scaleY(1f).setDuration(120).start()
                if (dragging) {
                    callbacks.onBubbleDragEnd()
                } else if (SystemClock.uptimeMillis() - downTime < TAP_TIMEOUT_MS) {
                    performClick()
                }
                dragging = false
            }
            MotionEvent.ACTION_CANCEL -> {
                animate().scaleX(1f).scaleY(1f).setDuration(120).start()
                if (dragging) callbacks.onBubbleDragEnd()
                dragging = false
            }
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        callbacks.onBubbleTap()
        return true
    }

    companion object {
        const val SIZE_DP = 56
        const val SHADOW_PAD_DP = 8
        private const val TAP_TIMEOUT_MS = 300L
    }
}
