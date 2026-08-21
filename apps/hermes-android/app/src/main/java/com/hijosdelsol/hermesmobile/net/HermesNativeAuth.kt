package com.hijosdelsol.hermesmobile.net

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.TimeUnit

data class NativeTokens(
    val accessToken: String,
    val refreshToken: String,
    val provider: String?,
    val expiresAt: Long?,
)

/** RFC 8252 + PKCE client for Hermes' native browser login surface. */
class HermesNativeAuth(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build(),
) {
    suspend fun signIn(context: Context, endpoint: String): NativeTokens {
        val verifier = randomUrlToken(32)
        val challenge = sha256UrlToken(verifier)
        val state = randomUrlToken(32)

        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        server.soTimeout = NATIVE_LOGIN_TIMEOUT_MS
        val redirectUri = "http://127.0.0.1:${server.localPort}/callback"
        val authorizeUrl = HermesEndpoint.api(
            endpoint,
            "auth/native/authorize",
            mapOf(
                "code_challenge" to challenge,
                "code_challenge_method" to "S256",
                "redirect_uri" to redirectUri,
                "state" to state,
            ),
        )

        try {
            withContext(Dispatchers.Main.immediate) {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(authorizeUrl.toString()))
                if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }

            val callback = withContext(Dispatchers.IO) { readCallback(server) }
            require(callback.state == state) { "Inicio de sesión rechazado: estado inválido" }
            val code = callback.code ?: throw IllegalStateException(
                callback.error ?: "Hermes no devolvió código de autorización",
            )
            return exchangeCode(endpoint, code, verifier)
        } finally {
            runCatching { server.close() }
        }
    }

    suspend fun refresh(
        endpoint: String,
        refreshToken: String,
        provider: String?,
    ): NativeTokens = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("refresh_token", refreshToken)
            .apply { if (!provider.isNullOrBlank()) put("provider", provider) }
        val request = Request.Builder()
            .url(HermesEndpoint.api(endpoint, "auth/native/refresh"))
            .post(body.toString().jsonBody())
            .build()
        executeTokens(request)
    }

    private suspend fun exchangeCode(endpoint: String, code: String, verifier: String): NativeTokens =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("code", code)
                .put("code_verifier", verifier)
            val request = Request.Builder()
                .url(HermesEndpoint.api(endpoint, "auth/native/token"))
                .post(body.toString().jsonBody())
                .build()
            executeTokens(request)
        }

    private fun executeTokens(request: Request): NativeTokens {
        http.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IllegalStateException("Inicio de sesión Hermes falló (${response.code})")
            }
            val json = JSONObject(raw)
            val accessToken = json.optString("access_token").takeIf { it.isNotBlank() }
                ?: throw IllegalStateException("Hermes no devolvió access_token")
            return NativeTokens(
                accessToken = accessToken,
                refreshToken = json.optString("refresh_token"),
                provider = json.stringOrNull("provider"),
                expiresAt = json.optLong("expires_at", 0L).takeIf { it > 0L },
            )
        }
    }

    private fun readCallback(server: ServerSocket): Callback {
        server.accept().use { socket ->
            socket.soTimeout = CALLBACK_READ_TIMEOUT_MS
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
            val requestLine = reader.readLine().orEmpty()
            val target = requestLine.split(' ').getOrNull(1)
                ?: throw IllegalStateException("Callback Hermes inválido")
            val callback = Uri.parse("http://127.0.0.1$target")
            val responseBody = if (callback.getQueryParameter("error") == null) {
                "<html><body><h3>Hermes Pocket listo</h3><p>Vuelve a la app.</p></body></html>"
            } else {
                "<html><body><h3>Inicio de sesión cancelado</h3><p>Vuelve a la app.</p></body></html>"
            }
            writeBrowserResponse(socket, responseBody)
            return Callback(
                code = callback.getQueryParameter("code"),
                state = callback.getQueryParameter("state"),
                error = callback.getQueryParameter("error_description")
                    ?: callback.getQueryParameter("error"),
            )
        }
    }

    private fun writeBrowserResponse(socket: Socket, body: String) {
        val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8))
        writer.write("HTTP/1.1 200 OK\r\n")
        writer.write("Content-Type: text/html; charset=utf-8\r\n")
        writer.write("Connection: close\r\n")
        writer.write("Content-Length: ${body.toByteArray(Charsets.UTF_8).size}\r\n")
        writer.write("\r\n")
        writer.write(body)
        writer.flush()
    }

    private data class Callback(
        val code: String?,
        val state: String?,
        val error: String?,
    )

    private companion object {
        const val NATIVE_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
        const val CALLBACK_READ_TIMEOUT_MS = 15 * 1000

        fun randomUrlToken(byteCount: Int): String {
            val bytes = ByteArray(byteCount)
            SecureRandom().nextBytes(bytes)
            return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        }

        fun sha256UrlToken(value: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.US_ASCII))
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
        }
    }
}

private fun String.jsonBody() =
    toRequestBody("application/json; charset=utf-8".toMediaType())

private fun JSONObject.stringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
