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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.example.soswear.data.SosUiState
import com.example.soswear.viewmodel.SosAppState
import java.util.Locale

private val SosRed = Color(0xFFE53935)

@Composable
fun HomeScreen(
    state: SosAppState,
    onStartSos: () -> Unit,
    onSettings: () -> Unit,
) {
    val hapticFeedback = LocalHapticFeedback.current
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 8.dp, top = 4.dp, end = 8.dp, bottom = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Bottom,
        userScrollEnabled = false,
    ) {
        item {
            Text(
                "Mantén pulsado",
                textAlign = TextAlign.Center,
                fontSize = 11.sp,
                maxLines = 1,
                color = MaterialTheme.colors.onBackground.copy(alpha = 0.75f),
            )
        }
        item {
            Text(
                text = "Configuración",
                modifier = Modifier
                    .clickable(role = Role.Button, onClick = onSettings)
                    .padding(vertical = 4.dp),
                fontSize = 11.sp,
                color = MaterialTheme.colors.onBackground.copy(alpha = 0.75f),
                maxLines = 1,
            )
        }
        if (state.session.message != null) {
            item {
                Text(
                    state.session.message,
                    color = Color(0xFFFFC857),
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
                modifier = Modifier.size(80.dp),
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(backgroundColor = SosRed),
            ) {
                Text("SOS", fontSize = 26.sp, fontWeight = FontWeight.Bold)
            }
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
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        item {
            Text("ENVIANDO SOS", color = SosRed, fontWeight = FontWeight.Bold)
        }
        item {
            Text(
                if (session.isCountingDown) session.countdownSeconds.toString() else "!",
                fontSize = 54.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        item {
            Text(
                session.message ?: "La emergencia inicia al terminar la cuenta regresiva.",
                textAlign = TextAlign.Center,
                fontSize = 12.sp,
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
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        item {
            Text("SOS ACTIVO", color = SosRed, fontWeight = FontWeight.Bold)
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
                    color = Color(0xFFFF777D),
                    fontSize = 10.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }
        session.message?.let { message ->
            item {
                Text(message, color = Color(0xFFFFC857), fontSize = 10.sp, textAlign = TextAlign.Center)
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
    onBack: () -> Unit,
) {
    var userName by remember(state.settings.userName) { mutableStateOf(state.settings.userName) }
    var backendUrl by remember(state.settings.backendUrl) { mutableStateOf(state.settings.backendUrl) }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        item {
            Text("Configuración", fontWeight = FontWeight.Bold)
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
