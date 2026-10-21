package com.example.soswear.data

import android.util.Log
import com.example.soswear.service.SosLocation
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit

class SosApi {
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .writeTimeout(4, TimeUnit.SECONDS)
        .build()

    fun startEmergency(baseUrl: String, id: String, name: String, location: SosLocation) {
        post(
            endpoint(baseUrl, "/api/sos"),
            JSONObject()
                .put("id", id)
                .put("name", name)
                .put("lat", location.latitude)
                .put("lng", location.longitude)
                .put("accuracy", location.accuracyMeters)
                .put("timestamp", Instant.ofEpochMilli(location.timeMillis).toString()),
        )
    }

    fun updateLocation(baseUrl: String, id: String, location: SosLocation) {
        post(
            endpoint(baseUrl, "/api/sos/$id/location"),
            JSONObject()
                .put("lat", location.latitude)
                .put("lng", location.longitude)
                .put("accuracy", location.accuracyMeters)
                .put("timestamp", Instant.ofEpochMilli(location.timeMillis).toString()),
        )
    }

    fun cancelEmergency(baseUrl: String, id: String) {
        post(endpoint(baseUrl, "/api/sos/$id/cancel"), JSONObject())
    }

    private fun post(url: String, payload: JSONObject) {
        Log.d(TAG, "POST $url")
        try {
            val request = Request.Builder()
                .url(url)
                .post(payload.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()

            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val message = responseBody.takeIf(String::isNotBlank)
                        ?: response.message.ifBlank { "sin detalles" }
                    Log.e(TAG, "POST $url -> HTTP ${response.code}: $message")
                    throw IOException("HTTP ${response.code}: $message")
                }
                Log.d(TAG, "POST $url -> HTTP ${response.code}")
            }
        } catch (error: IOException) {
            Log.e(
                TAG,
                "POST $url falló: ${error.javaClass.simpleName}: ${error.message}",
                error,
            )
            throw error
        } catch (error: IllegalArgumentException) {
            Log.e(TAG, "URL inválida en POST $url: ${error.message}", error)
            throw IOException("URL inválida: ${error.message}", error)
        }
    }

    private fun endpoint(baseUrl: String, path: String): String {
        var normalizedBase = baseUrl.trim().trimEnd('/')
        while (normalizedBase.endsWith("/api", ignoreCase = true)) {
            normalizedBase = normalizedBase.dropLast(4).trimEnd('/')
        }
        return "$normalizedBase$path"
    }

    private companion object {
        const val TAG = "SosApi"
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
