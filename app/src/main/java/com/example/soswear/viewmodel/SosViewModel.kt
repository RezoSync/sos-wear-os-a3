package com.example.soswear.viewmodel

import android.Manifest
import android.app.Application
import android.content.Intent
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.soswear.data.SosSessionStore
import com.example.soswear.data.SosSettings
import com.example.soswear.data.SosSettingsRepository
import com.example.soswear.data.SosUiState
import com.example.soswear.service.SosLocationService
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.UUID

data class SosAppState(
    val session: SosUiState = SosUiState(),
    val settings: SosSettings = SosSettings(),
    val settingsFeedback: String? = null,
)

class SosViewModel(application: Application) : AndroidViewModel(application) {
    private val settingsRepository = SosSettingsRepository(application)
    private val settingsFeedback = MutableStateFlow<String?>(null)
    private var countdownJob: Job? = null

    val uiState: StateFlow<SosAppState> = combine(
        SosSessionStore.state,
        settingsRepository.settings,
        settingsFeedback,
    ) { session, settings, feedback ->
        SosAppState(session, settings, feedback)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SosAppState())

    fun beginCountdown() {
        countdownJob?.cancel()
        SosSessionStore.update {
            it.copy(
                isCountingDown = true,
                countdownSeconds = 5,
                awaitingPermissions = false,
                message = null,
            )
        }
        countdownJob = viewModelScope.launch {
            for (seconds in 5 downTo 1) {
                SosSessionStore.update { it.copy(countdownSeconds = seconds) }
                delay(1_000)
            }
            SosSessionStore.update {
                it.copy(countdownSeconds = 0, awaitingPermissions = true)
            }
        }
    }

    fun cancelCountdown() {
        countdownJob?.cancel()
        countdownJob = null
        SosSessionStore.update {
            it.copy(
                isCountingDown = false,
                countdownSeconds = 5,
                awaitingPermissions = false,
                message = null,
            )
        }
    }

    fun onPermissionsResult(hasFineLocation: Boolean, notificationsAllowed: Boolean) {
        SosSessionStore.update { it.copy(awaitingPermissions = false) }
        if (!hasFineLocation) {
            SosSessionStore.update {
                it.copy(
                    isCountingDown = false,
                    connectionStatus = "Permiso requerido",
                    message = "Concede el permiso de ubicación precisa para iniciar el SOS.",
                )
            }
            return
        }

        val locationManager = getApplication<Application>().getSystemService(LocationManager::class.java)
        if (!locationManager.isLocationEnabled) {
            SosSessionStore.update {
                it.copy(
                    isCountingDown = false,
                    connectionStatus = "Ubicación apagada",
                    message = "Activa los servicios de ubicación del reloj y vuelve a intentar.",
                )
            }
            return
        }

        val currentSettings = uiState.value.settings
        val intent = Intent(getApplication(), SosLocationService::class.java).apply {
            action = SosLocationService.ACTION_START
            putExtra(SosLocationService.EXTRA_EMERGENCY_ID, UUID.randomUUID().toString())
            putExtra(SosLocationService.EXTRA_USER_NAME, currentSettings.userName)
            putExtra(SosLocationService.EXTRA_BACKEND_URL, currentSettings.backendUrl)
        }
        try {
            ContextCompat.startForegroundService(getApplication(), intent)
            SosSessionStore.update {
                it.copy(
                    isActive = true,
                    isCountingDown = false,
                    connectionStatus = "Iniciando SOS",
                    message = if (notificationsAllowed) null else {
                        "Notificaciones desactivadas: la emergencia sigue activa, pero quizá no veas su aviso."
                    },
                )
            }
        } catch (error: SecurityException) {
            SosSessionStore.update {
                it.copy(
                    isActive = false,
                    isCountingDown = false,
                    connectionStatus = "No se pudo iniciar",
                    message = error.localizedMessage ?: "Android rechazó el permiso del servicio de ubicación.",
                )
            }
        } catch (error: IllegalStateException) {
            SosSessionStore.update {
                it.copy(
                    isActive = false,
                    isCountingDown = false,
                    connectionStatus = "No se pudo iniciar",
                    message = error.localizedMessage ?: "Android no permitió iniciar el servicio en primer plano.",
                )
            }
        }
    }

    fun stopEmergency() {
        val intent = Intent(getApplication(), SosLocationService::class.java).apply {
            action = SosLocationService.ACTION_STOP
        }
        try {
            getApplication<Application>().startService(intent)
        } catch (error: IllegalStateException) {
            SosSessionStore.update {
                it.copy(
                    isActive = false,
                    connectionStatus = "SOS detenido localmente",
                    message = error.localizedMessage ?: "No se pudo contactar el servicio SOS.",
                )
            }
        }
    }

    fun saveSettings(userName: String, backendUrl: String) {
        settingsFeedback.value = null
        viewModelScope.launch {
            try {
                settingsRepository.save(userName, backendUrl)
                settingsFeedback.value = "Configuración guardada."
            } catch (error: IllegalArgumentException) {
                settingsFeedback.value = error.message ?: "Revisa los valores de configuración."
            } catch (error: IOException) {
                settingsFeedback.value = "No se pudo guardar la configuración: ${error.localizedMessage}"
            }
        }
    }
}
