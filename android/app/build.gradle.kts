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

// Release signing: android/keystore.properties is gitignored. See keystore.properties.example.
// When it's absent (fresh clone, CI without secrets) the release build is simply left unsigned
// so the project still configures and debug builds work.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasKeystore = keystoreProps.getProperty("storeFile") != null

android {
    namespace = "com.bubblechat.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.bubblechat.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.4.0"
    }

    signingConfigs {
        if (hasKeystore) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
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
            // Signed only when keystore.properties is present; otherwise an unsigned APK.
            signingConfig = if (hasKeystore) signingConfigs.getByName("release") else null
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
