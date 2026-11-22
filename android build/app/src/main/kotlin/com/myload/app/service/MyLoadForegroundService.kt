package com.myload.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.myload.app.MainActivity
import com.myload.app.R
import com.myload.app.engine.MyLoadController
import com.myload.app.model.FormatUtils

class MyLoadForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "myload_active_downloads"
    const val COMPLETION_CHANNEL_ID = "myload_completed_downloads"
    const val NOTIFICATION_ID = 49173
    const val ACTION_UPDATE = "com.myload.app.action.UPDATE_SERVICE"
    const val ACTION_PAUSE_ALL = "com.myload.app.action.PAUSE_ALL"
    const val ACTION_STOP = "com.myload.app.action.STOP_SERVICE"
    const val EXTRA_ACTIVE_COUNT = "extra_active_count"
    const val EXTRA_SPEED_BYTES = "extra_speed_bytes"
    const val EXTRA_PROGRESS_PCT = "extra_progress_pct"

    fun ensureChannels(context: Context) {
      val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val activeChannel = NotificationChannel(
        CHANNEL_ID,
        "Active Downloads",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Shows real-time download speed and progress while MyLoad is running"
        setShowBadge(false)
      }
      val completeChannel = NotificationChannel(
        COMPLETION_CHANNEL_ID,
        "Completed Downloads",
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = "Alerts when downloads finish"
      }
      mgr.createNotificationChannel(activeChannel)
      mgr.createNotificationChannel(completeChannel)
    }

    fun syncState(
      context: Context,
      activeCount: Int,
      totalSpeedBytes: Long,
      averageProgressPct: Int,
    ) {
      try {
        ensureChannels(context)
        if (activeCount <= 0) {
          val stopIntent = Intent(context, MyLoadForegroundService::class.java).apply {
            action = ACTION_STOP
          }
          context.stopService(stopIntent)
          return
        }
        val intent = Intent(context, MyLoadForegroundService::class.java).apply {
          action = ACTION_UPDATE
          putExtra(EXTRA_ACTIVE_COUNT, activeCount)
          putExtra(EXTRA_SPEED_BYTES, totalSpeedBytes)
          putExtra(EXTRA_PROGRESS_PCT, averageProgressPct)
        }
        context.startForegroundService(intent)
      } catch (_: Exception) {
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    ensureChannels(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PAUSE_ALL -> {
        MyLoadController.getInstance(applicationContext).pauseAll()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_STOP -> {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
    }

    val activeCount = intent?.getIntExtra(EXTRA_ACTIVE_COUNT, 1) ?: 1
    val speedBytes = intent?.getLongExtra(EXTRA_SPEED_BYTES, 0L) ?: 0L
    val progressPct = intent?.getIntExtra(EXTRA_PROGRESS_PCT, 0) ?: 0
    val notification = buildNotification(activeCount, speedBytes, progressPct)

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (_: Exception) {
    }
    return START_STICKY
  }

  private fun buildNotification(activeCount: Int, speedBytes: Long, progressPct: Int): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val openPending = PendingIntent.getActivity(
      this,
      1,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val pauseIntent = Intent(this, MyLoadForegroundService::class.java).apply {
      action = ACTION_PAUSE_ALL
    }
    val pausePending = PendingIntent.getService(
      this,
      2,
      pauseIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val title = "$activeCount active download${if (activeCount == 1) "" else "s"} · ↓ ${FormatUtils.formatSpeed(speedBytes)}"
    val subtitle = "MyLoad Download Manager · $progressPct% overall"

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(subtitle)
      .setProgress(100, progressPct.coerceIn(0, 100), false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openPending)
      .addAction(0, "Pause All", pausePending)
      .build()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
