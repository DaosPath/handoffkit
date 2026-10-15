package com.hijosdelsol.hermesmobile.net

import com.hijosdelsol.hermesmobile.model.ChatMessage
import com.hijosdelsol.hermesmobile.model.ConnectionConfig
import com.hijosdelsol.hermesmobile.model.GatewayEvent
import com.hijosdelsol.hermesmobile.model.HermesServerStatus
import com.hijosdelsol.hermesmobile.model.HermesModelOption
import com.hijosdelsol.hermesmobile.model.HermesModelOptions
import com.hijosdelsol.hermesmobile.model.HermesMobileSettings
import com.hijosdelsol.hermesmobile.model.ModelNameFormatter
import com.hijosdelsol.hermesmobile.model.SessionSummary
import com.hijosdelsol.hermesmobile.model.AuthMode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class HermesClient(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build(),
) {
    private val requestCounter = AtomicLong(0L)
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val eventsMutable = MutableSharedFlow<GatewayEvent>(
        extraBufferCapacity = 128,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    private var socket: WebSocket? = null
    @Volatile private var connected = false
    private var currentConfig: ConnectionConfig? = null

    val events: SharedFlow<GatewayEvent> = eventsMutable

    suspend fun connect(config: ConnectionConfig) {
        close()
        currentConfig = config
        val auth = websocketAuth(config)
        val request = Request.Builder()
            .url(HermesEndpoint.websocket(config.endpoint, auth.first, auth.second))
            .build()

        suspendCancellableCoroutine<Unit> { continuation ->
            val webSocket = http.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    socket = webSocket
                    connected = true
                    if (continuation.isActive) continuation.resume(Unit)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (socket === webSocket || socket == null) {
                        connected = false
                        if (socket === webSocket) socket = null
                        failPending(t)
                    }
                    if (continuation.isActive) continuation.resumeWithException(
                        IllegalStateException(
                            "No se pudo abrir el gateway Hermes" +
                                t.message.orEmpty().takeIf { it.isNotBlank() }?.let { ": $it" }.orEmpty(),
                            t,
                        ),
                    )
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    handleFrame(text)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (socket === webSocket) {
                        socket = null
                        connected = false
                        failPending(IllegalStateException("Gateway Hermes cerrado ($code)"))
                    }
                }
            })
            socket = webSocket
            continuation.invokeOnCancellation {
                webSocket.cancel()
            }
        }
    }

    fun close() {
        connected = false
        socket?.close(1000, "client closed")
        socket?.cancel()
        socket = null
        currentConfig = null
        failPending(IllegalStateException("Gateway Hermes desconectado"))
    }

    suspend fun request(
        method: String,
        params: JSONObject = JSONObject(),
        timeoutMs: Long = DEFAULT_REQUEST_TIMEOUT_MS,
    ): JSONObject {
        check(connected) { "Gateway Hermes no conectado" }
        val webSocket = socket ?: error("Gateway Hermes no conectado")
        val id = "mobile-${requestCounter.incrementAndGet()}"
        val deferred = CompletableDeferred<JSONObject>()
        pending[id] = deferred
        val frame = JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", id)
            .put("method", method)
            .put("params", params)

        if (!webSocket.send(frame.toString())) {
            pending.remove(id)
            throw IllegalStateException("No se pudo enviar la solicitud Hermes")
        }

        return try {
            withTimeout(timeoutMs) { deferred.await() }
        } finally {
            pending.remove(id)
        }
    }

    suspend fun status(config: ConnectionConfig): HermesServerStatus = withContext(Dispatchers.IO) {
        val json = getJson(HermesEndpoint.api(config.endpoint, "api/status"), config)
        HermesServerStatus(
            version = json.stringOrNull("version"),
            gatewayRunning = json.optBoolean("gateway_running", false),
            gatewayState = json.stringOrNull("gateway_state"),
            authRequired = json.optBoolean("auth_required", false),
            authFlows = json.stringList("auth_flows"),
        )
    }

    suspend fun listSessions(config: ConnectionConfig): List<SessionSummary> = withContext(Dispatchers.IO) {
        val json = getJson(
            HermesEndpoint.api(
                config.endpoint,
                "api/sessions",
                mapOf(
                    "limit" to "50",
                    "offset" to "0",
                    "min_messages" to "1",
                    "archived" to "exclude",
                    "order" to "recent",
                ),
            ),
            config,
        )
        val sessions = json.optJSONArray("sessions") ?: JSONArray()
        buildList {
            for (index in 0 until sessions.length()) {
                val item = sessions.optJSONObject(index) ?: continue
                val id = item.optString("id").takeIf { it.isNotBlank() } ?: continue
                val preview = item.stringOrNull("preview").orEmpty()
                val title = item.stringOrNull("title") ?: preview.lineSequence().firstOrNull().orEmpty()
                add(
                    SessionSummary(
                        id = id,
                        title = title.ifBlank { "Conversación sin título" },
                        preview = preview,
                        source = item.stringOrNull("source"),
                        messageCount = item.optInt("message_count", 0),
                        lastActive = item.optLong("last_active", 0L).takeIf { it > 0L },
                    ),
                )
            }
        }
    }

    suspend fun modelOptions(refresh: Boolean = false): HermesModelOptions {
        val params = JSONObject().put("explicit_only", true)
        if (refresh) params.put("refresh", true)
        return parseModelOptions(request("model.options", params))
    }

    suspend fun mobileSettings(): HermesMobileSettings {
        val json = request("config.get", JSONObject().put("key", "mobile_settings"))
        return HermesMobileSettings(
            defaultModel = json.stringOrNull("default_model"),
            defaultProvider = json.stringOrNull("default_provider"),
            contextLength = json.intOrNull("context_length"),
            ollamaNumCtx = json.intOrNull("ollama_num_ctx"),
            compressionEnabled = json.optBoolean("compression_enabled", true),
            compressionThreshold = json.optDouble("compression_threshold", 0.5),
            maxTurns = json.optInt("max_turns", 150),
            reasoningEffort = json.stringOrNull("reasoning_effort") ?: "medium",
        )
    }

    suspend fun setConfig(key: String, value: Any?): JSONObject = request(
        "config.set",
        JSONObject()
            .put("key", key)
            .put("value", value),
    )

    suspend fun sessionMessages(config: ConnectionConfig, sessionId: String): List<ChatMessage> =
        withContext(Dispatchers.IO) {
            val json = getJson(
                HermesEndpoint.api(config.endpoint, "api/sessions/$sessionId/messages"),
                config,
            )
            val messages = json.optJSONArray("messages") ?: JSONArray()
            buildList {
                for (index in 0 until messages.length()) {
                    val item = messages.optJSONObject(index) ?: continue
                    val role = item.optString("role").lowercase()
                    if (role != "user" && role != "assistant") continue
                    val content = jsonContent(item.opt("content")).trim()
                    if (content.isBlank()) continue
                    add(
                        ChatMessage(
                            id = item.stringOrNull("id") ?: "$sessionId-message-$index",
                            role = role,
                            content = content,
                        ),
                    )
                }
            }
        }

    suspend fun mintWebSocketTicket(config: ConnectionConfig): String = withContext(Dispatchers.IO) {
        val json = postJson(HermesEndpoint.api(config.endpoint, "api/auth/ws-ticket"), config, JSONObject())
        json.stringOrNull("ticket") ?: throw IllegalStateException("Hermes no devolvió ticket WebSocket")
    }

    private suspend fun websocketAuth(config: ConnectionConfig): Pair<String, String> =
        if (config.credentials.mode == AuthMode.NATIVE_BROWSER) {
            "ticket" to mintWebSocketTicket(config)
        } else {
            "token" to config.credentials.accessToken
        }

    private fun getJson(url: okhttp3.HttpUrl, config: ConnectionConfig): JSONObject {
        val request = authenticatedRequest(url, config).get().build()
        return executeJson(request)
    }

    private fun postJson(url: okhttp3.HttpUrl, config: ConnectionConfig, body: JSONObject): JSONObject {
        val request = authenticatedRequest(url, config)
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()
        return executeJson(request)
    }

    private fun authenticatedRequest(url: okhttp3.HttpUrl, config: ConnectionConfig): Request.Builder {
        val builder = Request.Builder().url(url)
        if (config.credentials.mode == AuthMode.NATIVE_BROWSER) {
            builder.header("Authorization", "Bearer ${config.credentials.accessToken}")
        } else {
            builder.header("X-Hermes-Session-Token", config.credentials.accessToken)
        }
        return builder
    }

    private fun executeJson(request: Request): JSONObject {
        http.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val detail = runCatching { JSONObject(raw).stringOrNull("detail") }.getOrNull()
                val suffix = if (response.code == 401) "Token o sesión rechazada" else detail.orEmpty()
                throw IllegalStateException(
                    if (suffix.isBlank()) "Hermes respondió HTTP ${response.code}" else suffix,
                )
            }
            return if (raw.isBlank()) JSONObject() else JSONObject(raw)
        }
    }

    private fun handleFrame(text: String) {
        val frame = runCatching { JSONObject(text) }.getOrNull() ?: return
        if (frame.has("id") && !frame.isNull("id")) {
            val id = frame.opt("id")?.toString() ?: return
            val call = pending.remove(id) ?: return
            val error = frame.optJSONObject("error")
            if (error != null) {
                call.completeExceptionally(
                    IllegalStateException(error.stringOrNull("message") ?: "Solicitud Hermes falló"),
                )
            } else {
                call.complete(frame.optJSONObject("result") ?: JSONObject())
            }
            return
        }

        if (frame.optString("method") != "event") return
        val params = frame.optJSONObject("params") ?: return
        val type = params.optString("type").takeIf { it.isNotBlank() } ?: return
        val sessionId = params.stringOrNull("session_id")
        val payload = params.optJSONObject("payload") ?: JSONObject()
        eventsMutable.tryEmit(GatewayEvent(type, sessionId, payload))
    }

    private fun parseModelOptions(json: JSONObject): HermesModelOptions {
        val activeModel = json.stringOrNull("model")
        val activeProvider = json.stringOrNull("provider")
        val providers = json.optJSONArray("providers") ?: JSONArray()
        val options = buildList {
            for (index in 0 until providers.length()) {
                val provider = providers.optJSONObject(index) ?: continue
                val providerId = provider.stringOrNull("slug")
                    ?: provider.stringOrNull("name")
                    ?: continue
                val providerName = provider.stringOrNull("name") ?: providerId
                val authenticated = provider.optBoolean("authenticated", true)
                val unavailable = provider.stringList("unavailable_models").toSet()
                val models = provider.optJSONArray("models") ?: JSONArray()
                for (modelIndex in 0 until models.length()) {
                    val modelValue = models.opt(modelIndex)
                    val modelObject = modelValue as? JSONObject
                    val modelId = when (modelValue) {
                        is JSONObject -> modelValue.stringOrNull("id")
                            ?: modelValue.stringOrNull("model")
                            ?: modelValue.stringOrNull("name")
                            ?: ""
                        else -> models.optString(modelIndex).trim()
                    }.trim()
                    if (modelId.isBlank()) continue
                    val suppliedDisplayName = modelObject?.stringOrNull("display_name")
                        ?: modelObject?.stringOrNull("displayName")
                        ?: modelObject?.stringOrNull("label")
                        ?: modelObject?.stringOrNull("title")
                    add(
                        HermesModelOption(
                            id = modelId,
                            displayName = ModelNameFormatter.displayName(
                                modelId,
                                providerId,
                                suppliedDisplayName,
                            ),
                            provider = providerId,
                            providerName = providerName,
                            selectable = authenticated && modelId !in unavailable,
                            warning = provider.stringOrNull("warning"),
                        ),
                    )
                }
            }
        }
            .distinctBy { "${it.provider}::${it.id}" }

        val resolvedProvider = activeProvider
            ?: options.firstOrNull { it.id == activeModel }?.provider
        val fallbackModel = activeModel?.takeIf { it.isNotBlank() }
        val fallbackProvider = resolvedProvider?.takeIf { it.isNotBlank() }
        val fallback = if (options.isEmpty() && fallbackModel != null && fallbackProvider != null) {
            listOf(
                HermesModelOption(
                    id = fallbackModel,
                    displayName = ModelNameFormatter.displayName(fallbackModel, fallbackProvider),
                    provider = fallbackProvider,
                    providerName = fallbackProvider,
                ),
            )
        } else {
            options
        }

        return HermesModelOptions(
            options = fallback,
            activeModel = activeModel,
            activeProvider = resolvedProvider,
        )
    }

    private fun failPending(error: Throwable) {
        pending.values.forEach { it.completeExceptionally(error) }
        pending.clear()
    }

    private companion object {
        const val DEFAULT_REQUEST_TIMEOUT_MS = 120_000L
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}

private fun JSONObject.stringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

private fun JSONObject.intOrNull(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    return when (val value = opt(key)) {
        is Number -> value.toInt()
        is String -> value.toIntOrNull()
        else -> null
    }
}

private fun JSONObject.stringList(key: String): List<String> {
    val values = optJSONArray(key) ?: return emptyList()
    return buildList {
        for (index in 0 until values.length()) {
            values.optString(index).takeIf { it.isNotBlank() }?.let(::add)
        }
    }
}

private fun jsonContent(value: Any?): String = when (value) {
    null, JSONObject.NULL -> ""
    is String -> value
    is JSONArray -> buildString {
        for (index in 0 until value.length()) append(jsonContent(value.opt(index)))
    }
    is JSONObject -> when {
        value.has("text") -> value.optString("text")
        value.has("content") -> jsonContent(value.opt("content"))
        else -> value.optString("value")
    }
    else -> value.toString()
}
