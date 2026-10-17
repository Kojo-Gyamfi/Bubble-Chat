package com.bubblechat.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider

/**
 * Invisible helper for the bubble. The overlay panel lives in a Service, which
 * can't open pickers or system dialogs for a result, so it starts this
 * activity to: take a photo, pick one, run Google voice typing, or ask for
 * screen-capture consent. Results go back to [OverlayService], which reopens
 * the panel and hands them to the page.
 */
class ActionActivity : ComponentActivity() {

    private val cameraUri: Uri by lazy {
        FileProvider.getUriForFile(this, "$packageName.files", ImageUtils.newCameraFile(this))
    }

    private val takePhoto = registerForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        if (saved) deliverImage(cameraUri) else cancelled()
    }

    private val pickPhoto = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) deliverImage(uri) else cancelled()
    }

    private val pickDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) deliverDocument(uri) else cancelled()
    }

    private val voice = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        OverlayService.deliver(this, voice = text)
        finish()
    }

    private val screen = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            OverlayService.captureScreen(this, result.resultCode, data)
            finish()
        } else {
            cancelled()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Recreated after the system killed us mid-pick: the result callback comes on its own.
        if (savedInstanceState != null) return
        try {
            when (intent.getStringExtra(EXTRA_KIND)) {
                KIND_CAMERA -> takePhoto.launch(cameraUri)
                KIND_GALLERY -> pickPhoto.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
                KIND_FILE -> pickDocument.launch(DocumentUtils.PICKER_TYPES)
                KIND_VOICE -> voice.launch(
                    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.voice_prompt)),
                )
                KIND_SCREEN -> screen.launch(
                    getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent(),
                )
                else -> finish()
            }
        } catch (e: ActivityNotFoundException) {
            val message = when (intent.getStringExtra(EXTRA_KIND)) {
                KIND_CAMERA -> R.string.no_camera_app
                KIND_VOICE -> R.string.no_voice_app
                else -> R.string.action_failed
            }
            OverlayService.deliver(this, error = getString(message))
            finish()
        }
    }

    private fun deliverImage(uri: Uri) {
        val app = applicationContext
        // Decode off the main thread; we still hold the read grant for `uri` while it runs.
        Thread {
            val bitmap = ImageUtils.decode(app, uri)
            val path = bitmap?.let { ImageUtils.save(app, it).also { _ -> it.recycle() } }
            runOnUiThread {
                if (path != null) {
                    OverlayService.deliver(app, imagePath = path)
                } else {
                    OverlayService.deliver(app, error = getString(R.string.image_unreadable))
                }
                finish()
            }
        }.start()
    }

    private fun deliverDocument(uri: Uri) {
        val app = applicationContext
        Thread {
            val (saved, error) = try {
                DocumentUtils.save(app, uri) to null
            } catch (e: DocumentUtils.TooBig) {
                null to getString(R.string.file_too_big)
            }
            runOnUiThread {
                OverlayService.deliver(app, file = saved, error = error ?: if (saved == null) getString(R.string.file_unreadable) else null)
                finish()
            }
        }.start()
    }

    /** Back/cancel in the picker: just reopen the chat. */
    private fun cancelled() {
        OverlayService.deliver(this)
        finish()
    }

    companion object {
        private const val EXTRA_KIND = "kind"
        const val KIND_CAMERA = "camera"
        const val KIND_GALLERY = "gallery"
        const val KIND_FILE = "file"
        const val KIND_VOICE = "voice"
        const val KIND_SCREEN = "screen"

        fun intent(context: Context, kind: String): Intent =
            Intent(context, ActionActivity::class.java)
                .putExtra(EXTRA_KIND, kind)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
    }
}
