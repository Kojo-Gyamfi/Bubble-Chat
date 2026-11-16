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
        // Keep watching over the bubble, even if this start is refused.
        KeepAliveJob.schedule(context)
        try {
            OverlayService.start(context)
        } catch (e: Exception) {
            // Some OEMs (and Android 15+) block background starts: offer a one-tap restore instead.
            Log.w(TAG, "Could not restart the bubble", e)
            KeepAliveJob.showRestoreNotification(context)
        }
    }

    private companion object {
        const val TAG = "BootReceiver"
    }
}
