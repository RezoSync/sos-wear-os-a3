package com.example.soswear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme

object SosColors {
    val background = Color(0xFF090B0F)
    val surface = Color(0xFF171B22)
    val sos = Color(0xFFE53935)
    val confirmation = Color(0xFF43D17A)
    val warning = Color(0xFFFFC857)
    val muted = Color(0xFF9299A5)
}

object SosSpacing {
    val screenHorizontal = 8.dp
    val screenVertical = 24.dp
}

object SosType {
    val hero = TextStyle(fontSize = 34.sp, fontWeight = FontWeight.Bold)
    val heading = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Bold)
    val body = TextStyle(fontSize = 12.sp)
    val caption = TextStyle(fontSize = 10.sp)
}

@Composable
fun SosWearTheme(content: @Composable () -> Unit) {
    val colors = Colors(
        primary = SosColors.sos,
        primaryVariant = Color(0xFFB71C1C),
        secondary = SosColors.confirmation,
        secondaryVariant = Color(0xFF268B4A),
        background = SosColors.background,
        surface = SosColors.surface,
        error = SosColors.sos,
        onPrimary = Color.White,
        onSecondary = Color(0xFF07120A),
        onBackground = Color(0xFFF4F6F8),
        onSurface = Color(0xFFF4F6F8),
        onError = Color.White,
    )
    MaterialTheme(colors = colors, content = content)
}
