package com.example.soswear.service

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.os.Looper
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class LocationRepository(context: Context) {
    private val client = LocationServices.getFusedLocationProviderClient(context)
    private var callback: LocationCallback? = null

    @SuppressLint("MissingPermission")
    fun start(onLocation: (SosLocation) -> Unit, onError: (Exception) -> Unit) {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MILLIS)
            .setMinUpdateIntervalMillis(INTERVAL_MILLIS)
            .build()
        val locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { onLocation(it.toSosLocation()) }
            }
        }
        callback = locationCallback
        try {
            client.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
                .addOnFailureListener { error ->
                    onError(error)
                }
        } catch (error: SecurityException) {
            onError(error)
        }
    }

    fun stop() {
        callback?.let(client::removeLocationUpdates)
        callback = null
    }

    private fun Location.toSosLocation() = SosLocation(
        latitude = latitude,
        longitude = longitude,
        accuracyMeters = accuracy,
        timeMillis = time,
    )

    private companion object {
        const val INTERVAL_MILLIS = 5_000L
    }
}
