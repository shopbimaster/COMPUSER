buildscript {
    repositories {
        // 本网络对 maven.google.com 不稳定：腾讯镜像优先，官方源兜底
        maven(url = "https://mirrors.cloud.tencent.com/nexus/repository/maven-public/")
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

allprojects {
    repositories {
        maven(url = "https://mirrors.cloud.tencent.com/nexus/repository/maven-public/")
        google()
        mavenCentral()
    }
    // tauri 插件子工程（指向 cargo 缓存）各自硬编码 compileSdk 34，
    // 而 tauri-android 要求 ≥36：统一抬升所有库工程的 compileSdk
    afterEvaluate {
        val ext = extensions.findByName("android")
        if (ext is com.android.build.gradle.LibraryExtension && (ext.compileSdk ?: 0) < 36) {
            ext.compileSdk = 37
        }
    }
}

tasks.register("clean").configure {
    delete("build")
}

