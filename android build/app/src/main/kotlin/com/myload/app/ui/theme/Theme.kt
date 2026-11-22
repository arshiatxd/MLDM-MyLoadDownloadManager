package com.myload.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import com.myload.app.model.AppSettings
import com.myload.app.model.CustomThemeColors
import com.myload.app.model.ThemeMode

@Immutable
data class MyLoadPalette(
  val bgCanvas: Color,
  val bgSurface: Color,
  val bgElevated: Color,
  val bgHover: Color,
  val accent: Color,
  val accentSoft: Color,
  val textPrimary: Color,
  val textSecondary: Color,
  val textMuted: Color,
  val borderSubtle: Color,
  val borderStrong: Color,
  val success: Color,
  val warning: Color,
  val danger: Color,
  val isDark: Boolean,
)

val LocalMyLoadPalette = staticCompositionLocalOf {
  MyLoadPalette(
    bgCanvas = Color(0xFF121215),
    bgSurface = Color(0xFF1A1A1F),
    bgElevated = Color(0xFF23232A),
    bgHover = Color(0xFF2C2C35),
    accent = Color(0xFFC81E3D),
    accentSoft = Color(0x33C81E3D),
    textPrimary = Color(0xFFF5F5F9),
    textSecondary = Color(0xFFB4B4C2),
    textMuted = Color(0xFF7E7E8F),
    borderSubtle = Color(0xFF2E2E38),
    borderStrong = Color(0xFF454554),
    success = Color(0xFF22C55E),
    warning = Color(0xFFF59E0B),
    danger = Color(0xFFEF4444),
    isDark = true,
  )
}

fun parseHexColor(hex: String, fallback: Color): Color {
  val clean = hex.trim().removePrefix("#")
  return try {
    when (clean.length) {
      6 -> Color(("FF$clean").toLong(16))
      8 -> Color(clean.toLong(16))
      else -> fallback
    }
  } catch (_: Exception) {
    fallback
  }
}

private fun buildPalette(mode: ThemeMode, systemDark: Boolean, custom: CustomThemeColors): MyLoadPalette {
  return when (mode) {
    ThemeMode.LIGHT -> MyLoadPalette(
      bgCanvas = Color(0xFFF4F4F7),
      bgSurface = Color(0xFFFFFFFF),
      bgElevated = Color(0xFFECECF1),
      bgHover = Color(0xFFE2E2EA),
      accent = Color(0xFFA91532),
      accentSoft = Color(0x24A91532),
      textPrimary = Color(0xFF17171C),
      textSecondary = Color(0xFF4B4B58),
      textMuted = Color(0xFF767685),
      borderSubtle = Color(0xFFD6D6E0),
      borderStrong = Color(0xFFB2B2C2),
      success = Color(0xFF16A34A),
      warning = Color(0xFFD97706),
      danger = Color(0xFFDC2626),
      isDark = false,
    )
    ThemeMode.HIGH_CONTRAST -> MyLoadPalette(
      bgCanvas = Color(0xFF000000),
      bgSurface = Color(0xFF0B0B0E),
      bgElevated = Color(0xFF16161C),
      bgHover = Color(0xFF24242E),
      accent = Color(0xFFFF2E55),
      accentSoft = Color(0x40FF2E55),
      textPrimary = Color(0xFFFFFFFF),
      textSecondary = Color(0xFFE4E4EE),
      textMuted = Color(0xFFB8B8C8),
      borderSubtle = Color(0xFF525264),
      borderStrong = Color(0xFF8E8EA4),
      success = Color(0xFF4ADE80),
      warning = Color(0xFFFBBF24),
      danger = Color(0xFFF87171),
      isDark = true,
    )
    ThemeMode.CUSTOM -> {
      val accent = parseHexColor(custom.accentHex, Color(0xFFC81E3D))
      MyLoadPalette(
        bgCanvas = parseHexColor(custom.bgCanvasHex, Color(0xFF121215)),
        bgSurface = parseHexColor(custom.bgSurfaceHex, Color(0xFF1A1A1F)),
        bgElevated = parseHexColor(custom.bgElevatedHex, Color(0xFF23232A)),
        bgHover = Color(0xFF2C2C35),
        accent = accent,
        accentSoft = accent.copy(alpha = 0.22f),
        textPrimary = parseHexColor(custom.textPrimaryHex, Color(0xFFF5F5F9)),
        textSecondary = parseHexColor(custom.textSecondaryHex, Color(0xFFB4B4C2)),
        textMuted = Color(0xFF858596),
        borderSubtle = Color(0xFF2E2E38),
        borderStrong = Color(0xFF4A4A5A),
        success = Color(0xFF22C55E),
        warning = Color(0xFFF59E0B),
        danger = Color(0xFFEF4444),
        isDark = true,
      )
    }
    ThemeMode.SYSTEM -> if (systemDark) {
      buildPalette(ThemeMode.DARK, true, custom)
    } else {
      buildPalette(ThemeMode.LIGHT, false, custom)
    }
    ThemeMode.DARK -> MyLoadPalette(
      bgCanvas = Color(0xFF121215),
      bgSurface = Color(0xFF1A1A1F),
      bgElevated = Color(0xFF23232A),
      bgHover = Color(0xFF2C2C35),
      accent = Color(0xFFC81E3D),
      accentSoft = Color(0x33C81E3D),
      textPrimary = Color(0xFFF5F5F9),
      textSecondary = Color(0xFFB4B4C2),
      textMuted = Color(0xFF7E7E8F),
      borderSubtle = Color(0xFF2E2E38),
      borderStrong = Color(0xFF454554),
      success = Color(0xFF22C55E),
      warning = Color(0xFFF59E0B),
      danger = Color(0xFFEF4444),
      isDark = true,
    )
  }
}

@Composable
fun MyLoadTheme(
  settings: AppSettings,
  content: @Composable () -> Unit,
) {
  val systemDark = isSystemInDarkTheme()
  val palette = buildPalette(settings.themeMode, systemDark, settings.customColors)
  val colorScheme = if (palette.isDark) {
    darkColorScheme(
      primary = palette.accent,
      onPrimary = Color.White,
      background = palette.bgCanvas,
      onBackground = palette.textPrimary,
      surface = palette.bgSurface,
      onSurface = palette.textPrimary,
      surfaceVariant = palette.bgElevated,
      onSurfaceVariant = palette.textSecondary,
      error = palette.danger,
      outline = palette.borderSubtle,
    )
  } else {
    lightColorScheme(
      primary = palette.accent,
      onPrimary = Color.White,
      background = palette.bgCanvas,
      onBackground = palette.textPrimary,
      surface = palette.bgSurface,
      onSurface = palette.textPrimary,
      surfaceVariant = palette.bgElevated,
      onSurfaceVariant = palette.textSecondary,
      error = palette.danger,
      outline = palette.borderSubtle,
    )
  }

  val baseDensity = LocalDensity.current
  val scaledDensity = Density(
    density = baseDensity.density,
    fontScale = baseDensity.fontScale * settings.fontScale.factor,
  )
  val layoutDir = if (settings.language.isRtl) LayoutDirection.Rtl else LayoutDirection.Ltr

  CompositionLocalProvider(
    LocalMyLoadPalette provides palette,
    LocalDensity provides scaledDensity,
    LocalLayoutDirection provides layoutDir,
  ) {
    MaterialTheme(
      colorScheme = colorScheme,
      typography = Typography(),
      content = content,
    )
  }
}
