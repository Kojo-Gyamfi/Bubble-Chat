// Top-level build file. AGP 9 compiles Kotlin itself ("built-in Kotlin"),
// so there is no org.jetbrains.kotlin.android plugin.
plugins {
    alias(libs.plugins.android.application) apply false
}
