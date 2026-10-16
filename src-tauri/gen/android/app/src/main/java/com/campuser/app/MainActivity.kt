package com.campuser.app

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // TauriActivity（WryActivity）在 WebView 建好后回调：注入 JS 桥，
  // 供前端在应用内切换深浅主题时同步系统状态栏图标颜色（深色页面→白图标）
  override fun onWebViewCreate(webView: WebView) {
    webViewRef = webView
    webView.addJavascriptInterface(StatusBarBridge(), "__campuserStatusBar")
  }

  // 从系统分享面板等外部页面返回时通知前端（ACTION_SEND 拿不到保存结果，
  // 由前端在 resume 事件里给出导出反馈）
  override fun onResume() {
    super.onResume()
    webViewRef?.evaluateJavascript(
      "document.dispatchEvent(new CustomEvent('campuser-resume'))",
      null,
    )
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
