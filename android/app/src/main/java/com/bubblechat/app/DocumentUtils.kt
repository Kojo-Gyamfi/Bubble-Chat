package com.bubblechat.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Documents (PDF, Word, text) picked or shared into the bubble: copied into our
 * cache with a size cap, then read once by the page via Android.takePending().
 * The web page checks the type again; the server reads the text.
 */
object DocumentUtils {
    /** Same limit as the web app (the request must stay under Vercel's 4.5 MB). */
    const val MAX_BYTES = 3 * 1024 * 1024

    /** What the picker offers. Text covers txt/md/csv/code; the page re-checks by extension. */
    val PICKER_TYPES = arrayOf(
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/*",
        "application/json",
    )

    class TooBig : Exception()

    data class Saved(val path: String, val name: String, val mimeType: String)

    private fun dir(context: Context): File = File(context.cacheDir, "pending").apply { mkdirs() }

    /** Copies [uri] into the cache. Throws [TooBig] over the limit; null if unreadable. */
    fun save(context: Context, uri: Uri): Saved? {
        val resolver = context.contentResolver
        var name = "file"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1) && c.getLong(1) > MAX_BYTES) throw TooBig()
            }
        }
        val mimeType = resolver.getType(uri) ?: "application/octet-stream"
        val file = File(dir(context), "${UUID.randomUUID()}.doc")
        return try {
            resolver.openInputStream(uri)?.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_BYTES) throw TooBig() // size wasn't reported, or was wrong
                        output.write(buffer, 0, read)
                    }
                }
            } ?: return null
            Saved(file.absolutePath, name.replace(Regex("[\\\\/\\p{Cntrl}]"), "_").takeLast(200), mimeType)
        } catch (e: TooBig) {
            file.delete()
            throw e
        } catch (e: Exception) {
            file.delete()
            null
        }
    }

    /** JSON for the page ({name, mimeType, dataUrl}) and deletes the copy. Null if it's gone. */
    fun takeAsJson(context: Context, saved: Saved): JSONObject? {
        val file = File(saved.path)
        // Only our own cache folder, never an arbitrary path.
        if (file.parentFile?.canonicalPath != dir(context).canonicalPath || !file.exists()) return null
        return try {
            JSONObject()
                .put("name", saved.name)
                .put("mimeType", saved.mimeType)
                .put("dataUrl", "data:${saved.mimeType};base64," + Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
        } finally {
            file.delete()
        }
    }
}
