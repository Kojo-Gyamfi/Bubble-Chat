package com.bubblechat.app

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/** Small persisted state: link token, bubble position, and whether the bubble should be running. */
class Prefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("bubble", Context.MODE_PRIVATE)

    /**
     * Firebase custom token from the bubble://link deep link. Valid for one hour;
     * the web page deletes it via Android.onLinked() once it has signed in.
     */
    var authToken: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit { if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value) }

    /**
     * Account the bubble's web page is signed in as (its email), reported via
     * Android.setAccount(); null when signed out or not known yet.
     */
    var linkedAccount: String?
        get() = prefs.getString(KEY_ACCOUNT, null)
        set(value) = prefs.edit { if (value.isNullOrBlank()) remove(KEY_ACCOUNT) else putString(KEY_ACCOUNT, value) }

    /** True while the user wants the bubble on; restarted after reboot/app update. */
    var bubbleEnabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, false)
        set(value) = prefs.edit { putBoolean(KEY_ENABLED, value) }

    /** Which screen edge the bubble is docked to. */
    var bubbleOnRight: Boolean
        get() = prefs.getBoolean(KEY_RIGHT, true)
        set(value) = prefs.edit { putBoolean(KEY_RIGHT, value) }

    /** Vertical position as a fraction of the usable height, so it survives rotation. */
    var bubbleYFraction: Float
        get() = prefs.getFloat(KEY_Y, 0.35f)
        set(value) = prefs.edit { putFloat(KEY_Y, value.coerceIn(0f, 1f)) }

    /** Lets the setup screen update live while the service changes these values. Keep a strong reference to [listener]. */
    fun observe(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        prefs.registerOnSharedPreferenceChangeListener(listener)

    fun stopObserving(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        prefs.unregisterOnSharedPreferenceChangeListener(listener)

    private companion object {
        const val KEY_TOKEN = "auth_token"
        const val KEY_ACCOUNT = "linked_account"
        const val KEY_ENABLED = "bubble_enabled"
        const val KEY_RIGHT = "bubble_on_right"
        const val KEY_Y = "bubble_y_fraction"
    }
}
