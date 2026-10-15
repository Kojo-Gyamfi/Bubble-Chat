package com.bubblechat.app

import android.content.Context
import android.util.TypedValue

/** dp → px. */
fun Context.dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
