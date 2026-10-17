package com.bubblechat.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import java.io.File
import java.util.UUID
import kotlin.math.max

/**
 * Photos handed to the chat page: decoded at a modest size and saved as JPEG
 * in the cache, then read once by the page via Android.takePending(). The web
 * page resizes again for the model and makes the history thumbnail.
 */
object ImageUtils {
    /** Long side kept here; the page scales down to 1280 for the model anyway. */
    private const val MAX_PX = 1600
    private const val JPEG_QUALITY = 85

    private fun dir(context: Context): File = File(context.cacheDir, "pending").apply { mkdirs() }

    /** Decodes [uri] (camera file, gallery or share sheet), downscaled; null if it isn't a readable image. */
    fun decode(context: Context, uri: Uri): Bitmap? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // ImageDecoder applies EXIF rotation and handles HEIC.
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                val longSide = max(info.size.width, info.size.height)
                if (longSide > MAX_PX) {
                    val scale = MAX_PX.toFloat() / longSide
                    decoder.setTargetSize((info.size.width * scale).toInt(), (info.size.height * scale).toInt())
                }
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_PX) sample *= 2
            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        }
    } catch (e: Exception) {
        null
    }

    /** Saves [bitmap] (scaled to MAX_PX) as a JPEG in the cache; returns its path. */
    fun save(context: Context, bitmap: Bitmap): String {
        val longSide = max(bitmap.width, bitmap.height)
        val scaled = if (longSide > MAX_PX) {
            val scale = MAX_PX.toFloat() / longSide
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
        } else {
            bitmap
        }
        val file = File(dir(context), "${UUID.randomUUID()}.jpg")
        file.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
        if (scaled !== bitmap) scaled.recycle()
        return file.absolutePath
    }

    /** Reads a saved image as a data URL and deletes it (it's single-use). Null if it's gone. */
    fun takeAsDataUrl(context: Context, path: String): String? {
        val file = File(path)
        // Only our own cache folder, never an arbitrary path.
        if (file.parentFile?.canonicalPath != dir(context).canonicalPath || !file.exists()) return null
        return try {
            "data:image/jpeg;base64," + Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
        } finally {
            file.delete()
        }
    }

    /** File the camera app writes the photo into (shared through our FileProvider). */
    fun newCameraFile(context: Context): File =
        File(context.cacheDir, "camera").apply { mkdirs() }.let { File(it, "photo.jpg") }
}
