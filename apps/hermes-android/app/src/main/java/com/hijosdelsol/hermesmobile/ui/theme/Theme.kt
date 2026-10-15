package com.hijosdelsol.hermesmobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val AcidLime = Color(0xFFE7FF6A)
private val Ink = Color(0xFF070707)
private val Forest = Color(0xFF29351E)
private val Surface = Color(0xFF171717)
private val SurfaceElevated = Color(0xFF232323)
private val TextPrimary = Color(0xFFF5F5F5)
private val TextSecondary = Color(0xFFA7A7A7)
private val Warning = Color(0xFFFFC857)

private val HermesColors = darkColorScheme(
    primary = AcidLime,
    onPrimary = Ink,
    primaryContainer = Forest,
    onPrimaryContainer = TextPrimary,
    secondary = Color(0xFF9BE7D7),
    onSecondary = Ink,
    background = Ink,
    onBackground = TextPrimary,
    surface = Surface,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceElevated,
    onSurfaceVariant = TextSecondary,
    outline = Color(0xFF3B3B3B),
    error = Color(0xFFFF8A80),
    onError = Ink,
)

private val HermesTypography = Typography(
    headlineLarge = androidx.compose.ui.text.TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 32.sp,
        lineHeight = 38.sp,
    ),
    headlineSmall = androidx.compose.ui.text.TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
    ),
    titleLarge = androidx.compose.ui.text.TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
    ),
    titleMedium = androidx.compose.ui.text.TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
        lineHeight = 22.sp,
    ),
    bodyLarge = androidx.compose.ui.text.TextStyle(
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    bodyMedium = androidx.compose.ui.text.TextStyle(
        fontSize = 14.sp,
        lineHeight = 21.sp,
    ),
    labelLarge = androidx.compose.ui.text.TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
)

@Composable
fun HermesPocketTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = HermesColors,
        typography = HermesTypography,
        content = content,
    )
}

val HermesMono: FontFamily = FontFamily.Monospace
val HermesWarning: Color = Warning
