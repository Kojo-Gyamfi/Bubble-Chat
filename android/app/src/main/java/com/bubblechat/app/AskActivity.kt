package com.bubblechat.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.content.IntentCompat

/**
 * "Ask Bubble" in the text-selection menu of any app (ACTION_PROCESS_TEXT),
 * and Bubble Chat in the Share sheet (text, links, photos). Opens the bubble
 * with the text / photo in the composer, ready for the user's question. Nothing
 * is sent until they tap Send.
 */
class AskActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) return finish()

        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, R.string.need_overlay_first, Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return finish()
        }

        val text = sharedText()?.trim()?.take(MAX_TEXT_CHARS)?.takeIf { it.isNotEmpty() }
        val image = sharedImage()
        val document = sharedDocument()
        if (image == null && document == null) {
            OverlayService.deliver(this, text = text)
            return finish()
        }

        val app = applicationContext
        if (document != null) {
            // Copy the document while this activity still holds the share grant for it.
            Thread {
                val (saved, error) = try {
                    DocumentUtils.save(app, document) to null
                } catch (e: DocumentUtils.TooBig) {
                    null to getString(R.string.file_too_big)
                }
                runOnUiThread {
                    OverlayService.deliver(
                        app,
                        text = text,
                        file = saved,
                        error = error ?: if (saved == null) getString(R.string.file_unreadable) else null,
                    )
                    finish()
                }
            }.start()
            return
        }

        // Read the photo while this activity still holds the share grant for it.
        val photo = image ?: return finish()
        Thread {
            val path = ImageUtils.decode(app, photo)?.let { ImageUtils.save(app, it).also { _ -> it.recycle() } }
            runOnUiThread {
                OverlayService.deliver(
                    app,
                    text = text,
                    imagePath = path,
                    error = if (path == null) getString(R.string.image_unreadable) else null,
                )
                finish()
            }
        }.start()
    }

    private fun sharedText(): String? = when (intent.action) {
        Intent.ACTION_PROCESS_TEXT -> intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
        Intent.ACTION_SEND -> {
            val body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
            // Shared links often come as subject (page title) + text (URL).
            listOfNotNull(subject?.takeIf { body == null || !body.contains(it) }, body).joinToString("\n").ifEmpty { null }
        }
        else -> null
    }

    /** A shared document (PDF, Word, text file…): a stream that isn't an image. */
    private fun sharedDocument(): Uri? {
        if (intent.action != Intent.ACTION_SEND || intent.type?.startsWith("image/") == true) return null
        return IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
    }

    private fun sharedImage(): Uri? {
        if (intent.action != Intent.ACTION_SEND || intent.type?.startsWith("image/") != true) return null
        return IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
    }

    private companion object {
        const val MAX_TEXT_CHARS = 4000
    }
}
