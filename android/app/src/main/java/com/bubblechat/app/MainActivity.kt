package com.bubblechat.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.core.view.updatePadding
import com.bubblechat.app.databinding.ActivityMainBinding

/**
 * Setup screen: permissions, start/stop the bubble, account linking via the
 * bubble://link deep link, and background-reliability settings.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs

    /** A link arrived before "Display over other apps" was granted; start once it is. */
    private var startWhenPermitted = false

    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge() // targetSdk 35 is edge-to-edge anyway; pad for the system bars ourselves
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.updatePadding(left = bars.left, top = bars.top, right = bars.right, bottom = bars.bottom)
            insets
        }

        binding.version.text = getString(R.string.version_label, BuildConfig.VERSION_NAME)
        binding.grantOverlay.setOnClickListener { openOverlaySettings() }
        binding.grantNotifications.setOnClickListener { askForNotifications() }
        binding.toggleBubble.setOnClickListener { toggleBubble() }
        binding.relink.setOnClickListener { openUrl("${BuildConfig.BASE_URL}/link") }
        binding.openWebApp.setOnClickListener { openUrl(BuildConfig.BASE_URL) }
        binding.battery.setOnClickListener { askToIgnoreBatteryOptimizations() }
        binding.unusedApps.setOnClickListener { openUnusedAppSettings() }
        binding.appSettings.setOnClickListener {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }

        // Only on a fresh launch, so rotating the screen doesn't re-handle the same link.
        if (savedInstanceState == null) handleDeepLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    override fun onResume() {
        super.onResume()
        if (startWhenPermitted && Settings.canDrawOverlays(this)) {
            startWhenPermitted = false
            OverlayService.link(this)
        }
        refresh()
    }

    // ---------------------------------------------------------------- deep link

    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW || data.scheme != "bubble" || data.host != "link") return

        val token = data.getQueryParameter("token")
        // A Firebase custom token is a JWT: three dot-separated parts.
        if (token.isNullOrBlank() || token.count { it == '.' } != 2) {
            toast(R.string.link_invalid)
            return
        }
        prefs.authToken = token
        prefs.bubbleEnabled = true
        if (Settings.canDrawOverlays(this)) {
            OverlayService.link(this) // loads /overlay right away; the token lasts one hour
        } else {
            startWhenPermitted = true
            openOverlaySettings()
        }
        toast(R.string.linked_toast)
    }

    // ---------------------------------------------------------------- actions

    private fun toggleBubble() {
        when {
            OverlayService.isRunning -> OverlayService.stop(this)
            !Settings.canDrawOverlays(this) -> {
                toast(R.string.need_overlay_first)
                openOverlaySettings()
            }
            else -> OverlayService.start(this)
        }
        // The service starts/stops asynchronously.
        binding.root.postDelayed({ refresh() }, 400)
    }

    private fun openOverlaySettings() {
        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
    }

    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) || !prefsAskedNotifications()) {
            markAskedNotifications()
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            // Denied permanently: only the settings screen can change it now.
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
            )
        }
    }

    private fun askToIgnoreBatteryOptimizations() {
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")),
            )
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    /** Android 11+: "Pause app activity if unused" would eventually stop the bubble. */
    private fun openUnusedAppSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        try {
            startActivity(Intent(Intent.ACTION_AUTO_REVOKE_PERMISSIONS, Uri.fromParts("package", packageName, null)))
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
    }

    private fun openUrl(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, url, Toast.LENGTH_LONG).show()
        }
    }

    // ---------------------------------------------------------------- state

    private fun refresh() {
        val overlayOk = Settings.canDrawOverlays(this)
        setStatus(binding.overlayStatus, overlayOk)
        binding.grantOverlay.isVisible = !overlayOk

        val needsNotificationPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        binding.notificationsRow.isVisible = needsNotificationPermission
        binding.notificationsDivider.isVisible = needsNotificationPermission
        if (needsNotificationPermission) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            setStatus(binding.notificationsStatus, granted)
            binding.grantNotifications.isVisible = !granted
        }

        val running = OverlayService.isRunning
        binding.toggleBubble.setText(if (running) R.string.stop_bubble else R.string.start_bubble)
        binding.bubbleStatus.setText(if (running) R.string.bubble_running else R.string.bubble_stopped)

        val power = getSystemService(PowerManager::class.java)
        val unrestricted = power.isIgnoringBatteryOptimizations(packageName)
        binding.battery.isEnabled = !unrestricted
        binding.batteryDesc.setText(if (unrestricted) R.string.battery_ok else R.string.battery_desc)

        // Only shown while the app can still be paused for being "unused".
        val canBePaused = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !packageManager.isAutoRevokeWhitelisted
        binding.unusedDesc.isVisible = canBePaused
        binding.unusedApps.isVisible = canBePaused
    }

    private fun setStatus(view: TextView, ok: Boolean) {
        view.setText(if (ok) R.string.status_allowed else R.string.status_needed)
        view.setTextColor(ContextCompat.getColor(this, if (ok) R.color.ok else R.color.warn))
    }

    private fun prefsAskedNotifications(): Boolean =
        getSharedPreferences("ui", MODE_PRIVATE).getBoolean("asked_notifications", false)

    private fun markAskedNotifications() {
        getSharedPreferences("ui", MODE_PRIVATE).edit { putBoolean("asked_notifications", true) }
    }

    private fun toast(message: Int) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
