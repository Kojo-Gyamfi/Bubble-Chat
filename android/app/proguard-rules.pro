# The web page calls these via window.Android; R8 must not rename or drop them.
-keepclassmembers class com.bubblechat.app.JsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
