package com.hijosdelsol.hermesmobile

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.hijosdelsol.hermesmobile.model.AgentActivity
import com.hijosdelsol.hermesmobile.model.AgentActivityStatus
import com.hijosdelsol.hermesmobile.model.AgentTodo
import com.hijosdelsol.hermesmobile.model.AppScreen
import com.hijosdelsol.hermesmobile.model.AuthMode
import com.hijosdelsol.hermesmobile.model.ChatMessage
import com.hijosdelsol.hermesmobile.model.ConnectionConfig
import com.hijosdelsol.hermesmobile.model.ConnectionState
import com.hijosdelsol.hermesmobile.model.GatewayEvent
import com.hijosdelsol.hermesmobile.model.HermesCredentials
import com.hijosdelsol.hermesmobile.model.HermesApprovalRequest
import com.hijosdelsol.hermesmobile.model.HermesBrowserProgress
import com.hijosdelsol.hermesmobile.model.HermesBrowserSource
import com.hijosdelsol.hermesmobile.model.HermesClarifyRequest
import com.hijosdelsol.hermesmobile.model.HermesModelOption
import com.hijosdelsol.hermesmobile.model.HermesSettingsDraft
import com.hijosdelsol.hermesmobile.model.HermesUiState
import com.hijosdelsol.hermesmobile.model.SessionSummary
import com.hijosdelsol.hermesmobile.net.HermesClient
import com.hijosdelsol.hermesmobile.net.HermesNativeAuth
import com.hijosdelsol.hermesmobile.net.NativeTokens
import com.hijosdelsol.hermesmobile.storage.SecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class HermesViewModel(application: Application) : AndroidViewModel(application) {
    private val secureStore = SecureStore(application)
    private val client = HermesClient()
    private val nativeAuth = HermesNativeAuth()
    private val savedConnection = secureStore.read()
    private var nativeCredentials: HermesCredentials? = savedConnection
        ?.credentials
        ?.takeIf { it.mode == AuthMode.NATIVE_BROWSER }
    private var activeConfig: ConnectionConfig? = null
    private var messageSequence = 0L
    private var activitySequence = 0L
    private var thinkingStartedAtMs: Long? = null

    private val stateMutable = MutableStateFlow(
        HermesUiState(
            endpoint = savedConnection?.endpoint.orEmpty(),
            tokenInput = savedConnection?.credentials
                ?.takeIf { it.mode == AuthMode.SESSION_TOKEN }
                ?.accessToken
                .orEmpty(),
            authMode = savedConnection?.credentials?.mode ?: AuthMode.SESSION_TOKEN,
            hasSavedNativeLogin = nativeCredentials != null,
        ),
    )
    val state: StateFlow<HermesUiState> = stateMutable.asStateFlow()

    init {
        viewModelScope.launch {
            client.events.collect(::handleEvent)
        }
    }

    fun setEndpoint(value: String) {
        stateMutable.update { it.copy(endpoint = value, errorMessage = null) }
    }

    fun setToken(value: String) {
        stateMutable.update { it.copy(tokenInput = value, errorMessage = null) }
    }

    fun setAuthMode(mode: AuthMode) {
        stateMutable.update { it.copy(authMode = mode, errorMessage = null) }
    }

    fun connect() {
        val snapshot = state.value
        val endpoint = snapshot.endpoint.trim()
        if (endpoint.isBlank()) {
            stateMutable.update { it.copy(errorMessage = "Escribe la URL del dashboard Hermes") }
            return
        }

        viewModelScope.launch {
            try {
                val credentials = credentialsForConnect(snapshot)
                establish(endpoint, credentials)
            } catch (error: Throwable) {
                handleConnectionFailure(error)
            }
        }
    }

    fun loginInBrowser(context: Context) {
        val endpoint = state.value.endpoint.trim()
        if (endpoint.isBlank()) {
            stateMutable.update { it.copy(errorMessage = "Escribe primero la URL del dashboard Hermes") }
            return
        }

        stateMutable.update {
            it.copy(
                connectionState = ConnectionState.CONNECTING,
                errorMessage = null,
            )
        }
        viewModelScope.launch {
            try {
                val tokens = nativeAuth.signIn(context, endpoint)
                val credentials = tokens.toCredentials()
                nativeCredentials = credentials
                secureStore.save(endpoint, credentials)
                stateMutable.update {
                    it.copy(
                        authMode = AuthMode.NATIVE_BROWSER,
                        hasSavedNativeLogin = true,
                        errorMessage = null,
                    )
                }
                establish(endpoint, credentials)
            } catch (error: Throwable) {
                handleConnectionFailure(error)
            }
        }
    }

    fun refreshSessions() {
        val config = activeConfig ?: return
        viewModelScope.launch {
            runCatching { client.listSessions(config) }
                .onSuccess { sessions -> stateMutable.update { it.copy(sessions = sessions) } }
                .onFailure { error -> stateMutable.update { it.copy(errorMessage = readableError(error)) } }
        }
    }

    fun refreshModels() {
        val config = activeConfig ?: return
        stateMutable.update { it.copy(modelsLoading = true, modelErrorMessage = null) }
        viewModelScope.launch {
            runCatching { client.modelOptions(refresh = true) }
                .onSuccess { snapshot ->
                    if (activeConfig != config) return@onSuccess
                    val current = state.value
                    val keepCurrent = !current.activeModel.isNullOrBlank() &&
                        (current.activeSessionId != null || current.modelOptions.isEmpty() ||
                            snapshot.options.any { option ->
                                option.id == current.activeModel && option.provider == current.activeProvider
                            })
                    stateMutable.update {
                        it.copy(
                            modelOptions = snapshot.options,
                            activeModel = if (keepCurrent) current.activeModel else snapshot.activeModel,
                            activeProvider = if (keepCurrent) current.activeProvider else snapshot.activeProvider,
                            modelsLoading = false,
                            modelErrorMessage = null,
                        )
                    }
                }
                .onFailure { error ->
                    if (activeConfig != config) return@onFailure
                    stateMutable.update {
                        it.copy(
                            modelsLoading = false,
                            modelErrorMessage = readableError(error),
                        )
                    }
                }
        }
    }

    fun refreshSettings() {
        val config = activeConfig ?: return
        stateMutable.update {
            it.copy(settingsLoading = true, settingsErrorMessage = null)
        }
        viewModelScope.launch {
            runCatching { client.mobileSettings() }
                .onSuccess { settings ->
                    if (activeConfig != config) return@onSuccess
                    stateMutable.update {
                        it.copy(
                            mobileSettings = settings,
                            settingsLoading = false,
                            settingsErrorMessage = null,
                        )
                    }
                }
                .onFailure { error ->
                    if (activeConfig != config) return@onFailure
                    stateMutable.update {
                        it.copy(
                            settingsLoading = false,
                            settingsErrorMessage = readableError(error),
                        )
                    }
                }
        }
    }

    fun saveSettings(draft: HermesSettingsDraft, onSaved: () -> Unit = {}) {
        val config = activeConfig
        if (config == null) {
            stateMutable.update { it.copy(settingsErrorMessage = "Conecta Hermes antes de guardar estos ajustes") }
            return
        }
        if (draft.contextLength < MINIMUM_CONTEXT_LENGTH || draft.ollamaNumCtx < MINIMUM_CONTEXT_LENGTH) {
            stateMutable.update {
                it.copy(settingsErrorMessage = "Hermes necesita al menos 64000 tokens de contexto")
            }
            return
        }

        stateMutable.update {
            it.copy(settingsSaving = true, settingsErrorMessage = null, errorMessage = null)
        }
        viewModelScope.launch {
            try {
                draft.defaultModel?.trim()?.takeIf { it.isNotBlank() }?.let { model ->
                    val provider = draft.defaultProvider?.trim().orEmpty()
                    val target = buildString {
                        append(model)
                        if (provider.isNotBlank()) append(" --provider ").append(provider)
                        append(" --global")
                    }
                    val result = client.setConfig("model", target)
                    if (result.optBoolean("confirm_required", false)) {
                        throw IllegalStateException(
                            result.stringOrNull("confirm_message")
                                ?: "Hermes necesita confirmar este modelo",
                        )
                    }
                }
                client.setConfig("model.context_length", draft.contextLength)
                client.setConfig("model.ollama_num_ctx", draft.ollamaNumCtx)
                client.setConfig("compression.enabled", draft.compressionEnabled)
                client.setConfig("compression.threshold", draft.compressionThreshold)
                client.setConfig("agent.max_turns", draft.maxTurns)
                client.setConfig("agent.reasoning_effort", draft.reasoningEffort)
                val updated = client.mobileSettings()
                stateMutable.update {
                    it.copy(
                        mobileSettings = updated,
                        settingsSaving = false,
                        settingsErrorMessage = null,
                    )
                }
                onSaved()
            } catch (error: Throwable) {
                if (activeConfig != config) return@launch
                stateMutable.update {
                    it.copy(
                        settingsSaving = false,
                        settingsErrorMessage = readableError(error),
                    )
                }
            }
        }
    }

    fun selectModel(option: HermesModelOption) {
        if (!option.selectable) return
        val previous = state.value
        stateMutable.update {
            it.copy(
                activeModel = option.id,
                activeProvider = option.provider,
                modelErrorMessage = null,
            )
        }

        val sessionId = previous.activeSessionId ?: return
        viewModelScope.launch {
            try {
                client.request(
                    "config.set",
                    JSONObject()
                        .put("session_id", sessionId)
                        .put("key", "model")
                        .put("value", "${option.id} --provider ${option.provider} --session"),
                )
            } catch (error: Throwable) {
                stateMutable.update { current ->
                    if (current.activeModel == option.id && current.activeProvider == option.provider) {
                        current.copy(
                            activeModel = previous.activeModel,
                            activeProvider = previous.activeProvider,
                            modelErrorMessage = readableError(error),
                        )
                    } else {
                        current.copy(modelErrorMessage = readableError(error))
                    }
                }
            }
        }
    }

    fun openSession(session: SessionSummary) {
        val config = activeConfig ?: return
        stateMutable.update {
            it.copy(
                isBusy = true,
                errorMessage = null,
                activeStoredSessionId = session.id,
                activeSessionTitle = session.title,
            )
        }
        viewModelScope.launch {
            try {
                val resumed = client.request(
                    "session.resume",
                    JSONObject()
                        .put("session_id", session.id)
                        .put("source", "desktop")
                        .put("omit_messages", true),
                )
                val runtimeId = resumed.stringOrNull("session_id") ?: session.id
                val info = resumed.optJSONObject("info")
                val messages = client.sessionMessages(config, session.id)
                stateMutable.update {
                    it.copy(
                        screen = AppScreen.CHAT,
                        activeSessionId = runtimeId,
                        activeModel = info?.stringOrNull("model") ?: it.activeModel,
                        activeProvider = info?.stringOrNull("provider") ?: it.activeProvider,
                        messages = messages,
                        streamingText = "",
                        reasoningText = "",
                        thinkingStartedAtMs = null,
                        toolStatus = null,
                        activities = emptyList(),
                        agentStatus = null,
                        approvalRequest = null,
                        clarifyRequest = null,
                        isBusy = false,
                    )
                }
            } catch (error: Throwable) {
                stateMutable.update {
                    it.copy(isBusy = false, errorMessage = readableError(error))
                }
            }
        }
    }

    fun newChat() {
        if (activeConfig == null) return
        stateMutable.update { it.copy(isBusy = true, errorMessage = null) }
        viewModelScope.launch {
            try {
                val result = client.request(
                    "session.create",
                    sessionCreateParams(),
                )
                val runtimeId = result.stringOrNull("session_id")
                    ?: throw IllegalStateException("Hermes no devolvió session_id")
                val info = result.optJSONObject("info")
                stateMutable.update {
                    it.copy(
                        screen = AppScreen.CHAT,
                        activeStoredSessionId = result.stringOrNull("stored_session_id"),
                        activeSessionId = runtimeId,
                        activeSessionTitle = "Nuevo chat",
                        activeModel = info?.stringOrNull("model") ?: it.activeModel,
                        activeProvider = info?.stringOrNull("provider") ?: it.activeProvider,
                        messages = emptyList(),
                        streamingText = "",
                        reasoningText = "",
                        thinkingStartedAtMs = null,
                        toolStatus = null,
                        activities = emptyList(),
                        agentStatus = null,
                        approvalRequest = null,
                        clarifyRequest = null,
                        isBusy = false,
                    )
                }
            } catch (error: Throwable) {
                stateMutable.update { it.copy(isBusy = false, errorMessage = readableError(error)) }
            }
        }
    }

    fun sendMessage(rawText: String) {
        val text = rawText.trim()
        if (text.isBlank() || state.value.isBusy) return
        viewModelScope.launch {
            try {
                val sessionId = ensureActiveSession()
                val userMessage = ChatMessage(
                    id = "mobile-user-${++messageSequence}",
                    role = "user",
                    content = text,
                )
                stateMutable.update {
                    it.copy(
                        messages = it.messages + userMessage,
                        isBusy = true,
                        streamingText = "",
                        reasoningText = "",
                        thinkingStartedAtMs = System.currentTimeMillis(),
                        toolStatus = null,
                        activities = emptyList(),
                        agentStatus = null,
                        browserProgress = null,
                        approvalRequest = null,
                        clarifyRequest = null,
                        errorMessage = null,
                    )
                }
                client.request(
                    "prompt.submit",
                    JSONObject()
                        .put("session_id", sessionId)
                        .put("text", text),
                )
            } catch (error: Throwable) {
                thinkingStartedAtMs = null
                stateMutable.update {
                    it.copy(isBusy = false, errorMessage = readableError(error))
                }
            }
        }
    }

    fun stopGeneration() {
        val sessionId = state.value.activeSessionId ?: return
        viewModelScope.launch {
            runCatching {
                client.request("session.interrupt", JSONObject().put("session_id", sessionId))
            }
            settleStreaming()
            thinkingStartedAtMs = null
            stateMutable.update { it.copy(isBusy = false, toolStatus = null) }
        }
    }

    fun respondApproval(choice: String) {
        val sessionId = state.value.activeSessionId ?: return
        viewModelScope.launch {
            runCatching {
                client.request(
                    "approval.respond",
                    JSONObject()
                        .put("session_id", sessionId)
                        .put("choice", choice),
                )
            }.onSuccess {
                stateMutable.update {
                    it.copy(
                        approvalRequest = null,
                        agentStatus = "Confirmación enviada",
                        errorMessage = null,
                        isBusy = true,
                    )
                }
            }.onFailure { error ->
                stateMutable.update { it.copy(errorMessage = readableError(error)) }
            }
        }
    }

    fun respondClarify(answer: String) {
        val request = state.value.clarifyRequest ?: return
        viewModelScope.launch {
            runCatching {
                client.request(
                    "clarify.respond",
                    JSONObject()
                        .put("request_id", request.requestId)
                        .put("answer", answer),
                )
            }.onSuccess {
                stateMutable.update {
                    it.copy(
                        clarifyRequest = null,
                        agentStatus = "Respuesta enviada",
                        errorMessage = null,
                        isBusy = true,
                    )
                }
            }.onFailure { error ->
                stateMutable.update { it.copy(errorMessage = readableError(error)) }
            }
        }
    }

    fun backToSessions() {
        stateMutable.update {
            it.copy(
                screen = AppScreen.SESSIONS,
                activeStoredSessionId = null,
                activeSessionId = null,
                activeSessionTitle = "Nuevo chat",
                        messages = emptyList(),
                        streamingText = "",
                        reasoningText = "",
                        thinkingStartedAtMs = null,
                        toolStatus = null,
                        activities = emptyList(),
                        agentStatus = null,
                        approvalRequest = null,
                        clarifyRequest = null,
                isBusy = false,
                errorMessage = null,
            )
        }
        refreshSessions()
    }

    fun disconnect() {
        client.close()
        activeConfig = null
        stateMutable.update {
            it.copy(
                connectionState = ConnectionState.DISCONNECTED,
                screen = AppScreen.CONNECT,
                sessions = emptyList(),
                activeStoredSessionId = null,
                activeSessionId = null,
                modelOptions = emptyList(),
                activeModel = null,
                activeProvider = null,
                modelsLoading = false,
                modelErrorMessage = null,
                mobileSettings = null,
                settingsLoading = false,
                settingsSaving = false,
                settingsErrorMessage = null,
                        messages = emptyList(),
                        streamingText = "",
                        reasoningText = "",
                        thinkingStartedAtMs = null,
                        toolStatus = null,
                        activities = emptyList(),
                        agentStatus = null,
                        approvalRequest = null,
                        clarifyRequest = null,
                isBusy = false,
            )
        }
    }

    fun forgetConnection() {
        secureStore.clear()
        nativeCredentials = null
        client.close()
        activeConfig = null
        stateMutable.value = HermesUiState()
    }

    override fun onCleared() {
        client.close()
        super.onCleared()
    }

    private suspend fun credentialsForConnect(snapshot: HermesUiState): HermesCredentials {
        if (snapshot.authMode == AuthMode.SESSION_TOKEN) {
            val token = snapshot.tokenInput.trim()
            if (token.isBlank()) throw IllegalStateException("Escribe el token de sesión Hermes")
            val credentials = HermesCredentials(AuthMode.SESSION_TOKEN, token)
            secureStore.save(snapshot.endpoint.trim(), credentials)
            return credentials
        }

        val credentials = nativeCredentials
            ?: throw IllegalStateException("Inicia sesión con Hermes en el navegador")
        if (credentials.refreshToken.isNullOrBlank()) return credentials

        val expiresSoon = credentials.expiresAt?.let { it <= (System.currentTimeMillis() / 1000L) + 60L } ?: false
        if (!expiresSoon) return credentials

        val refreshed = nativeAuth.refresh(snapshot.endpoint.trim(), credentials.refreshToken, credentials.provider)
            .toCredentials()
        nativeCredentials = refreshed
        secureStore.save(snapshot.endpoint.trim(), refreshed)
        return refreshed
    }

    private suspend fun establish(endpoint: String, credentials: HermesCredentials) {
        val config = ConnectionConfig(endpoint, credentials)
        stateMutable.update {
            it.copy(
                connectionState = ConnectionState.CONNECTING,
                errorMessage = null,
                modelOptions = emptyList(),
                activeModel = null,
                activeProvider = null,
                modelsLoading = true,
                modelErrorMessage = null,
            )
        }
        client.connect(config)
        val status = client.status(config)
        val sessions = client.listSessions(config)
        activeConfig = config
        stateMutable.update {
            it.copy(
                connectionState = ConnectionState.CONNECTED,
                screen = AppScreen.CHAT,
                sessions = sessions,
                activeStoredSessionId = null,
                activeSessionId = null,
                activeSessionTitle = "Nuevo chat",
                messages = emptyList(),
                streamingText = "",
                reasoningText = "",
                thinkingStartedAtMs = null,
                toolStatus = null,
                activities = emptyList(),
                agentStatus = null,
                approvalRequest = null,
                clarifyRequest = null,
                isBusy = false,
                serverVersion = status.version,
                serverGatewayState = status.gatewayState,
                hasSavedNativeLogin = credentials.mode == AuthMode.NATIVE_BROWSER,
                errorMessage = null,
            )
        }
        refreshModels()
        refreshSettings()
    }

    private suspend fun ensureActiveSession(): String {
        state.value.activeSessionId?.let { return it }
        val result = client.request(
            "session.create",
            sessionCreateParams(),
        )
        val runtimeId = result.stringOrNull("session_id")
            ?: throw IllegalStateException("Hermes no devolvió session_id")
        val info = result.optJSONObject("info")
        stateMutable.update {
            it.copy(
                screen = AppScreen.CHAT,
                activeStoredSessionId = result.stringOrNull("stored_session_id"),
                activeSessionId = runtimeId,
                activeSessionTitle = "Nuevo chat",
                activeModel = info?.stringOrNull("model") ?: it.activeModel,
                activeProvider = info?.stringOrNull("provider") ?: it.activeProvider,
            )
        }
        return runtimeId
    }

    private fun handleEvent(event: GatewayEvent) {
        val current = state.value
        val activeId = current.activeSessionId
        if (event.sessionId != null && activeId != null && event.sessionId != activeId) return

        when (event.type) {
            "message.start" -> {
                thinkingStartedAtMs = thinkingStartedAtMs ?: System.currentTimeMillis()
                stateMutable.update {
                    it.copy(
                        isBusy = true,
                        streamingText = "",
                        reasoningText = "",
                        thinkingStartedAtMs = thinkingStartedAtMs,
                        toolStatus = null,
                        activities = emptyList(),
                        agentStatus = null,
                        approvalRequest = null,
                        clarifyRequest = null,
                    )
                }
            }
            "message.delta", "message.interim" -> {
                val delta = event.payload.stringOrNull("text")
                    ?: event.payload.stringOrNull("delta")
                    ?: return
                stateMutable.update { it.copy(isBusy = true, streamingText = it.streamingText + delta) }
            }
            "thinking.delta" -> {
                val status = event.payload.stringOrNull("text")
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                    ?: "Hermes está pensando…"
                stateMutable.update { it.copy(isBusy = true, toolStatus = status) }
            }
            "reasoning.delta" -> {
                val delta = event.payload.stringOrNull("text")
                    ?: event.payload.stringOrNull("delta")
                    ?: return
                stateMutable.update {
                    it.copy(
                        isBusy = true,
                        reasoningText = it.reasoningText + delta,
                        toolStatus = null,
                        agentStatus = null,
                    )
                }
            }
            "reasoning.available" -> {
                // El gateway puede anunciar razonamiento aunque no envíe su contenido.
                // En ese caso mostramos actividad, pero no inventamos un bloque de pensamiento.
                stateMutable.update {
                    it.copy(isBusy = true, agentStatus = "Hermes está preparando la respuesta…")
                }
            }
            "tool.start", "tool.generating" -> {
                val name = event.payload.stringOrNull("name")
                    ?: event.payload.stringOrNull("tool")
                    ?: "agent_tool"
                val id = resolveActivityId(event.payload, name)
                val existing = state.value.activities.firstOrNull { it.id == id }
                val activity = (existing ?: AgentActivity(id = id, name = name)).copy(
                    name = name,
                    context = event.payload.stringOrNull("context") ?: existing?.context.orEmpty(),
                    argsText = event.payload.stringOrNull("args_text") ?: existing?.argsText,
                    status = AgentActivityStatus.RUNNING,
                )
                stateMutable.update {
                    it.copy(
                        isBusy = true,
                        activities = upsertActivity(it.activities, activity),
                        toolStatus = name,
                        agentStatus = null,
                    )
                }
            }
            "tool.progress" -> {
                val status = event.payload.stringOrNull("text")
                    ?: event.payload.stringOrNull("message")
                stateMutable.update {
                    it.copy(isBusy = true, agentStatus = status ?: it.agentStatus)
                }
            }
            "tool.complete" -> {
                val name = event.payload.stringOrNull("name")
                    ?: event.payload.stringOrNull("tool")
                    ?: "agent_tool"
                val id = resolveActivityId(event.payload, name)
                val existing = state.value.activities.firstOrNull { it.id == id }
                val failed = event.payload.optBoolean("is_error", false) ||
                    (event.payload.has("error") && !event.payload.isNull("error"))
                val duration = event.payload.optDouble("duration_s", Double.NaN)
                    .takeIf { !it.isNaN() }
                    ?.let { (it * 1000).toLong() }
                val activity = (existing ?: AgentActivity(id = id, name = name)).copy(
                    name = name,
                    context = event.payload.stringOrNull("context") ?: existing?.context.orEmpty(),
                    status = if (failed) AgentActivityStatus.FAILED else AgentActivityStatus.COMPLETE,
                    summary = event.payload.stringOrNull("summary") ?: existing?.summary,
                    durationMs = duration ?: existing?.durationMs,
                    argsText = event.payload.stringOrNull("args_text")
                        ?: event.payload.optJSONObject("args")?.toString()
                        ?: event.payload.stringOrNull("args")
                        ?: existing?.argsText,
                    resultText = event.payload.stringOrNull("result_text")
                        ?: event.payload.opt("result")?.takeIf { it != JSONObject.NULL }?.toString()
                        ?: existing?.resultText,
                    inlineDiff = event.payload.stringOrNull("inline_diff") ?: existing?.inlineDiff,
                    todos = parseTodos(event.payload.optJSONArray("todos")).ifEmpty { existing?.todos.orEmpty() },
                )
                stateMutable.update {
                    it.copy(
                        activities = upsertActivity(it.activities, activity),
                        toolStatus = null,
                        agentStatus = activity.summary,
                    )
                }
            }
            "status.update" -> {
                val kind = event.payload.stringOrNull("kind").orEmpty()
                val text = event.payload.stringOrNull("text")
                stateMutable.update {
                    it.copy(
                        isBusy = if (kind == "compacted") it.isBusy else true,
                        agentStatus = if (kind == "compacted") null else text,
                    )
                }
            }
            "browser.progress" -> {
                val sources = readBrowserSources(event.payload)
                val progress = HermesBrowserProgress(
                    stage = event.payload.stringOrNull("stage"),
                    message = event.payload.stringOrNull("message")
                        ?: event.payload.stringOrNull("text"),
                    sources = sources,
                    errorCode = event.payload.stringOrNull("error_code"),
                    errorMessage = event.payload.stringOrNull("error"),
                    canCancel = event.payload.optBoolean("can_cancel", true),
                )
                stateMutable.update {
                    it.copy(
                        isBusy = true,
                        agentStatus = progress.message ?: it.agentStatus,
                        browserProgress = progress,
                    )
                }
            }
            "browser.error" -> {
                val progress = HermesBrowserProgress(
                    stage = event.payload.stringOrNull("stage"),
                    message = event.payload.stringOrNull("message")
                        ?: event.payload.stringOrNull("text"),
                    sources = readBrowserSources(event.payload),
                    errorCode = event.payload.stringOrNull("code")
                        ?: event.payload.stringOrNull("error_code"),
                    errorMessage = event.payload.stringOrNull("error")
                        ?: event.payload.stringOrNull("message"),
                    canCancel = event.payload.optBoolean("can_cancel", true),
                )
                stateMutable.update {
                    it.copy(
                        isBusy = true,
                        agentStatus = progress.errorMessage ?: progress.message ?: it.agentStatus,
                        browserProgress = progress,
                    )
                }
            }
            "tool.output_risk" -> {
                val text = event.payload.stringOrNull("message")
                    ?: event.payload.stringOrNull("text")
                    ?: "Revisa el riesgo de la salida antes de continuar"
                stateMutable.update { it.copy(isBusy = true, agentStatus = text) }
            }
            "approval.request" -> {
                val choices = readStringArray(event.payload.optJSONArray("choices"))
                    .ifEmpty { listOf("once", "session", "deny") }
                stateMutable.update {
                    it.copy(
                        isBusy = true,
                        toolStatus = null,
                        agentStatus = "Necesita tu confirmación",
                        approvalRequest = HermesApprovalRequest(
                            command = event.payload.stringOrNull("command").orEmpty(),
                            description = event.payload.stringOrNull("description")
                                ?: "Hermes quiere ejecutar una acción en el equipo",
                            choices = choices,
                            allowPermanent = event.payload.optBoolean("allow_permanent", true),
                            smartDenied = event.payload.optBoolean("smart_denied", false),
                        ),
                    )
                }
            }
            "clarify.request" -> {
                val requestId = event.payload.stringOrNull("request_id") ?: return
                stateMutable.update {
                    it.copy(
                        isBusy = true,
                        toolStatus = null,
                        agentStatus = "Hermes necesita una respuesta",
                        clarifyRequest = HermesClarifyRequest(
                            requestId = requestId,
                            question = event.payload.stringOrNull("question") ?: "¿Cómo quieres continuar?",
                            choices = readStringArray(event.payload.optJSONArray("choices")),
                        ),
                    )
                }
            }
            "session.info" -> {
                val model = event.payload.stringOrNull("model")
                val provider = event.payload.stringOrNull("provider")
                val running = event.payload.optBoolean("running", false)
                stateMutable.update {
                    it.copy(
                        activeModel = model ?: it.activeModel,
                        activeProvider = provider ?: it.activeProvider,
                        isBusy = if (running) true else it.isBusy,
                    )
                }
            }
            "subagent.start", "subagent.progress", "subagent.complete", "subagent.result" -> {
                val name = event.payload.stringOrNull("tool_name") ?: "delegate_task"
                val id = event.payload.stringOrNull("subagent_id")
                    ?: event.payload.stringOrNull("child_session_id")
                    ?: "subagent-${event.payload.optInt("task_index", 0)}"
                val existing = state.value.activities.firstOrNull { it.id == id }
                val isComplete = event.type == "subagent.complete" || event.type == "subagent.result"
                val duration = event.payload.optDouble("duration_seconds", Double.NaN)
                    .takeIf { !it.isNaN() }
                    ?.let { (it * 1000).toLong() }
                val activity = (existing ?: AgentActivity(id = id, name = name)).copy(
                    name = name,
                    context = event.payload.stringOrNull("goal")
                        ?: event.payload.stringOrNull("text")
                        ?: existing?.context.orEmpty(),
                    status = if (isComplete) AgentActivityStatus.COMPLETE else AgentActivityStatus.RUNNING,
                    summary = event.payload.stringOrNull("summary") ?: existing?.summary,
                    durationMs = duration ?: existing?.durationMs,
                )
                stateMutable.update {
                    it.copy(
                        isBusy = !isComplete || it.isBusy,
                        activities = upsertActivity(it.activities, activity),
                        agentStatus = if (isComplete) activity.summary else activity.context,
                    )
                }
            }
            "error" -> {
                val message = event.payload.stringOrNull("error")
                    ?: event.payload.stringOrNull("message")
                    ?: "Hermes reportó un error"
                stateMutable.update {
                    it.copy(
                        isBusy = false,
                        reasoningText = "",
                        thinkingStartedAtMs = null,
                        toolStatus = null,
                        agentStatus = "La tarea se detuvo",
                        approvalRequest = null,
                        clarifyRequest = null,
                        errorMessage = message,
                    )
                }
            }
        }
    }

    private fun resolveActivityId(payload: JSONObject, name: String): String =
        payload.stringOrNull("tool_id")
            ?: state.value.activities.lastOrNull {
                it.name.equals(name, ignoreCase = true) && it.status == AgentActivityStatus.RUNNING
            }?.id
            ?: "tool-${++activitySequence}"

    private fun upsertActivity(current: List<AgentActivity>, activity: AgentActivity): List<AgentActivity> {
        val next = current.toMutableList()
        val index = next.indexOfFirst { it.id == activity.id }
        if (index >= 0) next[index] = activity else next += activity
        return next
    }

    private fun parseTodos(array: JSONArray?): List<AgentTodo> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val todo = array.optJSONObject(index) ?: continue
                val content = todo.stringOrNull("content")
                    ?: todo.stringOrNull("text")
                    ?: continue
                add(
                    AgentTodo(
                        content = content,
                        status = todo.stringOrNull("status") ?: "pending",
                        activeForm = todo.stringOrNull("active_form"),
                    ),
                )
            }
        }
    }

    private fun readBrowserSources(payload: JSONObject): List<HermesBrowserSource> {
        val array = payload.optJSONArray("sources") ?: payload.optJSONArray("citations")
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val url = item.stringOrNull("url").orEmpty()
                if (url.isBlank()) continue
                add(
                    HermesBrowserSource(
                        title = item.stringOrNull("title").orEmpty().ifBlank { url },
                        url = url,
                    ),
                )
            }
        }
    }

    private fun readStringArray(array: JSONArray?): List<String> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                array.optString(index).trim().takeIf { it.isNotBlank() }?.let(::add)
            }
        }
    }

    private fun settleStreaming() {
        val text = state.value.streamingText.trim()
        if (text.isBlank()) {
            thinkingStartedAtMs = null
            stateMutable.update {
                it.copy(
                    streamingText = "",
                    reasoningText = "",
                    thinkingStartedAtMs = null,
                    activities = emptyList(),
                    agentStatus = null,
                    approvalRequest = null,
                    clarifyRequest = null,
                )
            }
            return
        }
        val reasoning = state.value.reasoningText.trim()
        val thinkingDurationMs = if (reasoning.isNotBlank()) {
            thinkingStartedAtMs?.let { (System.currentTimeMillis() - it).coerceAtLeast(0L) }
        } else {
            null
        }
        thinkingStartedAtMs = null
        stateMutable.update {
            it.copy(
                messages = it.messages + ChatMessage(
                    id = "mobile-interrupted-${++messageSequence}",
                    role = "assistant",
                    content = text,
                    reasoning = reasoning,
                    thinkingDurationMs = thinkingDurationMs,
                    activities = it.activities,
                ),
                streamingText = "",
                reasoningText = "",
                thinkingStartedAtMs = null,
                activities = emptyList(),
                agentStatus = null,
                approvalRequest = null,
                clarifyRequest = null,
            )
        }
    }

    private fun handleConnectionFailure(error: Throwable) {
        client.close()
        activeConfig = null
        stateMutable.update {
            it.copy(
                connectionState = ConnectionState.ERROR,
                screen = AppScreen.CONNECT,
                modelOptions = emptyList(),
                activeModel = null,
                activeProvider = null,
                modelsLoading = false,
                modelErrorMessage = null,
                mobileSettings = null,
                settingsLoading = false,
                settingsSaving = false,
                settingsErrorMessage = null,
                reasoningText = "",
                thinkingStartedAtMs = null,
                activities = emptyList(),
                agentStatus = null,
                approvalRequest = null,
                clarifyRequest = null,
                errorMessage = readableError(error),
            )
        }
    }

    private fun readableError(error: Throwable): String {
        val message = error.message.orEmpty()
        return when {
            message.contains("timeout", ignoreCase = true) -> "Hermes tardó demasiado. Revisa la red y el gateway."
            message.contains("CLEARTEXT", ignoreCase = true) -> "HTTP local bloqueado. Usa HTTPS o una URL LAN permitida."
            message.isNotBlank() -> message
            else -> "No se pudo completar la operación Hermes"
        }
    }

    private fun sessionCreateParams(): JSONObject {
        val snapshot = state.value
        return JSONObject()
            .put("cols", 80)
            .put("source", "desktop")
            .apply {
                snapshot.activeModel?.trim()?.takeIf { it.isNotBlank() }?.let { put("model", it) }
                snapshot.activeProvider?.trim()?.takeIf { it.isNotBlank() }?.let { put("provider", it) }
            }
    }

    private fun NativeTokens.toCredentials() = HermesCredentials(
        mode = AuthMode.NATIVE_BROWSER,
        accessToken = accessToken,
        refreshToken = refreshToken.takeIf { it.isNotBlank() },
        provider = provider,
        expiresAt = expiresAt,
    )

    private companion object {
        const val MINIMUM_CONTEXT_LENGTH = 64_000

        fun JSONObject.stringOrNull(key: String): String? =
            if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
    }
}
