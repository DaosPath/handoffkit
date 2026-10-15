package com.hijosdelsol.hermesmobile.model

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    ERROR,
}

enum class AppScreen {
    CONNECT,
    SESSIONS,
    CHAT,
}

enum class AuthMode {
    SESSION_TOKEN,
    NATIVE_BROWSER,
}

data class HermesCredentials(
    val mode: AuthMode,
    val accessToken: String,
    val refreshToken: String? = null,
    val provider: String? = null,
    val expiresAt: Long? = null,
)

data class ConnectionConfig(
    val endpoint: String,
    val credentials: HermesCredentials,
)

data class HermesServerStatus(
    val version: String?,
    val gatewayRunning: Boolean,
    val gatewayState: String?,
    val authRequired: Boolean,
    val authFlows: List<String>,
)

data class SessionSummary(
    val id: String,
    val title: String,
    val preview: String,
    val source: String?,
    val messageCount: Int,
    val lastActive: Long?,
)

enum class AgentActivityStatus {
    RUNNING,
    COMPLETE,
    FAILED,
}

data class AgentTodo(
    val content: String,
    val status: String,
    val activeForm: String? = null,
)

data class AgentActivity(
    val id: String,
    val name: String,
    val context: String = "",
    val status: AgentActivityStatus = AgentActivityStatus.RUNNING,
    val summary: String? = null,
    val durationMs: Long? = null,
    val argsText: String? = null,
    val resultText: String? = null,
    val inlineDiff: String? = null,
    val todos: List<AgentTodo> = emptyList(),
)

data class HermesApprovalRequest(
    val command: String,
    val description: String,
    val choices: List<String> = listOf("once", "session", "deny"),
    val allowPermanent: Boolean = true,
    val smartDenied: Boolean = false,
)

data class HermesClarifyRequest(
    val requestId: String,
    val question: String,
    val choices: List<String> = emptyList(),
)

data class ChatMessage(
    val id: String,
    val role: String,
    val content: String,
    val reasoning: String = "",
    val thinkingDurationMs: Long? = null,
    val activities: List<AgentActivity> = emptyList(),
)

data class HermesModelOption(
    val id: String,
    val displayName: String = id,
    val provider: String,
    val providerName: String,
    val selectable: Boolean = true,
    val warning: String? = null,
)

data class HermesModelOptions(
    val options: List<HermesModelOption>,
    val activeModel: String?,
    val activeProvider: String?,
)

data class HermesMobileSettings(
    val defaultModel: String? = null,
    val defaultProvider: String? = null,
    val contextLength: Int? = null,
    val ollamaNumCtx: Int? = null,
    val compressionEnabled: Boolean = true,
    val compressionThreshold: Double = 0.5,
    val maxTurns: Int = 150,
    val reasoningEffort: String = "medium",
)

data class HermesSettingsDraft(
    val defaultModel: String?,
    val defaultProvider: String?,
    val contextLength: Int,
    val ollamaNumCtx: Int,
    val compressionEnabled: Boolean,
    val compressionThreshold: Double,
    val maxTurns: Int,
    val reasoningEffort: String,
)

data class GatewayEvent(
    val type: String,
    val sessionId: String?,
    val payload: org.json.JSONObject,
)

data class HermesBrowserSource(
    val title: String,
    val url: String,
)

data class HermesBrowserProgress(
    val stage: String? = null,
    val message: String? = null,
    val sources: List<HermesBrowserSource> = emptyList(),
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val canCancel: Boolean = true,
)

data class HermesUiState(
    val endpoint: String = "",
    val tokenInput: String = "",
    val authMode: AuthMode = AuthMode.SESSION_TOKEN,
    val hasSavedNativeLogin: Boolean = false,
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val screen: AppScreen = AppScreen.CONNECT,
    val sessions: List<SessionSummary> = emptyList(),
    val activeStoredSessionId: String? = null,
    val activeSessionId: String? = null,
    val activeSessionTitle: String = "Nuevo chat",
    val messages: List<ChatMessage> = emptyList(),
    val streamingText: String = "",
    val reasoningText: String = "",
    val thinkingStartedAtMs: Long? = null,
    val toolStatus: String? = null,
    val activities: List<AgentActivity> = emptyList(),
    val agentStatus: String? = null,
    val browserProgress: HermesBrowserProgress? = null,
    val approvalRequest: HermesApprovalRequest? = null,
    val clarifyRequest: HermesClarifyRequest? = null,
    val isBusy: Boolean = false,
    val modelOptions: List<HermesModelOption> = emptyList(),
    val activeModel: String? = null,
    val activeProvider: String? = null,
    val modelsLoading: Boolean = false,
    val modelErrorMessage: String? = null,
    val mobileSettings: HermesMobileSettings? = null,
    val settingsLoading: Boolean = false,
    val settingsSaving: Boolean = false,
    val settingsErrorMessage: String? = null,
    val serverVersion: String? = null,
    val serverGatewayState: String? = null,
    val errorMessage: String? = null,
)
