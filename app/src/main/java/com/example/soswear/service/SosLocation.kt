package com.example.soswear.service

data class SosLocation(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val timeMillis: Long,
)
