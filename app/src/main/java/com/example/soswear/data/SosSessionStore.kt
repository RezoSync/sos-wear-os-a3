package com.example.soswear.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SosUiState(
    val isActive: Boolean = false,
    val isCountingDown: Boolean = false,
    val countdownSeconds: Int = 5,
    val awaitingPermissions: Boolean = false,
    val emergencyId: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracyMeters: Float? = null,
    val lastLocationAt: Long? = null,
    val lastSentAt: Long? = null,
    val connectionStatus: String = "Sin iniciar",
    val lastError: String? = null,
    val message: String? = null,
)

object SosSessionStore {
    private val mutableState = MutableStateFlow(SosUiState())
    val state: StateFlow<SosUiState> = mutableState.asStateFlow()

    fun update(transform: (SosUiState) -> SosUiState) {
        mutableState.value = transform(mutableState.value)
    }
}
