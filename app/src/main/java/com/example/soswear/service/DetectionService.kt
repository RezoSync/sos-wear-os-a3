package com.example.soswear.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
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
                intent.getStringExtra(EXTRA_TRIGGER)?.let { cancelledAt[it] = System.currentTimeMillis() }
                return START_NOT_STICKY
            }
            ACTION_CONFIGURE -> configure(
                intent.getBooleanExtra(EXTRA_VOICE, false),
                intent.getBooleanExtra(EXTRA_PULSE, false),
                intent.getBooleanExtra(EXTRA_RUNNING, false),
            )
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
        if (now - (cancelledAt[trigger] ?: 0L) < DEBOUNCE_MILLIS) return
        val session = SosSessionStore.state.value
        if (session.isActive || session.isCountingDown || session.awaitingPermissions) return
        SosSessionStore.detect(trigger)
        abnormalPulseSince = null
        runningSince = null
    }

    private fun buildNotification(): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_sos_notification)
        .setContentTitle("Detección SOS activa")
        .setContentText("Voz y sensores supervisados")
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()

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

    companion object {
        const val ACTION_CONFIGURE = "com.example.soswear.DETECTION_CONFIGURE"
        const val ACTION_CANCEL_TRIGGER = "com.example.soswear.DETECTION_CANCEL"
        const val EXTRA_VOICE = "voice"
        const val EXTRA_PULSE = "pulse"
        const val EXTRA_RUNNING = "running"
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
