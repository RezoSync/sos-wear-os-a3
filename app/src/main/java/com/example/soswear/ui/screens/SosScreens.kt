package com.example.soswear.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.ToggleChip
import androidx.wear.compose.material.Switch
import com.example.soswear.data.SosSettings
import com.example.soswear.data.SosUiState
import com.example.soswear.viewmodel.SosAppState
import com.example.soswear.ui.theme.SosColors
import com.example.soswear.ui.theme.SosSpacing
import com.example.soswear.ui.theme.SosType
import java.util.Locale

private val SosRed = SosColors.sos

@Composable
fun HomeScreen(
    state: SosAppState,
    onStartSos: () -> Unit,
    onSettings: () -> Unit,
) {
    val hapticFeedback = LocalHapticFeedback.current
    val pulse = rememberInfiniteTransition(label = "sos-home-pulse")
    val buttonScale by pulse.animateFloat(
        initialValue = 1f,
        targetValue = 1.035f,
        animationSpec = infiniteRepeatable(tween(1_700), RepeatMode.Reverse),
        label = "button-scale",
    )
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = SosSpacing.screenHorizontal,
            top = SosSpacing.screenVertical,
            end = SosSpacing.screenHorizontal,
            bottom = SosSpacing.screenVertical,
        ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        userScrollEnabled = false,
    ) {
        item {
            Text(
                "Mantén pulsado",
                textAlign = TextAlign.Center,
                style = SosType.caption,
                maxLines = 1,
                color = MaterialTheme.colors.onBackground.copy(alpha = 0.75f),
            )
        }
        item {
            Text(
                text = "⚙",
                modifier = Modifier
                    .clickable(role = Role.Button, onClick = onSettings)
                    .padding(vertical = 4.dp),
                fontSize = 16.sp,
                color = SosColors.muted,
                maxLines = 1,
            )
        }
        if (state.session.message != null) {
            item {
                Text(
                    state.session.message,
                    color = SosColors.warning,
                    textAlign = TextAlign.Center,
                    fontSize = 11.sp,
                )
            }
        }
        item {
            Button(
                onClick = {
                    hapticFeedback.performHapticFeedback(HapticFeedbackType.LongPress)
                    onStartSos()
                },
                modifier = Modifier
                    .size(78.dp)
                    .graphicsLayer {
                        scaleX = buttonScale
                        scaleY = buttonScale
                    },
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(backgroundColor = SosRed),
            ) {
                Text("SOS", fontSize = 26.sp, fontWeight = FontWeight.Bold)
            }
        }
        item {
            Text(
                "Backend · ${state.session.connectionStatus}",
                color = SosColors.muted,
                fontSize = 9.sp,
                maxLines = 1,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
fun ConfirmationScreen(
    session: SosUiState,
    onCancel: () -> Unit,
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = SosSpacing.screenVertical),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        item {
            Text("CONFIRMA SOS", color = SosRed, fontWeight = FontWeight.Bold)
        }
        item {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(94.dp)) {
                CircularProgressIndicator(
                    progress = if (session.trigger == "manual") {
                        session.countdownSeconds.coerceIn(0, 5) / 5f
                    } else {
                        session.countdownSeconds.coerceIn(0, 10) / 10f
                    },
                    modifier = Modifier.fillMaxSize(),
                    indicatorColor = SosRed,
                    trackColor = Color(0xFF3A2426),
                    strokeWidth = 5.dp,
                )
                Text(
                    if (session.isCountingDown) session.countdownSeconds.toString() else "!",
                    style = SosType.hero,
                )
            }
        }
        item {
            Text(
                session.message ?: "La emergencia inicia al terminar la cuenta regresiva.",
                textAlign = TextAlign.Center,
                fontSize = 11.sp,
            )
        }
        item {
            Button(
                onClick = onCancel,
                enabled = session.isCountingDown,
                colors = ButtonDefaults.buttonColors(backgroundColor = Color(0xFF41464F)),
            ) {
                Text("CANCELAR")
            }
        }
        if (!session.isCountingDown && !session.awaitingPermissions) {
            item {
                Chip(label = { Text("Volver") }, onClick = onCancel)
            }
        }
    }
}

@Composable
fun ActiveSosScreen(
    session: SosUiState,
    onStop: () -> Unit,
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            horizontal = SosSpacing.screenHorizontal,
            vertical = SosSpacing.screenVertical,
        ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        item {
            val pulse = rememberInfiniteTransition(label = "sos-active-pulse")
            val alpha by pulse.animateFloat(
                initialValue = 1f,
                targetValue = 0.45f,
                animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
                label = "active-alpha",
            )
            Text("● SOS ACTIVO", color = SosRed, fontWeight = FontWeight.Bold, modifier = Modifier.graphicsLayer { this.alpha = alpha })
        }
        session.contactoEnCamino?.let { name ->
            item {
                Text(
                    "✓ $name va en camino",
                    color = SosColors.confirmation,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                )
            }
        }
        item {
            Text(session.connectionStatus, fontSize = 12.sp, textAlign = TextAlign.Center)
        }
        item {
            Text(
                if (session.latitude != null && session.longitude != null) {
                    "${session.latitude.formatCoordinate()}, ${session.longitude.formatCoordinate()}"
                } else {
                    "Buscando ubicación…"
                },
                textAlign = TextAlign.Center,
                fontSize = 12.sp,
            )
        }
        item {
            Text(
                session.accuracyMeters?.let { "Precisión: ${it.toInt()} m" } ?: "Precisión: —",
                fontSize = 11.sp,
            )
        }
        item {
            Text(
                session.lastSentAt?.let { "Enviado: ${it.formatTime()}" } ?: "Aún sin envío",
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
            )
        }
        session.lastError?.let { error ->
            item {
                Text(
                    "Último error: $error",
                    color = SosRed,
                    fontSize = 10.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }
        session.message?.let { message ->
            item {
                Text(message, color = SosColors.warning, fontSize = 10.sp, textAlign = TextAlign.Center)
            }
        }
        item {
            Button(
                onClick = onStop,
                modifier = Modifier.fillMaxWidth(0.84f),
                colors = ButtonDefaults.buttonColors(backgroundColor = SosRed),
            ) {
                Text("Detener SOS", maxLines = 1, fontSize = 12.sp)
            }
        }
    }
}

@Composable
fun SettingsScreen(
    state: SosAppState,
    onSave: (String, String) -> Unit,
    onDetectionSettings: (SosSettings) -> Unit,
    onSimulate: (String) -> Unit,
    onBack: () -> Unit,
) {
    var userName by remember(state.settings.userName) { mutableStateOf(state.settings.userName) }
    var backendUrl by remember(state.settings.backendUrl) { mutableStateOf(state.settings.backendUrl) }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = SosSpacing.screenVertical),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        item {
            Text("Configuración", fontWeight = FontWeight.Bold)
        }
        item {
            Text("Detección automática", fontWeight = FontWeight.Bold)
        }
        item {
            Text(
                "Prototipo educativo. No es un dispositivo médico.",
                color = Color(0xFFFFC857),
                fontSize = 10.sp,
                textAlign = TextAlign.Center,
            )
        }
        item {
            ToggleChip(
                label = { Text("Voz: auxilio", maxLines = 1) },
                checked = state.settings.detectVoice,
                onCheckedChange = {
                    onDetectionSettings(state.settings.copy(detectVoice = it))
                },
                toggleControl = { Switch(checked = state.settings.detectVoice) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            ToggleChip(
                label = { Text("Pulso anómalo", maxLines = 1) },
                checked = state.settings.detectPulse,
                onCheckedChange = {
                    onDetectionSettings(state.settings.copy(detectPulse = it))
                },
                toggleControl = { Switch(checked = state.settings.detectPulse) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            ToggleChip(
                label = { Text("Carrera", maxLines = 1) },
                checked = state.settings.detectRunning,
                onCheckedChange = {
                    onDetectionSettings(state.settings.copy(detectRunning = it))
                },
                toggleControl = { Switch(checked = state.settings.detectRunning) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Chip(
                label = { Text("Simular: auxilio", maxLines = 1) },
                onClick = { onSimulate("voz") },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Chip(
                label = { Text("Simular: pulso anómalo", maxLines = 1) },
                onClick = { onSimulate("pulso") },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Chip(
                label = { Text("Simular: carrera", maxLines = 1) },
                onClick = { onSimulate("carrera") },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        state.session.message?.let { message ->
            item { Text(message, color = Color(0xFFFFC857), fontSize = 10.sp, textAlign = TextAlign.Center) }
        }
        item {
            Text("Nombre de usuario", fontSize = 11.sp)
        }
        item {
            SettingsInput(value = userName, placeholder = "Tu nombre", onValueChange = { userName = it })
        }
        item {
            Text("URL del backend", fontSize = 11.sp)
        }
        item {
            SettingsInput(
                value = backendUrl,
                placeholder = "http://10.0.2.2:3000",
                keyboardType = KeyboardType.Uri,
                onValueChange = { backendUrl = it },
            )
        }
        item {
            Text("Para el emulador usa 10.0.2.2.", fontSize = 10.sp, textAlign = TextAlign.Center)
        }
        state.settingsFeedback?.let { feedback ->
            item {
                Text(feedback, color = Color(0xFFFFC857), fontSize = 10.sp, textAlign = TextAlign.Center)
            }
        }
        item {
            Chip(
                label = { Text("Guardar") },
                onClick = { onSave(userName, backendUrl) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Chip(label = { Text("Volver") }, onClick = onBack, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun SettingsInput(
    value: String,
    placeholder: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    onValueChange: (String) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Color(0xFF666B75), RoundedCornerShape(16.dp))
            .background(Color(0xFF22262D), RoundedCornerShape(16.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text(placeholder, color = Color(0xFF9197A1), fontSize = 11.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                textStyle = MaterialTheme.typography.body2.copy(
                    color = MaterialTheme.colors.onBackground,
                    fontSize = 11.sp,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

private fun Double.formatCoordinate(): String = String.format(Locale.US, "%.5f", this)

private fun Long.formatTime(): String = java.text.SimpleDateFormat(
    "HH:mm:ss",
    Locale.getDefault(),
).format(java.util.Date(this))
