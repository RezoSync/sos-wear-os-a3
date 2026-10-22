package com.example.soswear.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.example.soswear.R
import com.example.soswear.data.SosSessionStore
import java.util.UUID
import java.text.Normalizer
import java.util.ArrayDeque
import java.util.Locale

class DetectionService : Service(), SensorEventListener {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var sensorManager: SensorManager
    private val steps = ArrayDeque<Long>()
    private var speechRecognizer: SpeechRecognizer? = null
    private var voiceEnabled = false
    private var pulseEnabled = false
    private var runningEnabled = false
    private var heartRate = Float.NaN
    private var noPulseSensor = false
    private var abnormalPulseSince: Long? = null
    private var runningSince: Long? = null
    private var countdownTrigger: String? = null
    private var countdownSeconds = 0
    private var userName = "Usuario"
    private var backendUrl = "http://10.0.2.2:3000"
    private var countdownTask: Runnable? = null
    private val cancelledAt = mutableMapOf<String, Long>()

    override fun onCreate() {
        super.onCreate()
        sensorManager = getSystemService(SensorManager::class.java)
        createNotificationChannel()
        handler.post(tick)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CANCEL_TRIGGER -> {
                val trigger = intent.getStringExtra(EXTRA_TRIGGER)
                if (trigger != null) cancelledAt[trigger] = System.currentTimeMillis()
                countdownTask?.let(handler::removeCallbacks)
                countdownTask = null
                countdownTrigger = null
                if (SosSessionStore.state.value.isCountingDown) {
                    SosSessionStore.update {
                        it.copy(
                            isCountingDown = false,
                            countdownSeconds = 5,
                            trigger = "manual",
                            message = null,
                        )
                    }
                }
                return START_NOT_STICKY
            }
            ACTION_CONFIGURE -> {
                userName = intent.getStringExtra(EXTRA_USER_NAME) ?: userName
                backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL) ?: backendUrl
                configure(
                    intent.getBooleanExtra(EXTRA_VOICE, false),
                    intent.getBooleanExtra(EXTRA_PULSE, false),
                    intent.getBooleanExtra(EXTRA_RUNNING, false),
                )
            }
            else -> stopSelf()
        }
        return START_STICKY
    }

    private fun configure(voice: Boolean, pulse: Boolean, running: Boolean) {
        voiceEnabled = voice
        pulseEnabled = pulse
        runningEnabled = running
        if (!voice && !pulse && !running) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        if (voice && !SpeechRecognizer.isRecognitionAvailable(this)) {
            SosSessionStore.update { it.copy(message = "Voz no disponible") }
            voiceEnabled = false
        }

        val foregroundTypes = (if (voiceEnabled) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0) or
            (if (Build.VERSION.SDK_INT >= 34 && (pulse || running)) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
            } else {
                0
            })
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, foregroundTypes)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        sensorManager.unregisterListener(this)
        if (pulseEnabled || runningEnabled) {
            if (pulseEnabled || runningEnabled) {
                sensorManager.getDefaultSensor(Sensor.TYPE_HEART_RATE)?.let {
                    sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
                } ?: run {
                    noPulseSensor = true
                    SosSessionStore.update { it.copy(message = "Sensor de pulso no disponible") }
                }
            }
            if (pulseEnabled || runningEnabled) {
                sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)?.let {
                    sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
                } ?: run {
                    SosSessionStore.update { it.copy(message = "Sensor de pasos no disponible") }
                }
            }
        }
        if (voiceEnabled) startVoiceRecognition() else stopVoiceRecognition()
    }

    private fun startVoiceRecognition() {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            SosSessionStore.update { it.copy(message = "Permiso de micrófono requerido") }
            voiceEnabled = false
            return
        }
        speechRecognizer?.destroy()
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: android.os.Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = scheduleListeningRestart()
                override fun onError(error: Int) = scheduleListeningRestart()
                override fun onResults(results: android.os.Bundle?) {
                    val phrases = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                    val normalized = phrases.joinToString(" ").normalizeSpeech()
                    if (listOf("auxilio", "socorro", "ayuda").any(normalized::contains)) {
                        emitTrigger(TRIGGER_VOICE)
                    }
                    scheduleListeningRestart()
                }
                override fun onPartialResults(partialResults: android.os.Bundle?) {
                    val phrases = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                    val normalized = phrases.joinToString(" ").normalizeSpeech()
                    if (listOf("auxilio", "socorro", "ayuda").any(normalized::contains)) {
                        emitTrigger(TRIGGER_VOICE)
                    }
                }
                override fun onEvent(eventType: Int, params: android.os.Bundle?) = Unit
            })
        }
        scheduleListeningRestart(0)
    }

    private fun scheduleListeningRestart(delayMillis: Long = 700) {
        handler.removeCallbacks(startListening)
        handler.postDelayed(startListening, delayMillis)
    }

    private val startListening = Runnable {
        if (!voiceEnabled) return@Runnable
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }
        try {
            speechRecognizer?.startListening(intent)
        } catch (error: RuntimeException) {
            Log.e(TAG, "No se pudo iniciar el reconocimiento de voz.", error)
            SosSessionStore.update { it.copy(message = "Voz no disponible") }
        }
    }

    private fun stopVoiceRecognition() {
        handler.removeCallbacks(startListening)
        speechRecognizer?.destroy()
        speechRecognizer = null
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_HEART_RATE -> heartRate = event.values.firstOrNull() ?: Float.NaN
            Sensor.TYPE_STEP_DETECTOR -> steps.addLast(System.currentTimeMillis())
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private val tick = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            while (steps.isNotEmpty() && steps.first() < now - WINDOW_MILLIS) steps.removeFirst()
            val cadence = steps.size * 3
            if (pulseEnabled && cadence < REST_CADENCE && !heartRate.isNaN() &&
                (heartRate > 140 || heartRate < 40)
            ) {
                val since = abnormalPulseSince ?: now.also { abnormalPulseSince = it }
                if (now - since >= WINDOW_MILLIS) emitTrigger(TRIGGER_PULSE)
            } else {
                abnormalPulseSince = null
            }

            val heartRateSupportsRun = noPulseSensor || (!heartRate.isNaN() && heartRate > 120)
            if (runningEnabled && cadence > 150 && heartRateSupportsRun) {
                val since = runningSince ?: now.also { runningSince = it }
                if (now - since >= WINDOW_MILLIS) emitTrigger(TRIGGER_RUNNING)
            } else {
                runningSince = null
            }
            handler.postDelayed(this, TICK_MILLIS)
        }
    }

    private fun emitTrigger(trigger: String) {
        val now = System.currentTimeMillis()
        val lastCancelled = cancelledAt[trigger]
        if (lastCancelled != null && now - lastCancelled < DEBOUNCE_MILLIS) return
        val session = SosSessionStore.state.value
        if (session.isActive || session.isCountingDown || session.awaitingPermissions) return
        countdownTrigger = trigger
        countdownSeconds = 10
        SosSessionStore.update {
            it.copy(
                isCountingDown = true,
                countdownSeconds = countdownSeconds,
                awaitingPermissions = false,
                trigger = trigger,
                message = "Detectado: ${trigger.reason()}",
            )
        }
        abnormalPulseSince = null
        runningSince = null
        updateNotification()
        countdownTask = object : Runnable {
            override fun run() {
                val activeTrigger = countdownTrigger ?: return
                if (countdownSeconds > 1) {
                    countdownSeconds--
                    SosSessionStore.update { it.copy(countdownSeconds = countdownSeconds) }
                    updateNotification()
                    handler.postDelayed(this, 1_000)
                } else {
                    countdownTrigger = null
                    countdownTask = null
                    beginDetectedEmergency(activeTrigger)
                }
            }
        }.also { handler.postDelayed(it, 1_000) }
    }

    private fun beginDetectedEmergency(trigger: String) {
        val hasLocation = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val locationEnabled = getSystemService(LocationManager::class.java).isLocationEnabled
        if (!hasLocation || !locationEnabled) {
            SosSessionStore.update {
                it.copy(
                    isCountingDown = false,
                    connectionStatus = if (hasLocation) "Ubicación apagada" else "Permiso requerido",
                    message = if (hasLocation) "Activa la ubicación del reloj." else "Concede ubicación precisa.",
                )
            }
            updateNotification()
            return
        }
        val id = UUID.randomUUID().toString()
        SosSessionStore.update {
            it.copy(
                isActive = true,
                isCountingDown = false,
                awaitingPermissions = false,
                emergencyId = id,
                contactoEnCamino = null,
                connectionStatus = "Iniciando SOS",
            )
        }
        val intent = Intent(this, SosLocationService::class.java).apply {
            action = SosLocationService.ACTION_START
            putExtra(SosLocationService.EXTRA_EMERGENCY_ID, id)
            putExtra(SosLocationService.EXTRA_USER_NAME, userName)
            putExtra(SosLocationService.EXTRA_BACKEND_URL, backendUrl)
            putExtra(SosLocationService.EXTRA_TRIGGER, trigger)
        }
        try {
            ContextCompat.startForegroundService(this, intent)
        } catch (error: SecurityException) {
            Log.e(TAG, "No se pudo iniciar SOS después de la detección.", error)
            SosSessionStore.update {
                it.copy(isActive = false, connectionStatus = "No se pudo iniciar", message = error.localizedMessage)
            }
        } catch (error: IllegalStateException) {
            Log.e(TAG, "Android bloqueó el inicio del SOS detectado.", error)
            SosSessionStore.update {
                it.copy(isActive = false, connectionStatus = "No se pudo iniciar", message = error.localizedMessage)
            }
        }
        updateNotification()
    }

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
    }

    private fun buildNotification(): Notification {
        val trigger = countdownTrigger
        val text = if (trigger != null) {
            "Detectado: ${trigger.reason()} · SOS en $countdownSeconds s"
        } else {
            "Voz y sensores supervisados"
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle(if (trigger == null) "Detección SOS activa" else "Cuenta regresiva SOS")
            .setContentText(text)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        if (trigger != null) {
            val cancelIntent = Intent(this, DetectionService::class.java).apply {
                action = ACTION_CANCEL_TRIGGER
                putExtra(EXTRA_TRIGGER, trigger)
            }
            val cancelPendingIntent = android.app.PendingIntent.getService(
                this,
                NOTIFICATION_ID,
                cancelIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancelar", cancelPendingIntent)
        }
        return builder.build()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(CHANNEL_ID, "Detección automática", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        sensorManager.unregisterListener(this)
        stopVoiceRecognition()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun String.normalizeSpeech(): String =
        Normalizer.normalize(lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")

    private fun String.reason(): String = when (this) {
        TRIGGER_VOICE -> "voz"
        TRIGGER_PULSE -> "pulso anómalo"
        TRIGGER_RUNNING -> "carrera"
        else -> this
    }

    companion object {
        const val ACTION_CONFIGURE = "com.example.soswear.DETECTION_CONFIGURE"
        const val ACTION_CANCEL_TRIGGER = "com.example.soswear.DETECTION_CANCEL"
        const val EXTRA_VOICE = "voice"
        const val EXTRA_PULSE = "pulse"
        const val EXTRA_RUNNING = "running"
        const val EXTRA_USER_NAME = "user_name"
        const val EXTRA_BACKEND_URL = "backend_url"
        const val EXTRA_TRIGGER = "trigger"
        const val TRIGGER_VOICE = "voz"
        const val TRIGGER_PULSE = "pulso"
        const val TRIGGER_RUNNING = "carrera"
        private const val TAG = "DetectionService"
        private const val CHANNEL_ID = "sos_detection"
        private const val NOTIFICATION_ID = 4102
        private const val WINDOW_MILLIS = 20_000L
        private const val DEBOUNCE_MILLIS = 120_000L
        private const val TICK_MILLIS = 1_000L
        private const val REST_CADENCE = 40
    }
}
