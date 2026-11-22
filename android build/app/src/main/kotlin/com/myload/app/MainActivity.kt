package com.myload.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.myload.app.engine.MyLoadController
import com.myload.app.model.FormatUtils
import com.myload.app.ui.MyLoadScreen

class MainActivity : ComponentActivity() {
  private var pendingIntentSource by mutableStateOf<String?>(null)

  private val notificationPermissionLauncher = registerForActivityResult(
    ActivityResultContracts.RequestPermission()
  ) {}

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED
      ) {
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      }
    }

    extractIntentSource(intent)?.let { pendingIntentSource = it }

    val controller = MyLoadController.getInstance(applicationContext)

    setContent {
      MyLoadScreen(
        controller = controller,
        incomingIntentSource = pendingIntentSource,
        onConsumeIntentSource = { pendingIntentSource = null },
      )
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    extractIntentSource(intent)?.let { pendingIntentSource = it }
  }

  private fun extractIntentSource(intent: Intent?): String? {
    if (intent == null) return null
    when (intent.action) {
      Intent.ACTION_SEND -> {
        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
        val first = FormatUtils.extractMultipleSources(sharedText).firstOrNull()
        return first ?: sharedText.takeIf { it.isNotBlank() }
      }
      Intent.ACTION_VIEW -> {
        val dataStr = intent.dataString?.trim()
        if (!dataStr.isNullOrBlank()) return dataStr
      }
    }
    return null
  }
}
