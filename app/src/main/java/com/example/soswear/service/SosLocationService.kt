package com.example.soswear.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.example.soswear.MainActivity
import com.example.soswear.R
import com.example.soswear.data.SosApi
import com.example.soswear.data.SosSessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.ArrayDeque

class SosLocationService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val api = SosApi()
    private val pendingOperations = ArrayDeque<PendingOperation>()
    private lateinit var locationRepository: LocationRepository
    private var retryJob: Job? = null
    private var emergencyId: String? = null
    private var userName: String = "Usuario"
    private var backendUrl: String = "http://10.0.2.2:3000"
    private var latestLocation: SosLocation? = null
    private var cancelRequested = false
    private var serverStarted = false
    private var startInProgress = false

    override fun onCreate() {
        super.onCreate()
        locationRepository = LocationRepository(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopEmergency()
            ACTION_START -> startEmergency(intent)
            else -> stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private fun startEmergency(intent: Intent) {
        if (!hasRequiredPermissions()) {
            SosSessionStore.update {
                it.copy(
                    isActive = false,
                    connectionStatus = "Sin permiso de ubicación",
                    message = "Concede ubicación precisa para iniciar el SOS.",
                )
            }
            stopSelf()
            return
        }

        emergencyId = intent.getStringExtra(EXTRA_EMERGENCY_ID)
        userName = intent.getStringExtra(EXTRA_USER_NAME) ?: "Usuario"
        backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL)?.trimEnd('/')
            ?: "http://10.0.2.2:3000"
        if (emergencyId.isNullOrBlank()) {
            SosSessionStore.update {
                it.copy(isActive = false, connectionStatus = "Error", message = "No se pudo crear el ID SOS.")
            }
            stopSelf()
            return
        }

        startForeground(NOTIFICATION_ID, buildNotification("SOS activo · obteniendo ubicación"))
        SosSessionStore.update {
            it.copy(isActive = true, connectionStatus = "Obteniendo ubicación", message = null)
        }
        locationRepository.start(
            onLocation = ::onLocation,
            onError = { error ->
                Log.e(TAG, "No se pudieron obtener actualizaciones de ubicación.", error)
                SosSessionStore.update {
                    it.copy(
                        connectionStatus = "Error de ubicación",
                        message = "Comprueba que el GPS esté encendido y vuelve a intentar.",
                    )
                }
            },
        )
        retryJob?.cancel()
        retryJob = serviceScope.launch { retryPendingOperations() }
    }

    private fun onLocation(location: SosLocation) {
        latestLocation = location
        SosSessionStore.update {
            it.copy(
                latitude = location.latitude,
                longitude = location.longitude,
                accuracyMeters = location.accuracyMeters,
                lastLocationAt = location.timeMillis,
                connectionStatus = if (serverStarted) "Conectado" else "Esperando backend",
            )
        }

        if (cancelRequested) return
        if (!serverStarted) {
            val queuedStart = pendingOperations.firstOrNull() as? PendingOperation.Start
            if (queuedStart != null) {
                pendingOperations.removeFirst()
                pendingOperations.addFirst(queuedStart.copy(location = location))
            } else if (startInProgress) {
                pendingOperations.removeAll { it is PendingOperation.Location }
                pendingOperations.addLast(PendingOperation.Location(location))
            } else if (pendingOperations.isEmpty()) {
                pendingOperations.addLast(PendingOperation.Start(location))
            }
        } else {
            val pendingLocation = pendingOperations.lastOrNull() as? PendingOperation.Location
            if (pendingLocation != null) {
                pendingOperations.removeLast()
            }
            pendingOperations.addLast(PendingOperation.Location(location))
        }
        refreshNotification()
    }

    private fun stopEmergency() {
        if (cancelRequested) return
        cancelRequested = true
        locationRepository.stop()
        pendingOperations.removeAll { it is PendingOperation.Location }
        if (!serverStarted && !startInProgress && pendingOperations.isEmpty()) {
            SosSessionStore.update {
                it.copy(isActive = false, connectionStatus = "SOS detenido", message = null)
            }
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        pendingOperations.addLast(PendingOperation.Cancel)
        SosSessionStore.update {
            it.copy(
                isActive = false,
                connectionStatus = "Sincronizando cancelación",
                message = "El SOS se detuvo; se enviará la cancelación cuando vuelva el backend.",
            )
        }
        refreshNotification()
        if (retryJob?.isActive != true) {
            retryJob = serviceScope.launch { retryPendingOperations() }
        }
    }

    private suspend fun retryPendingOperations() {
        while (serviceScope.isActive) {
            val operation = pendingOperations.pollFirst()
            if (operation == null) {
                delay(RETRY_INTERVAL_MILLIS)
                continue
            }

            if (operation is PendingOperation.Start) startInProgress = true
            try {
                withContext(Dispatchers.IO) {
                    val id = checkNotNull(emergencyId)
                    when (operation) {
                        is PendingOperation.Start -> api.startEmergency(backendUrl, id, userName, operation.location)
                        is PendingOperation.Location -> api.updateLocation(backendUrl, id, operation.location)
                        PendingOperation.Cancel -> api.cancelEmergency(backendUrl, id)
                    }
                }
                when (operation) {
                    is PendingOperation.Start -> {
                        startInProgress = false
                        serverStarted = true
                        SosSessionStore.update {
                            it.copy(
                                connectionStatus = if (cancelRequested) "Sincronizando cancelación" else "Conectado",
                                lastSentAt = operation.location.timeMillis,
                                lastError = null,
                            )
                        }
                    }
                    is PendingOperation.Location -> SosSessionStore.update {
                        it.copy(
                            lastSentAt = operation.location.timeMillis,
                            connectionStatus = "Conectado",
                            lastError = null,
                        )
                    }
                    PendingOperation.Cancel -> {
                        SosSessionStore.update {
                            it.copy(connectionStatus = "SOS detenido", lastError = null, message = null)
                        }
                        stopForeground(STOP_FOREGROUND_REMOVE)
                        stopSelf()
                        return
                    }
                }
                refreshNotification()
            } catch (error: IOException) {
                if (operation is PendingOperation.Start) {
                    startInProgress = false
                    pendingOperations.removeAll { it is PendingOperation.Location }
                    pendingOperations.addFirst(
                        PendingOperation.Start(latestLocation ?: operation.location),
                    )
                } else if (operation is PendingOperation.Location) {
                    val queuedLocation = pendingOperations.lastOrNull() as? PendingOperation.Location
                    if (queuedLocation == null) pendingOperations.addFirst(operation)
                } else {
                    pendingOperations.addFirst(operation)
                }
                val errorSummary = error.toConnectionSummary()
                Log.w(TAG, "Backend no disponible; se reintentará la solicitud SOS: $errorSummary", error)
                SosSessionStore.update {
                    it.copy(
                        connectionStatus = if (cancelRequested) "Cancelación pendiente" else "Sin conexión · reintentando",
                        lastError = errorSummary,
                        message = if (cancelRequested) {
                            "Cancelación en cola local; se reenviará al recuperar la conexión."
                        } else {
                            "Ubicación en cola local; se reenviará al recuperar la conexión."
                        },
                    )
                }
                refreshNotification()
                delay(RETRY_INTERVAL_MILLIS)
            }
        }
    }

    private fun hasRequiredPermissions(): Boolean {
        val hasLocation =
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        val hasServicePermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.FOREGROUND_SERVICE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED
        return hasLocation && hasServicePermission
    }

    private fun IOException.toConnectionSummary(): String {
        val details = message.orEmpty()
        return when {
            Regex("""HTTP \d{3}""").find(details) != null ->
                Regex("""HTTP \d{3}""").find(details)?.value ?: "Error HTTP"
            this is SocketTimeoutException -> "timeout"
            this is UnknownHostException -> "host no resuelto"
            this is ConnectException &&
                (details.contains("ENETUNREACH", ignoreCase = true) ||
                    details.contains("Network is unreachable", ignoreCase = true)) ->
                "sin ruta de red (activa Wi-Fi)"
            this is ConnectException -> "conexión rechazada"
            details.startsWith("URL inválida", ignoreCase = true) -> details
            else -> details.takeIf(String::isNotBlank) ?: javaClass.simpleName
        }
    }

    private fun refreshNotification() {
        val text = when {
            cancelRequested -> "SOS detenido · esperando sincronización"
            serverStarted -> "SOS activo · ubicación cada 5 s"
            else -> "SOS activo · enviando ubicación"
        }
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle("SOS Wear")
            .setContentText(text)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Emergencia SOS",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Notificación permanente mientras el SOS está activo."
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        locationRepository.stop()
        retryJob?.cancel()
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private sealed interface PendingOperation {
        data class Start(val location: SosLocation) : PendingOperation
        data class Location(val location: SosLocation) : PendingOperation
        data object Cancel : PendingOperation
    }

    companion object {
        const val ACTION_START = "com.example.soswear.action.START"
        const val ACTION_STOP = "com.example.soswear.action.STOP"
        const val EXTRA_EMERGENCY_ID = "emergency_id"
        const val EXTRA_USER_NAME = "user_name"
        const val EXTRA_BACKEND_URL = "backend_url"

        private const val TAG = "SosLocationService"
        private const val CHANNEL_ID = "sos_emergency"
        private const val NOTIFICATION_ID = 1001
        private const val RETRY_INTERVAL_MILLIS = 5_000L
    }
}
