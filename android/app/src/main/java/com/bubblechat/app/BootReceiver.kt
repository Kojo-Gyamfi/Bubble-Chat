package com.bubblechat.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log

/** Brings the bubble back after a reboot or app update if the user had it on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!Prefs(context).bubbleEnabled || !Settings.canDrawOverlays(context)) return
        try {
            OverlayService.start(context)
        } catch (e: Exception) {
            // Some OEMs block background starts until the user opens the app once.
            Log.w(TAG, "Could not restart the bubble", e)
        }
    }

    private companion object {
        const val TAG = "BootReceiver"
    }
}
