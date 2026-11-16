package com.bubblechat.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.button.MaterialButton

/**
 * Shows one chat message so its text can be selected. The bubble's chat lives
 * in a window owned by a service, where Android can't show the selection
 * handles' Copy / Share / Select all menu, so "Select text" opens the message
 * here instead: a normal screen, where long-press, the handles and the whole
 * menu (Copy, Share, Translate, Ask Bubble…) work as in any app.
 */
class SelectTextActivity : ComponentActivity() {

    private var reopenBubble = true

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
        val title = intent.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: getString(R.string.select_title)

        val heading = TextView(this).apply {
            this.text = title
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(20), dp(16), dp(20), dp(4))
        }
        val hint = TextView(this).apply {
            this.text = getString(R.string.select_hint)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            alpha = 0.7f
            setPadding(dp(20), 0, dp(20), dp(8))
        }
        val body = TextView(this).apply {
            this.text = text
            setTextIsSelectable(true)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setLineSpacing(0f, 1.25f)
            setPadding(dp(20), dp(8), dp(20), dp(24))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(body, MATCH_PARENT, WRAP_CONTENT)
        }
        val copyAll = MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            this.text = getString(R.string.select_copy_all)
            isAllCaps = false
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Bubble", text))
                // Android 13+ shows its own "Copied" confirmation.
                if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) {
                    Toast.makeText(this@SelectTextActivity, R.string.select_copied, Toast.LENGTH_SHORT).show()
                }
            }
        }
        val done = MaterialButton(this).apply {
            this.text = getString(R.string.select_done)
            isAllCaps = false
            setOnClickListener { finish() }
        }
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(dp(16), dp(8), dp(16), dp(12))
            addView(copyAll, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginEnd = dp(8) })
            addView(done)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(heading)
            addView(hint)
            addView(scroll, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            addView(buttons)
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.updatePadding(left = bars.left, top = bars.top, right = bars.right, bottom = bars.bottom)
            insets
        }
        setContentView(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = finish()
        })
    }

    override fun onStop() {
        super.onStop()
        // Left for another app (Share, "Ask Bubble", Home): this screen has done its job.
        if (!isChangingConfigurations && !isFinishing) {
            reopenBubble = false
            finish()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // The bubble was hidden while this screen was open.
        if (isFinishing) OverlayService.selectTextClosed()
    }

    override fun finish() {
        super.finish()
        // Back / Done: return to the chat where the user was.
        if (reopenBubble) {
            reopenBubble = false
            OverlayService.deliver(this)
        }
    }

    companion object {
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_TITLE = "title"
        /** Keeps the intent well under Android's ~1 MB transaction limit. */
        private const val MAX_CHARS = 200_000

        fun intent(context: Context, text: String, title: String?): Intent =
            Intent(context, SelectTextActivity::class.java)
                .putExtra(EXTRA_TEXT, text.take(MAX_CHARS))
                .putExtra(EXTRA_TITLE, title)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
