package com.example.soswear.data

import android.content.Context
import android.net.Uri
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore by preferencesDataStore(name = "sos_settings")

data class SosSettings(
    val userName: String = "Usuario",
    val backendUrl: String = "http://10.0.2.2:3000",
)

class SosSettingsRepository(context: Context) {
    private val dataStore = context.applicationContext.settingsDataStore

    val settings: Flow<SosSettings> = dataStore.data.map { preferences ->
        SosSettings(
            userName = preferences[USER_NAME] ?: SosSettings().userName,
            backendUrl = preferences[BACKEND_URL] ?: SosSettings().backendUrl,
        )
    }

    suspend fun save(userName: String, backendUrl: String) {
        val cleanName = userName.trim()
        require(cleanName.isNotEmpty()) { "Escribe un nombre." }
        require(cleanName.length <= 80) { "El nombre no puede superar 80 caracteres." }

        val cleanUrl = backendUrl.trim().trimEnd('/')
        val uri = Uri.parse(cleanUrl)
        require(
            (uri.scheme == "http" || uri.scheme == "https") &&
                !uri.host.isNullOrBlank() &&
                uri.query == null &&
                uri.fragment == null,
        ) { "La URL debe incluir http:// o https:// y un host válido." }

        dataStore.edit { preferences ->
            preferences[USER_NAME] = cleanName
            preferences[BACKEND_URL] = cleanUrl
        }
    }

    private companion object {
        val USER_NAME = stringPreferencesKey("user_name")
        val BACKEND_URL = stringPreferencesKey("backend_url")
    }
}
