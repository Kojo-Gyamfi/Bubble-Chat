import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Per-machine settings live in android/local.properties (gitignored):
//   bubble.debugBaseUrl=https://<your-ngrok-domain>   (phone over USB; or http://<PC LAN IP>:3000)
//   bubble.releaseBaseUrl=https://your-app.vercel.app
// Release signing (Phase 5) reads android/keystore.properties.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun localProp(key: String, default: String): String = localProps.getProperty(key)?.trim()?.trimEnd('/') ?: default

android {
    namespace = "com.bubblechat.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.bubblechat.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    buildTypes {
        debug {
            // 10.0.2.2 is the host PC as seen from the Android emulator.
            buildConfigField("String", "BASE_URL", "\"${localProp("bubble.debugBaseUrl", "http://10.0.2.2:3000")}\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "BASE_URL", "\"${localProp("bubble.releaseBaseUrl", "https://your-app.vercel.app")}\"")
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.material)
}
