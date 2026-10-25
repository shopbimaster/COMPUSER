package com.campuser.app

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * 教务导入登录页：应用内 WebView 打开教务系统（统一身份认证 + 课表查询页），
 * 用户在此完成登录；WebView 与主应用共享进程级 CookieManager，
 * 主应用随后可读取会话 Cookie 拉取课表数据。系统返回键 = 逐级后退 / 关闭本页。
 */
class HubLoginActivity : Activity() {
    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra("url")
            ?: "https://mhub.hust.edu.cn/kbPageController/by-course"
        val wv = WebView(this)
        wv.settings.javaScriptEnabled = true
        wv.settings.domStorageEnabled = true
        wv.webViewClient = WebViewClient() // 站内跳转留在本 Activity
        setContentView(wv)
        wv.loadUrl(url)
        webView = wv
    }

    override fun onBackPressed() {
        val wv = webView
        if (wv != null && wv.canGoBack()) wv.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
