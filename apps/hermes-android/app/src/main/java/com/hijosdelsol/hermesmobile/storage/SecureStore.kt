package com.hijosdelsol.hermesmobile.storage

import android.content.Context
import android.util.Base64
import com.hijosdelsol.hermesmobile.model.AuthMode
import com.hijosdelsol.hermesmobile.model.HermesCredentials
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class SavedConnection(
    val endpoint: String,
    val credentials: HermesCredentials,
)

class SecureStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun read(): SavedConnection? {
        val endpoint = preferences.getString(KEY_ENDPOINT, null)?.trim().orEmpty()
        val mode = preferences.getString(KEY_MODE, null)
        val token = decrypt(preferences.getString(KEY_TOKEN, null)) ?: ""

        if (endpoint.isBlank() || mode.isNullOrBlank() || token.isBlank()) return null

        val authMode = runCatching { AuthMode.valueOf(mode) }.getOrNull() ?: return null
        return SavedConnection(
            endpoint = endpoint,
            credentials = HermesCredentials(
                mode = authMode,
                accessToken = token,
                refreshToken = decrypt(preferences.getString(KEY_REFRESH_TOKEN, null)),
                provider = preferences.getString(KEY_PROVIDER, null),
                expiresAt = preferences.getLong(KEY_EXPIRES_AT, 0L).takeIf { it > 0L },
            ),
        )
    }

    fun save(endpoint: String, credentials: HermesCredentials) {
        preferences.edit()
            .putString(KEY_ENDPOINT, endpoint.trim().trimEnd('/'))
            .putString(KEY_MODE, credentials.mode.name)
            .putString(KEY_TOKEN, encrypt(credentials.accessToken))
            .putString(KEY_REFRESH_TOKEN, credentials.refreshToken?.let(::encrypt))
            .putString(KEY_PROVIDER, credentials.provider)
            .putLong(KEY_EXPIRES_AT, credentials.expiresAt ?: 0L)
            .apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private fun getKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null)
        if (existing is SecretKey) return existing

        val generator = KeyGenerator.getInstance("AES", ANDROID_KEYSTORE)
        generator.init(android.security.keystore.KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
        ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .build())
        return generator.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        val combined = ByteArray(iv.size + ciphertext.size)
        iv.copyInto(combined, 0)
        ciphertext.copyInto(combined, iv.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String?): String? {
        if (encoded.isNullOrBlank()) return null
        return runCatching {
            val combined = Base64.decode(encoded, Base64.DEFAULT)
            val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
            val ciphertext = combined.copyOfRange(GCM_IV_LENGTH, combined.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getKey(), GCMParameterSpec(GCM_TAG_LENGTH, iv))
            String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
        }.getOrNull()
    }

    private companion object {
        const val PREFERENCES = "hermes_pocket_secure"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "hermes_pocket_connection_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_IV_LENGTH = 12
        const val GCM_TAG_LENGTH = 128
        const val KEY_ENDPOINT = "endpoint"
        const val KEY_MODE = "mode"
        const val KEY_TOKEN = "token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_PROVIDER = "provider"
        const val KEY_EXPIRES_AT = "expires_at"
    }
}
