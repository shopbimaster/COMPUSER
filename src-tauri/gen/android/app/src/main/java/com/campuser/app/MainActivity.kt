package com.campuser.app

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // TauriActivity（WryActivity）在 WebView 建好后回调：注入 JS 桥，
  // 供前端在应用内切换深浅主题时同步系统状态栏图标颜色（深色页面→白图标）
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(StatusBarBridge(), "__campuserStatusBar")
  }

  private inner class StatusBarBridge {
    @JavascriptInterface
    fun setLightIcons(light: Boolean) {
      runOnUiThread {
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = light
      }
    }
  }
}
