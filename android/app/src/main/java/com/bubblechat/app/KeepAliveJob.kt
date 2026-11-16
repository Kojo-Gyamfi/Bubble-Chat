package com.bubblechat.app

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.TimeUnit

/**
 * Watchdog that brings the bubble back if something other than the user closed
 * it: a phone's battery manager killing the app, swiping it out of Recents on
 * phones that kill the whole app for that, or a crash.
 *
 * It runs every 15 minutes (Android's minimum) while the bubble is on, and a
 * few seconds after the app is swiped away. If Android won't let a background
 * job start the bubble (Android 15+ unless an overlay is already showing), it
 * posts a "tap to bring the bubble back" notification instead.
 *
 * It never overrides the user: turning the bubble off (app or notification),
 * revoking "Display over other apps", Force stop, or "Stop" in Android's
 * active-apps panel all stay respected.
 */
class KeepAliveJob : JobService() {

    override fun onStartJob(params: JobParameters): Boolean {
        revive(this)
        return false // done, nothing running in the background
    }

    override fun onStopJob(params: JobParameters): Boolean = false

    companion object {
        private const val TAG = "KeepAliveJob"
        private const val PERIODIC_JOB_ID = 4101
        private const val SOON_JOB_ID = 4102
        private const val RESTORE_NOTIFICATION_ID = 4103

        /** Check every 15 minutes (the shortest period Android allows), also after reboots. */
        fun schedule(context: Context) {
            val job = JobInfo.Builder(PERIODIC_JOB_ID, ComponentName(context, KeepAliveJob::class.java))
                .setPeriodic(TimeUnit.MINUTES.toMillis(15))
                .setPersisted(true)
                .build()
            schedule(context, job)
        }

        /** Check again in a few seconds (e.g. the app was just swiped out of Recents). */
        fun scheduleSoon(context: Context) {
            val job = JobInfo.Builder(SOON_JOB_ID, ComponentName(context, KeepAliveJob::class.java))
                .setMinimumLatency(TimeUnit.SECONDS.toMillis(3))
                .setOverrideDeadline(TimeUnit.SECONDS.toMillis(30))
                .build()
            schedule(context, job)
        }

        /** The user turned the bubble off: stop watching. */
        fun cancel(context: Context) {
            val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
            scheduler.cancel(PERIODIC_JOB_ID)
            scheduler.cancel(SOON_JOB_ID)
            hideRestoreNotification(context)
        }

        private fun schedule(context: Context, job: JobInfo) {
            try {
                context.getSystemService(JobScheduler::class.java)?.schedule(job)
            } catch (e: Exception) {
                // Too many jobs / OEM restrictions: the bubble still works, just without the watchdog.
                Log.w(TAG, "Could not schedule the keep-alive job", e)
            }
        }

        /** Restart the bubble if the user wants it on but it isn't running. */
        fun revive(context: Context) {
            val prefs = Prefs(context)
            if (!prefs.bubbleEnabled || OverlayService.isRunning) return
            // "Display over other apps" turned off: that's the user's call.
            if (!Settings.canDrawOverlays(context)) return
            if (userStoppedApp(context, prefs)) {
                Log.i(TAG, "The user stopped the app from the system; leaving the bubble off")
                prefs.bubbleEnabled = false
                cancel(context)
                return
            }
            try {
                OverlayService.start(context)
            } catch (e: Exception) {
                // Android 12+ may refuse a foreground service started from the background
                // (on 15+, unless an overlay is already visible). A notification tap is allowed.
                Log.w(TAG, "Could not restart the bubble from the background", e)
                showRestoreNotification(context)
            }
        }

        /**
         * True if, since the bubble last started, the user pressed "Stop" for this app
         * in Android's active-apps panel (Android 13+). Swiping out of Recents isn't
         * this (the bubble should survive that), and Force stop cancels this job anyway.
         */
        private fun userStoppedApp(context: Context, prefs: Prefs): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
            return try {
                val am = context.getSystemService(ActivityManager::class.java) ?: return false
                val last = am.getHistoricalProcessExitReasons(context.packageName, 0, 1).firstOrNull() ?: return false
                last.reason == ApplicationExitInfo.REASON_USER_STOPPED && last.timestamp > prefs.bubbleStartedAt
            } catch (e: Exception) {
                false
            }
        }

        /** "The bubble was closed by your phone. Tap to bring it back." Tapping starts it directly. */
        fun showRestoreNotification(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            OverlayService.ensureNotificationChannel(context)
            val restart = PendingIntent.getForegroundService(
                context, 3, Intent(context, OverlayService::class.java).setAction(OverlayService.ACTION_START),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = NotificationCompat.Builder(context, OverlayService.CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_bubble)
                .setContentTitle(context.getString(R.string.restore_title))
                .setContentText(context.getString(R.string.restore_text))
                .setContentIntent(restart)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
            try {
                manager.notify(RESTORE_NOTIFICATION_ID, notification)
            } catch (e: SecurityException) {
                // Notifications not allowed: nothing more we can do from the background.
            }
        }

        fun hideRestoreNotification(context: Context) {
            context.getSystemService(NotificationManager::class.java)?.cancel(RESTORE_NOTIFICATION_ID)
        }
    }
}
