package com.hijosdelsol.hermesmobile.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.material.icons.outlined.PowerSettingsNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hijosdelsol.hermesmobile.HermesViewModel
import com.hijosdelsol.hermesmobile.model.AgentActivity
import com.hijosdelsol.hermesmobile.model.AgentActivityStatus
import com.hijosdelsol.hermesmobile.model.AppScreen
import com.hijosdelsol.hermesmobile.model.AuthMode
import com.hijosdelsol.hermesmobile.model.ChatMessage
import com.hijosdelsol.hermesmobile.model.ConnectionState
import com.hijosdelsol.hermesmobile.model.HermesUiState
import com.hijosdelsol.hermesmobile.model.HermesModelOption
import com.hijosdelsol.hermesmobile.model.HermesApprovalRequest
import com.hijosdelsol.hermesmobile.model.HermesBrowserProgress
import com.hijosdelsol.hermesmobile.model.HermesClarifyRequest
import com.hijosdelsol.hermesmobile.model.HermesSettingsDraft
import com.hijosdelsol.hermesmobile.model.ModelNameFormatter
import com.hijosdelsol.hermesmobile.model.SessionSummary
import com.hijosdelsol.hermesmobile.ui.theme.HermesWarning
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HermesApp(viewModel: HermesViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        when (state.screen) {
            AppScreen.CONNECT -> ConnectionScreen(
                state = state,
                onEndpointChange = viewModel::setEndpoint,
                onTokenChange = viewModel::setToken,
                onAuthModeChange = viewModel::setAuthMode,
                onConnect = viewModel::connect,
                onBrowserLogin = { viewModel.loginInBrowser(context) },
                onForget = viewModel::forgetConnection,
            )
            AppScreen.SESSIONS,
            AppScreen.CHAT -> ChatWorkspace(
                state = state,
                onNewChat = viewModel::newChat,
                onOpenSession = viewModel::openSession,
                onRefresh = viewModel::refreshSessions,
                onDisconnect = viewModel::disconnect,
                onSend = viewModel::sendMessage,
                onStop = viewModel::stopGeneration,
                onApprovalChoice = viewModel::respondApproval,
                onClarifyAnswer = viewModel::respondClarify,
                onSelectModel = viewModel::selectModel,
                onRefreshModels = viewModel::refreshModels,
                onEndpointChange = viewModel::setEndpoint,
                onTokenChange = viewModel::setToken,
                onAuthModeChange = viewModel::setAuthMode,
                onConnect = viewModel::connect,
                onBrowserLogin = { viewModel.loginInBrowser(context) },
                onForget = viewModel::forgetConnection,
                onSaveSettings = viewModel::saveSettings,
                onRefreshSettings = viewModel::refreshSettings,
            )
        }
    }
}

@Composable
private fun HermesFilterChipColors() = FilterChipDefaults.filterChipColors(
    containerColor = Color.Transparent,
    labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
    selectedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
    selectedLabelColor = MaterialTheme.colorScheme.primary,
)

@Composable
private fun ConnectionScreen(
    state: HermesUiState,
    onEndpointChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onAuthModeChange: (AuthMode) -> Unit,
    onConnect: () -> Unit,
    onBrowserLogin: () -> Unit,
    onForget: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .safeDrawingPadding()
            .padding(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Spacer(Modifier.height(18.dp))
        BrandHeader()
        Text(
            text = "Controla tu agente desde Android",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
            shape = RoundedCornerShape(22.dp),
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Conectar al gateway", style = MaterialTheme.typography.titleLarge)
                OutlinedTextField(
                    value = state.endpoint,
                    onValueChange = onEndpointChange,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("URL de Hermes") },
                    placeholder = { Text("http://10.0.2.2:9119") },
                    supportingText = {
                        Text("Emulador Android: 10.0.2.2 · teléfono: IP LAN del PC")
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                )

                Text("Método de acceso", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = state.authMode == AuthMode.SESSION_TOKEN,
                        onClick = { onAuthModeChange(AuthMode.SESSION_TOKEN) },
                        label = { Text("Token local") },
                        colors = HermesFilterChipColors(),
                    )
                    FilterChip(
                        selected = state.authMode == AuthMode.NATIVE_BROWSER,
                        onClick = { onAuthModeChange(AuthMode.NATIVE_BROWSER) },
                        label = { Text("Navegador") },
                        colors = HermesFilterChipColors(),
                    )
                }

                if (state.authMode == AuthMode.SESSION_TOKEN) {
                    OutlinedTextField(
                        value = state.tokenInput,
                        onValueChange = onTokenChange,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("Token de sesión") },
                        supportingText = { Text("Se guarda cifrado con Android Keystore") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    )
                    Button(
                        onClick = onConnect,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = state.connectionState != ConnectionState.CONNECTING,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                    ) {
                        ConnectButtonContent(state.connectionState, "Conectar")
                    }
                } else {
                    BrowserLoginCard(
                        hasSavedLogin = state.hasSavedNativeLogin,
                        isConnecting = state.connectionState == ConnectionState.CONNECTING,
                        onLogin = onBrowserLogin,
                        onConnect = onConnect,
                    )
                }
            }
        }

        if (state.errorMessage != null) ErrorBanner(state.errorMessage)

        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            shape = RoundedCornerShape(18.dp),
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Lock,
                    contentDescription = "Seguridad",
                    tint = MaterialTheme.colorScheme.primary,
                )
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Conexión directa", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "La app habla con tu Hermes. No enviamos el token a ningún servidor intermedio.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        if (state.endpoint.isNotBlank() || state.hasSavedNativeLogin) {
            TextButton(onClick = onForget, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Olvidar conexión")
            }
        }
    }
}

@Composable
private fun BrandHeader() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        HermesMark(modifier = Modifier.size(56.dp), iconSize = 30.dp)
        Column {
            Text("Hermes Pocket", style = MaterialTheme.typography.headlineSmall)
            Text(
                "STUDIO COMPANION",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                letterSpacing = 1.5.sp,
            )
        }
    }
}

@Composable
private fun HermesMark(modifier: Modifier = Modifier, iconSize: androidx.compose.ui.unit.Dp = 22.dp) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(17.dp),
        color = MaterialTheme.colorScheme.primary,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                imageVector = Icons.Outlined.Terminal,
                contentDescription = "Hermes",
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(iconSize),
            )
        }
    }
}

@Composable
private fun BrowserLoginCard(
    hasSavedLogin: Boolean,
    isConnecting: Boolean,
    onLogin: () -> Unit,
    onConnect: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                Icon(
                    imageVector = Icons.Outlined.OpenInBrowser,
                    contentDescription = "Login en navegador",
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text(
                    "Hermes abrirá su login en el navegador. El token vuelve directo a esta app mediante PKCE.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (hasSavedLogin) {
                Button(
                    onClick = onConnect,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isConnecting,
                ) {
                    ConnectButtonContent(
                        if (isConnecting) ConnectionState.CONNECTING else ConnectionState.DISCONNECTED,
                        "Usar sesión guardada",
                    )
                }
                OutlinedButton(
                    onClick = onLogin,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isConnecting,
                ) {
                    Icon(Icons.Outlined.OpenInBrowser, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Reautenticar")
                }
            } else {
                Button(onClick = onLogin, modifier = Modifier.fillMaxWidth(), enabled = !isConnecting) {
                    ConnectButtonContent(
                        if (isConnecting) ConnectionState.CONNECTING else ConnectionState.DISCONNECTED,
                        "Iniciar sesión",
                    )
                }
            }
        }
    }
}

@Composable
private fun ConnectButtonContent(connectionState: ConnectionState, label: String) {
    if (connectionState == ConnectionState.CONNECTING) {
        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.size(10.dp))
        Text("Conectando…")
    } else {
        Icon(Icons.Outlined.Wifi, contentDescription = null)
        Spacer(Modifier.size(8.dp))
        Text(label)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatWorkspace(
    state: HermesUiState,
    onNewChat: () -> Unit,
    onOpenSession: (SessionSummary) -> Unit,
    onRefresh: () -> Unit,
    onDisconnect: () -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onApprovalChoice: (String) -> Unit,
    onClarifyAnswer: (String) -> Unit,
    onSelectModel: (HermesModelOption) -> Unit,
    onRefreshModels: () -> Unit,
    onEndpointChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onAuthModeChange: (AuthMode) -> Unit,
    onConnect: () -> Unit,
    onBrowserLogin: () -> Unit,
    onForget: () -> Unit,
    onSaveSettings: (HermesSettingsDraft, () -> Unit) -> Unit,
    onRefreshSettings: () -> Unit,
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var settingsOpen by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        ModalNavigationDrawer(
            drawerState = drawerState,
            gesturesEnabled = true,
            scrimColor = Color.Black.copy(alpha = 0.72f),
            drawerContent = {
                ConversationDrawer(
                    state = state,
                    onClose = { scope.launch { drawerState.close() } },
                    onNewChat = {
                        scope.launch { drawerState.close() }
                        onNewChat()
                    },
                    onOpenSession = { session ->
                        scope.launch { drawerState.close() }
                        onOpenSession(session)
                    },
                    onRefresh = onRefresh,
                    onSettings = {
                        scope.launch {
                            drawerState.close()
                            settingsOpen = true
                        }
                        onRefreshSettings()
                    },
                    onDisconnect = {
                        scope.launch { drawerState.close() }
                        onDisconnect()
                    },
                )
            },
        ) {
            ChatScreen(
                state = state,
                onOpenDrawer = { scope.launch { drawerState.open() } },
                onDisconnect = onDisconnect,
                onSend = onSend,
                onStop = onStop,
                onApprovalChoice = onApprovalChoice,
                onClarifyAnswer = onClarifyAnswer,
                onSelectModel = onSelectModel,
                onRefreshModels = onRefreshModels,
            )
        }

        if (settingsOpen) {
            SettingsDialog(
                state = state,
                onDismiss = { settingsOpen = false },
                onEndpointChange = onEndpointChange,
                onTokenChange = onTokenChange,
                onAuthModeChange = onAuthModeChange,
                onRefreshModels = onRefreshModels,
                onRefreshSettings = onRefreshSettings,
                onBrowserLogin = {
                    settingsOpen = false
                    onBrowserLogin()
                },
                onForget = {
                    settingsOpen = false
                    onForget()
                },
                onSaveSettings = { draft ->
                    onSaveSettings(draft) {
                        settingsOpen = false
                        onConnect()
                    }
                },
            )
        }
    }
}

@Composable
private fun ConversationDrawer(
    state: HermesUiState,
    onClose: () -> Unit,
    onNewChat: () -> Unit,
    onOpenSession: (SessionSummary) -> Unit,
    onRefresh: () -> Unit,
    onSettings: () -> Unit,
    onDisconnect: () -> Unit,
) {
    var searchOpen by rememberSaveable { mutableStateOf(false) }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    val searchFocusRequester = remember { FocusRequester() }
    LaunchedEffect(searchOpen) {
        if (searchOpen) searchFocusRequester.requestFocus()
    }
    val filteredSessions = state.sessions.filter { session ->
        val query = searchQuery.trim()
        query.isBlank() || session.title.contains(query, ignoreCase = true) ||
            session.preview.contains(query, ignoreCase = true)
    }
    val isNewChatSelected = state.activeSessionId == null && !state.isBusy

    ModalDrawerSheet(
        modifier = Modifier
            .widthIn(min = 280.dp, max = 304.dp)
            .fillMaxHeight(),
        drawerShape = RoundedCornerShape(topEnd = 20.dp, bottomEnd = 20.dp),
        drawerContainerColor = MaterialTheme.colorScheme.background,
        drawerContentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        Column(Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .statusBarsPadding()
                    .padding(start = 12.dp, top = 6.dp, end = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    HermesMark(modifier = Modifier.size(34.dp), iconSize = 19.dp)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { searchOpen = !searchOpen }) {
                        Icon(Icons.Outlined.Search, contentDescription = "Buscar conversaciones")
                    }
                    IconButton(onClick = onClose) {
                        Icon(Icons.Outlined.Close, contentDescription = "Cerrar conversaciones")
                    }
                }

                if (searchOpen) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(13.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
                    ) {
                        BasicTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(searchFocusRequester),
                            singleLine = true,
                            textStyle = MaterialTheme.typography.bodyMedium.copy(
                                color = MaterialTheme.colorScheme.onSurface,
                            ),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            decorationBox = { innerTextField ->
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(
                                        Icons.Outlined.Search,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Box(
                                        modifier = Modifier
                                            .weight(1f)
                                            .padding(start = 8.dp),
                                    ) {
                                        if (searchQuery.isBlank()) {
                                            Text(
                                                "Buscar",
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                style = MaterialTheme.typography.bodyMedium,
                                            )
                                        }
                                        innerTextField()
                                    }
                                }
                            },
                        )
                    }
                }

                DrawerActionRow(
                    icon = Icons.Outlined.Edit,
                    label = "Nuevo chat",
                    selected = isNewChatSelected,
                    onClick = onNewChat,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Conversaciones",
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    IconButton(onClick = onRefresh) {
                        Icon(
                            Icons.Outlined.Refresh,
                            contentDescription = "Actualizar conversaciones",
                            modifier = Modifier.size(19.dp),
                        )
                    }
                }
            }

            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (filteredSessions.isEmpty()) {
                    item {
                        DrawerEmptyState(
                            hasSearch = searchQuery.isNotBlank(),
                            modifier = Modifier.padding(top = 18.dp),
                        )
                    }
                } else {
                    items(filteredSessions, key = { it.id }) { session ->
                        ConversationRow(
                            session = session,
                            selected = session.id == state.activeStoredSessionId,
                            onClick = { onOpenSession(session) },
                        )
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f))
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding(),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.56f),
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(onClick = onSettings),
                        shape = RoundedCornerShape(14.dp),
                        color = Color.Transparent,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 9.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(
                                Icons.Outlined.Settings,
                                contentDescription = null,
                                modifier = Modifier.size(20.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Configuración", style = MaterialTheme.typography.labelLarge)
                                Text(
                                    "Conexión y preferencias",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
                    Row(
                        modifier = Modifier.padding(start = 8.dp, top = 4.dp, end = 0.dp, bottom = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        HermesMark(modifier = Modifier.size(28.dp), iconSize = 16.dp)
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Hermes Studio", style = MaterialTheme.typography.labelLarge)
                            Text(
                                "Studio companion",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        IconButton(onClick = onDisconnect) {
                            Icon(Icons.Outlined.PowerSettingsNew, contentDescription = "Desconectar")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsDialog(
    state: HermesUiState,
    onDismiss: () -> Unit,
    onEndpointChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onAuthModeChange: (AuthMode) -> Unit,
    onRefreshModels: () -> Unit,
    onRefreshSettings: () -> Unit,
    onBrowserLogin: () -> Unit,
    onForget: () -> Unit,
    onSaveSettings: (HermesSettingsDraft) -> Unit,
) {
    val scrollState = rememberScrollState()
    val settings = state.mobileSettings
    val defaultModelSeed = settings?.defaultModel?.takeIf { it.isNotBlank() }
        ?: state.activeModel.orEmpty()
    val defaultProviderSeed = settings?.defaultProvider?.takeIf { it.isNotBlank() }
        ?: state.activeProvider.orEmpty()
    val contextSeed = settings?.contextLength ?: 131_072
    val ollamaSeed = settings?.ollamaNumCtx ?: 65_536
    val compressionSeed = ((settings?.compressionThreshold ?: 0.5) * 100.0)
        .roundToInt()
        .coerceIn(10, 99)
    val maxTurnsSeed = settings?.maxTurns ?: 150
    val reasoningSeed = settings?.reasoningEffort ?: "medium"

    var defaultModel by rememberSaveable(defaultModelSeed) { mutableStateOf(defaultModelSeed) }
    var defaultProvider by rememberSaveable(defaultProviderSeed) { mutableStateOf(defaultProviderSeed) }
    var contextLengthText by rememberSaveable(contextSeed) { mutableStateOf(contextSeed.toString()) }
    var ollamaNumCtxText by rememberSaveable(ollamaSeed) { mutableStateOf(ollamaSeed.toString()) }
    var compressionEnabled by rememberSaveable(settings?.compressionEnabled) {
        mutableStateOf(settings?.compressionEnabled ?: true)
    }
    var compressionThresholdText by rememberSaveable(compressionSeed) {
        mutableStateOf(compressionSeed.toString())
    }
    var maxTurnsText by rememberSaveable(maxTurnsSeed) { mutableStateOf(maxTurnsSeed.toString()) }
    var reasoningEffort by rememberSaveable(reasoningSeed) { mutableStateOf(reasoningSeed) }
    var modelMenuOpen by rememberSaveable { mutableStateOf(false) }
    var formError by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(settings) {
        settings ?: return@LaunchedEffect
        defaultModel = settings.defaultModel?.takeIf { it.isNotBlank() }
            ?: state.activeModel.orEmpty()
        defaultProvider = settings.defaultProvider?.takeIf { it.isNotBlank() }
            ?: state.activeProvider.orEmpty()
        contextLengthText = (settings.contextLength ?: 131_072).toString()
        ollamaNumCtxText = (settings.ollamaNumCtx ?: 65_536).toString()
        compressionEnabled = settings.compressionEnabled
        compressionThresholdText = (settings.compressionThreshold * 100.0)
            .roundToInt()
            .coerceIn(10, 99)
            .toString()
        maxTurnsText = settings.maxTurns.toString()
        reasoningEffort = settings.reasoningEffort
    }

    val availableModels = buildList {
        addAll(state.modelOptions)
        if (defaultModel.isNotBlank() && all { it.id != defaultModel }) {
            add(
                HermesModelOption(
                    id = defaultModel,
                    displayName = ModelNameFormatter.displayName(defaultModel, defaultProvider),
                    provider = defaultProvider,
                    providerName = defaultProvider.ifBlank { "Configurado" },
                ),
            )
        }
    }.distinctBy { "${it.provider}::${it.id}" }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .widthIn(max = 460.dp)
                .heightIn(max = 760.dp),
            shape = RoundedCornerShape(22.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.72f)),
        ) {
            Column(
                modifier = Modifier
                    .verticalScroll(scrollState)
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Configuración", style = MaterialTheme.typography.titleLarge)
                        Text(
                            "Ajusta cómo Hermes se conecta y trabaja.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Outlined.Close, contentDescription = "Cerrar configuración")
                    }
                }

                SettingsSectionTitle("Conexión", "Dónde vive Hermes y cómo se autentica.")
                OutlinedTextField(
                    value = state.endpoint,
                    onValueChange = onEndpointChange,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("URL de Hermes") },
                    placeholder = { Text("http://10.0.2.2:9119") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                )

                Text("Método de acceso", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = state.authMode == AuthMode.SESSION_TOKEN,
                        onClick = { onAuthModeChange(AuthMode.SESSION_TOKEN) },
                        label = { Text("Token local") },
                        colors = HermesFilterChipColors(),
                    )
                    FilterChip(
                        selected = state.authMode == AuthMode.NATIVE_BROWSER,
                        onClick = { onAuthModeChange(AuthMode.NATIVE_BROWSER) },
                        label = { Text("Navegador") },
                        colors = HermesFilterChipColors(),
                    )
                }

                if (state.authMode == AuthMode.SESSION_TOKEN) {
                    OutlinedTextField(
                        value = state.tokenInput,
                        onValueChange = onTokenChange,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("Token de sesión") },
                        supportingText = { Text("Se guarda cifrado en Android Keystore") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    )
                } else {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.62f),
                    ) {
                        Row(
                            modifier = Modifier.padding(14.dp),
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(
                                Icons.Outlined.OpenInBrowser,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text("Sesión de navegador", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    if (state.hasSavedNativeLogin) "Sesión guardada en este dispositivo."
                                    else "Inicia sesión para conectar con PKCE.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    OutlinedButton(
                        onClick = onBrowserLogin,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = state.connectionState != ConnectionState.CONNECTING,
                    ) {
                        Icon(Icons.Outlined.OpenInBrowser, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("Reautenticar en navegador")
                    }
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.28f))
                SettingsSectionTitle(
                    "Modelo predeterminado",
                    "Se usará al crear chats nuevos. Puedes escribir un ID o elegir uno detectado.",
                )
                Box {
                    OutlinedTextField(
                        value = defaultModel,
                        onValueChange = { defaultModel = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("ID del modelo") },
                        placeholder = { Text("liquid-2.6b") },
                        trailingIcon = {
                            IconButton(onClick = { modelMenuOpen = true }) {
                                Icon(
                                    Icons.Outlined.KeyboardArrowDown,
                                    contentDescription = "Elegir modelo detectado",
                                )
                            }
                        },
                    )
                    DropdownMenu(
                        expanded = modelMenuOpen,
                        onDismissRequest = { modelMenuOpen = false },
                        modifier = Modifier.widthIn(min = 280.dp, max = 420.dp),
                    ) {
                        when {
                            state.modelsLoading && availableModels.isEmpty() -> DropdownMenuItem(
                                text = { Text("Detectando modelos…") },
                                onClick = {},
                                enabled = false,
                            )
                            availableModels.isEmpty() -> DropdownMenuItem(
                                text = { Text("No hay modelos detectados") },
                                onClick = { modelMenuOpen = false },
                                enabled = false,
                            )
                            else -> availableModels.forEach { option ->
                                DropdownMenuItem(
                                    text = {
                                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                            Text(option.displayName)
                                            Text(
                                                option.providerName,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    },
                                    onClick = {
                                        defaultModel = option.id
                                        defaultProvider = option.provider
                                        modelMenuOpen = false
                                    },
                                    enabled = option.selectable,
                                )
                            }
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        if (defaultProvider.isBlank()) "Proveedor: automático"
                        else "Proveedor: $defaultProvider",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextButton(
                        onClick = {
                            onRefreshModels()
                            onRefreshSettings()
                        },
                        enabled = !state.modelsLoading,
                    ) {
                        Icon(Icons.Outlined.Refresh, contentDescription = null)
                        Spacer(Modifier.size(6.dp))
                        Text("Actualizar")
                    }
                }

                SettingsSectionTitle(
                    "Contexto y Ollama",
                    "Estos valores corrigen el límite de 32K que aparece en tu captura.",
                )
                OutlinedTextField(
                    value = contextLengthText,
                    onValueChange = { contextLengthText = it.filter(Char::isDigit) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Contexto de Hermes · tokens") },
                    supportingText = { Text("Mínimo para herramientas: 64000") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                OutlinedTextField(
                    value = ollamaNumCtxText,
                    onValueChange = { ollamaNumCtxText = it.filter(Char::isDigit) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Contexto de Ollama · num_ctx") },
                    supportingText = { Text("Debe ser igual o menor que la memoria disponible") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.62f),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.Top,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(
                            Icons.Outlined.WarningAmber,
                            contentDescription = "Aviso técnico",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            "Después de guardar, Hermes cargará un chat nuevo con el contexto configurado. 65536 es un punto de partida seguro.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }

                SettingsSectionTitle(
                    "Ejecución",
                    "Ajustes globales del agente. Se guardan en la configuración de Hermes.",
                )
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Compresión automática", style = MaterialTheme.typography.titleMedium)
                            Text(
                                "Reduce el historial cuando se acerca al límite.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = compressionEnabled,
                            onCheckedChange = { compressionEnabled = it },
                        )
                    }
                }
                OutlinedTextField(
                    value = compressionThresholdText,
                    onValueChange = { compressionThresholdText = it.filter(Char::isDigit) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Comprimir al · porcentaje") },
                    supportingText = { Text("Entre 10 y 99; recomendado: 50") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                OutlinedTextField(
                    value = maxTurnsText,
                    onValueChange = { maxTurnsText = it.filter(Char::isDigit) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Máximo de turnos por agente") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                Text("Nivel de razonamiento", style = MaterialTheme.typography.labelLarge)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("none" to "Ninguno", "low" to "Bajo").forEach { (value, label) ->
                            FilterChip(
                                selected = reasoningEffort == value,
                                onClick = { reasoningEffort = value },
                                label = { Text(label) },
                                colors = HermesFilterChipColors(),
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("medium" to "Medio", "high" to "Alto").forEach { (value, label) ->
                            FilterChip(
                                selected = reasoningEffort == value,
                                onClick = { reasoningEffort = value },
                                label = { Text(label) },
                                colors = HermesFilterChipColors(),
                            )
                        }
                    }
                }

                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Terminal,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Hermes Studio", style = MaterialTheme.typography.labelLarge)
                            Text(
                                state.serverVersion?.let { "Versión $it" } ?: "Conexión lista",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                if (state.settingsLoading && settings == null) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Text("Leyendo configuración de Hermes…")
                    }
                }
                if (state.errorMessage != null) ErrorBanner(state.errorMessage)
                if (state.settingsErrorMessage != null) ErrorBanner(state.settingsErrorMessage)
                if (formError != null) ErrorBanner(formError!!)

                Button(
                    onClick = {
                        val contextLength = contextLengthText.toIntOrNull()
                        val ollamaNumCtx = ollamaNumCtxText.toIntOrNull()
                        val thresholdPercent = compressionThresholdText.toIntOrNull()
                        val maxTurns = maxTurnsText.toIntOrNull()
                        formError = when {
                            contextLength == null || contextLength < 64_000 ->
                                "El contexto de Hermes debe ser al menos 64000 tokens"
                            ollamaNumCtx == null || ollamaNumCtx < 64_000 ->
                                "El num_ctx de Ollama debe ser al menos 64000 tokens"
                            thresholdPercent == null || thresholdPercent !in 10..99 ->
                                "El porcentaje de compresión debe estar entre 10 y 99"
                            maxTurns == null || maxTurns <= 0 ->
                                "El máximo de turnos debe ser mayor que cero"
                            else -> null
                        }
                        if (formError == null) {
                            onSaveSettings(
                                HermesSettingsDraft(
                                    defaultModel = defaultModel.trim().takeIf { it.isNotBlank() },
                                    defaultProvider = defaultProvider.trim().takeIf { it.isNotBlank() },
                                    contextLength = contextLength!!,
                                    ollamaNumCtx = ollamaNumCtx!!,
                                    compressionEnabled = compressionEnabled,
                                    compressionThreshold = thresholdPercent!! / 100.0,
                                    maxTurns = maxTurns!!,
                                    reasoningEffort = reasoningEffort,
                                ),
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = state.connectionState != ConnectionState.CONNECTING && !state.settingsSaving,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                ) {
                    if (state.settingsSaving) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(10.dp))
                        Text("Aplicando…")
                    } else {
                        Icon(Icons.Outlined.Check, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("Guardar y aplicar")
                    }
                }
                Text(
                    "Se reconectará la app para que el siguiente chat use estos valores.",
                    modifier = Modifier.fillMaxWidth(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onForget) { Text("Olvidar conexión") }
                    TextButton(onClick = onDismiss) { Text("Cerrar") }
                }
            }
        }
    }
}

@Composable
private fun SettingsSectionTitle(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun DrawerActionRow(
    icon: ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        color = if (selected) MaterialTheme.colorScheme.surface else Color.Transparent,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                icon,
                contentDescription = null,
                modifier = Modifier.size(21.dp),
                tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            )
        }
    }
}

@Composable
private fun ConversationRow(
    session: SessionSummary,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        color = if (selected) MaterialTheme.colorScheme.surface.copy(alpha = 0.78f) else Color.Transparent,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                session.title.ifBlank { "Conversación sin título" },
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (session.preview.isNotBlank()) {
                Text(
                    session.preview,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun DrawerEmptyState(hasSearch: Boolean, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            if (hasSearch) Icons.Outlined.Search else Icons.Outlined.Terminal,
            contentDescription = null,
            modifier = Modifier.size(26.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            if (hasSearch) "No hay coincidencias" else "Aún no hay conversaciones",
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            if (hasSearch) "Prueba con otro término." else "Tus chats aparecerán aquí.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ChatScreen(
    state: HermesUiState,
    onOpenDrawer: () -> Unit,
    onDisconnect: () -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onApprovalChoice: (String) -> Unit,
    onClarifyAnswer: (String) -> Unit,
    onSelectModel: (HermesModelOption) -> Unit,
    onRefreshModels: () -> Unit,
) {
    var draft by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    val hasTranscript = state.messages.isNotEmpty() ||
        state.streamingText.isNotBlank() ||
        state.reasoningText.isNotBlank() ||
        state.isBusy ||
        state.toolStatus != null ||
        state.activities.isNotEmpty() ||
        state.agentStatus != null ||
        state.approvalRequest != null ||
        state.clarifyRequest != null ||
        state.errorMessage != null
    val visibleCount = state.messages.size +
        if (state.streamingText.isNotBlank() || state.isBusy || state.activities.isNotEmpty()) 1 else 0

    LaunchedEffect(
        visibleCount,
        state.streamingText,
        state.reasoningText,
        state.toolStatus,
        state.activities.size,
        state.agentStatus,
        state.approvalRequest,
        state.clarifyRequest,
    ) {
        if (visibleCount > 0) listState.animateScrollToItem(visibleCount - 1)
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            ChatTopBar(
                state = state,
                onOpenDrawer = onOpenDrawer,
                onDisconnect = onDisconnect,
                onStop = onStop,
                onSelectModel = onSelectModel,
                onRefreshModels = onRefreshModels,
            )
        },
        bottomBar = {
            Composer(
                draft = draft,
                onDraftChange = { draft = it },
                enabled = !state.isBusy,
                onSend = {
                    if (draft.isNotBlank()) {
                        onSend(draft)
                        draft = ""
                    }
                },
                onStop = onStop,
            )
        },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            if (!hasTranscript) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        "¿Qué tienes en mente hoy?",
                        modifier = Modifier.padding(horizontal = 26.dp),
                        style = MaterialTheme.typography.headlineSmall.copy(
                            fontSize = 28.sp,
                            lineHeight = 34.sp,
                            fontWeight = FontWeight.Normal,
                        ),
                        textAlign = TextAlign.Center,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    state = listState,
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (state.errorMessage != null) {
                        item(key = "error") {
                            ErrorBanner(state.errorMessage)
                        }
                    }
                    items(state.messages, key = { it.id }) { message -> MessageBubble(message) }
                    if (state.streamingText.isBlank() &&
                        (state.isBusy || state.reasoningText.isNotBlank() || state.toolStatus != null ||
                            state.activities.isNotEmpty() || state.agentStatus != null ||
                            state.browserProgress != null ||
                            state.approvalRequest != null || state.clarifyRequest != null)
                    ) {
                        item(key = "activity") {
                            ActivityCard(
                                reasoningText = state.reasoningText,
                                toolStatus = state.toolStatus,
                                startedAtMs = state.thinkingStartedAtMs,
                                activities = state.activities,
                                agentStatus = state.agentStatus,
                                browserProgress = state.browserProgress,
                                approvalRequest = state.approvalRequest,
                                clarifyRequest = state.clarifyRequest,
                                onApprovalChoice = onApprovalChoice,
                                onClarifyAnswer = onClarifyAnswer,
                                busy = state.isBusy,
                            )
                        }
                    } else if (state.streamingText.isNotBlank()) {
                        item(key = "streaming") {
                            MessageBubble(
                                ChatMessage("streaming", "assistant", state.streamingText),
                                streaming = true,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatTopBar(
    state: HermesUiState,
    onOpenDrawer: () -> Unit,
    onDisconnect: () -> Unit,
    onStop: () -> Unit,
    onSelectModel: (HermesModelOption) -> Unit,
    onRefreshModels: () -> Unit,
) {
    var modelMenuOpen by rememberSaveable { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 4.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onOpenDrawer) {
            Column(
                modifier = Modifier.size(24.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
                horizontalAlignment = Alignment.Start,
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(2.dp)
                        .background(MaterialTheme.colorScheme.onBackground, RoundedCornerShape(2.dp)),
                )
                Box(
                    Modifier
                        .fillMaxWidth(0.68f)
                        .height(2.dp)
                        .background(MaterialTheme.colorScheme.onBackground, RoundedCornerShape(2.dp)),
                )
            }
        }
        ModelPicker(
            state = state,
            modifier = Modifier
                .weight(1f)
                .padding(start = 6.dp),
            expanded = modelMenuOpen,
            onExpandedChange = { modelMenuOpen = it },
            onSelectModel = { option ->
                onSelectModel(option)
                modelMenuOpen = false
            },
            onRefreshModels = onRefreshModels,
        )
        IconButton(onClick = if (state.isBusy) onStop else onDisconnect) {
            Icon(
                if (state.isBusy) Icons.Outlined.Stop else Icons.Outlined.PowerSettingsNew,
                contentDescription = if (state.isBusy) "Detener generación" else "Desconectar",
                tint = if (state.isBusy) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ModelPicker(
    state: HermesUiState,
    modifier: Modifier,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onSelectModel: (HermesModelOption) -> Unit,
    onRefreshModels: () -> Unit,
) {
    val activeOption = state.modelOptions.firstOrNull {
        it.id == state.activeModel && it.provider == state.activeProvider
    }
    val label = activeOption?.displayName
        ?: state.activeModel?.takeIf { it.isNotBlank() }?.let {
            ModelNameFormatter.displayName(it, state.activeProvider.orEmpty())
        }
        ?: when {
            state.modelsLoading -> "Detectando modelos..."
            state.modelOptions.isNotEmpty() -> "Selecciona modelo"
            else -> "Nuevo chat"
        }
    val scrollState = rememberScrollState()
    LaunchedEffect(expanded, state.modelOptions.size) {
        if (expanded) scrollState.scrollTo(0)
    }

    Box(
        modifier = modifier,
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onExpandedChange(!expanded) },
            shape = RoundedCornerShape(12.dp),
            color = if (expanded) MaterialTheme.colorScheme.surface else Color.Transparent,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    label,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(
                    Icons.Outlined.KeyboardArrowDown,
                    contentDescription = "Elegir modelo",
                    modifier = Modifier.size(20.dp),
                    tint = if (expanded) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { onExpandedChange(false) },
            modifier = Modifier
                .widthIn(min = 280.dp, max = 360.dp)
                .background(MaterialTheme.colorScheme.surface),
        ) {
            Column(Modifier.padding(vertical = 6.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 14.dp, end = 8.dp, top = 3.dp, bottom = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Modelos disponibles",
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            if (state.modelOptions.isEmpty()) "Catalogo Hermes" else "Detectados por Hermes",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(
                        onClick = onRefreshModels,
                        enabled = !state.modelsLoading,
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Refresh,
                            contentDescription = "Actualizar modelos",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                if (state.modelsLoading) {
                    LinearProgressIndicator(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp),
                    )
                }

                if (state.modelErrorMessage != null) {
                    Text(
                        state.modelErrorMessage,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }

                if (state.modelOptions.isEmpty()) {
                    Text(
                        if (state.modelsLoading) "Buscando proveedores configurados..."
                        else "No se detectaron modelos configurados.",
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 14.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Column(
                        modifier = Modifier
                            .heightIn(max = 360.dp)
                            .verticalScroll(scrollState)
                            .padding(horizontal = 6.dp),
                    ) {
                        state.modelOptions
                            .groupBy { it.provider }
                            .forEach { (_, providerOptions) ->
                                val providerName = providerOptions.firstOrNull()?.providerName.orEmpty()
                                Text(
                                    providerName,
                                    modifier = Modifier.padding(start = 8.dp, top = 10.dp, bottom = 4.dp),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                providerOptions.forEach { option ->
                                    ModelPickerRow(
                                        option = option,
                                        selected = state.activeModel == option.id &&
                                            state.activeProvider == option.provider,
                                        onClick = { onSelectModel(option) },
                                    )
                                }
                            }
                    }
                }

                HorizontalDivider(
                    modifier = Modifier.padding(top = 6.dp),
                    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.55f),
                )
                TextButton(
                    onClick = onRefreshModels,
                    enabled = !state.modelsLoading,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.size(8.dp))
                    Text("Actualizar modelos")
                }
            }
        }
    }
}

@Composable
private fun ModelPickerRow(
    option: HermesModelOption,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = option.selectable, onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.13f)
        else Color.Transparent,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    option.displayName,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (option.selectable) MaterialTheme.colorScheme.onSurface
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!option.warning.isNullOrBlank() && !option.selectable) {
                    Text(
                        option.warning,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (selected) {
                Icon(
                    Icons.Outlined.Check,
                    contentDescription = "Modelo activo",
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

@Composable
private fun Composer(
    draft: String,
    onDraftChange: (String) -> Unit,
    enabled: Boolean,
    onSend: () -> Unit,
    onStop: () -> Unit,
) {
    val canSend = enabled && draft.isNotBlank()
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .imePadding()
            .navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.78f)),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 42.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = draft,
                    onValueChange = onDraftChange,
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp),
                    enabled = enabled,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    maxLines = 5,
                    decorationBox = { innerTextField ->
                        Box(Modifier.fillMaxWidth()) {
                            if (draft.isBlank()) {
                                Text(
                                    "Pregúntale a Hermes",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            innerTextField()
                        }
                    },
                )
                IconButton(
                    onClick = if (enabled) onSend else onStop,
                    enabled = if (enabled) canSend else true,
                    modifier = Modifier.size(42.dp),
                ) {
                    Surface(
                        modifier = Modifier.size(40.dp),
                        shape = CircleShape,
                        color = if (canSend) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                if (enabled) Icons.AutoMirrored.Outlined.Send else Icons.Outlined.Stop,
                                contentDescription = if (enabled) "Enviar mensaje" else "Detener generación",
                                tint = if (canSend) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(19.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage, streaming: Boolean = false) {
    val isUser = message.role == "user"
    var thinkingExpanded by rememberSaveable(message.id) { mutableStateOf(false) }
    var activitiesExpanded by rememberSaveable("${message.id}-activities") { mutableStateOf(false) }
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            if (isUser) "Tú" else "Hermes",
            modifier = Modifier.padding(horizontal = 4.dp),
            style = MaterialTheme.typography.labelLarge,
            color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Medium,
        )
        Surface(
            modifier = Modifier.fillMaxWidth(if (isUser) 0.84f else 0.96f),
            shape = RoundedCornerShape(
                topStart = 18.dp,
                topEnd = 18.dp,
                bottomStart = if (isUser) 18.dp else 5.dp,
                bottomEnd = if (isUser) 5.dp else 18.dp,
            ),
            color = if (isUser) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.82f)
            },
            border = if (isUser) {
                null
            } else {
                BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
            },
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 15.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!isUser && message.activities.isNotEmpty()) {
                    AgentActivitySummary(
                        activities = message.activities,
                        expanded = activitiesExpanded,
                        onToggle = { activitiesExpanded = !activitiesExpanded },
                    )
                    if (activitiesExpanded) {
                        AgentActivityDetails(message.activities, showOutput = true)
                    }
                    if (message.reasoning.isNotBlank()) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
                    }
                }
                if (!isUser && message.reasoning.isNotBlank()) {
                    ThinkingSummary(
                        reasoning = message.reasoning,
                        durationMs = message.thinkingDurationMs,
                        expanded = thinkingExpanded,
                        onToggle = { thinkingExpanded = !thinkingExpanded },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
                }
                if (isUser) {
                    Text(
                        message.content,
                        style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 25.sp),
                    )
                } else {
                    HermesMarkdown(message.content)
                }
                if (streaming) {
                    Text(
                        "▌",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
        }
    }
}

@Composable
private fun ActivityCard(
    reasoningText: String,
    toolStatus: String?,
    startedAtMs: Long?,
    activities: List<AgentActivity>,
    agentStatus: String?,
    browserProgress: HermesBrowserProgress? = null,
    approvalRequest: HermesApprovalRequest?,
    clarifyRequest: HermesClarifyRequest?,
    onApprovalChoice: (String) -> Unit,
    onClarifyAnswer: (String) -> Unit,
    busy: Boolean,
) {
    val hasReasoning = reasoningText.isNotBlank()
    val status = toolStatus?.trim().orEmpty()
    val isToolActivity = status.isNotBlank() && status != "Hermes está pensando…"
    val title = when {
        approvalRequest != null -> "Necesita tu confirmación"
        clarifyRequest != null -> "Hermes necesita una respuesta"
        activities.isNotEmpty() -> "Hermes está trabajando"
        hasReasoning -> "Pensando"
        isToolActivity -> "Actividad en curso"
        else -> "Hermes está pensando"
    }
    var nowMs by remember(startedAtMs) { mutableStateOf(System.currentTimeMillis()) }

    LaunchedEffect(startedAtMs) {
        if (startedAtMs == null) return@LaunchedEffect
        while (true) {
            nowMs = System.currentTimeMillis()
            delay(1000)
        }
    }

    val elapsedMs = startedAtMs?.let { (nowMs - it).coerceAtLeast(0L) }

    Surface(
        modifier = Modifier.fillMaxWidth(0.94f),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.88f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.42f)),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (busy || activities.any { it.status == AgentActivityStatus.RUNNING }) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                } else {
                    Icon(
                        Icons.Outlined.Check,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        title,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Medium,
                    )
                    if (agentStatus != null) {
                        Text(
                            agentStatus,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    } else if (isToolActivity) {
                        Text(
                            activityLabel(status, present = true),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    } else {
                        Text(
                            if (elapsedMs != null) {
                                "Lleva ${formatThinkingDuration(elapsedMs)}"
                            } else {
                                "Preparando una respuesta…"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (activities.isNotEmpty()) {
                AgentActivityDetails(activities, showOutput = false)
            }
            browserProgress?.errorMessage?.takeIf { it.isNotBlank() }?.let { error ->
                Text(
                    "Browser: ${browserProgress.errorCode ?: "error"} — $error",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            if (!browserProgress?.sources.isNullOrEmpty()) {
                Text(
                    "Fuentes",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                browserProgress.sources.take(8).forEach { source ->
                    Text(
                        source.title.ifBlank { source.url },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (hasReasoning) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.28f))
                Column(
                    modifier = Modifier
                        .heightIn(max = 180.dp)
                        .verticalScroll(rememberScrollState()),
                )
                {
                    HermesMarkdown(reasoningText.trim(), compact = true)
                }
            }
            approvalRequest?.let { request ->
                ApprovalCard(request = request, onChoice = onApprovalChoice)
            }
            clarifyRequest?.let { request ->
                ClarifyCard(request = request, onAnswer = onClarifyAnswer)
            }
        }
    }
}

@Composable
private fun AgentActivitySummary(
    activities: List<AgentActivity>,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable(onClick = onToggle),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Icon(
            Icons.Outlined.Terminal,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            activitySummarySentence(activities),
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = if (expanded) 2 else 1,
            overflow = TextOverflow.Ellipsis,
        )
        Icon(
            if (expanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
            contentDescription = if (expanded) "Ocultar actividad" else "Mostrar actividad",
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun AgentActivityDetails(activities: List<AgentActivity>, showOutput: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 2.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        activities.forEach { activity ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                when (activity.status) {
                    AgentActivityStatus.RUNNING -> CircularProgressIndicator(
                        modifier = Modifier
                            .padding(top = 2.dp)
                            .size(14.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    AgentActivityStatus.COMPLETE -> Icon(
                        Icons.Outlined.Check,
                        contentDescription = "Completado",
                        modifier = Modifier
                            .padding(top = 1.dp)
                            .size(16.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    AgentActivityStatus.FAILED -> Icon(
                        Icons.Outlined.WarningAmber,
                        contentDescription = "Falló",
                        modifier = Modifier
                            .padding(top = 1.dp)
                            .size(16.dp),
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        activityLabel(activity.name, present = activity.status == AgentActivityStatus.RUNNING),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    activity.context.takeIf { it.isNotBlank() }?.let { context ->
                        Text(
                            context,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    activity.summary?.takeIf { it.isNotBlank() }?.let { summary ->
                        Text(
                            summary,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    activity.durationMs?.let { duration ->
                        Text(
                            formatThinkingDuration(duration),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (activity.todos.isNotEmpty()) {
                        TodoPreview(activity.todos)
                    }
                    if (showOutput) {
                        val details = activity.inlineDiff ?: activity.resultText ?: activity.argsText
                        details?.takeIf { it.isNotBlank() }?.let { text ->
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 140.dp),
                                shape = RoundedCornerShape(9.dp),
                                color = MaterialTheme.colorScheme.background.copy(alpha = 0.58f),
                            ) {
                                Text(
                                    text,
                                    modifier = Modifier
                                        .padding(9.dp)
                                        .verticalScroll(rememberScrollState()),
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 12,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TodoPreview(todos: List<com.hijosdelsol.hermesmobile.model.AgentTodo>) {
    Column(
        modifier = Modifier.padding(top = 3.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        todos.take(4).forEach { todo ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    if (todo.status.equals("completed", ignoreCase = true)) Icons.Outlined.Check else Icons.Outlined.Terminal,
                    contentDescription = null,
                    modifier = Modifier.size(13.dp),
                    tint = if (todo.status.equals("completed", ignoreCase = true)) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
                Text(
                    todo.content,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun ApprovalCard(request: HermesApprovalRequest, onChoice: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Text(
            request.description,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        request.command.takeIf { it.isNotBlank() }?.let { command ->
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(9.dp),
                color = MaterialTheme.colorScheme.background.copy(alpha = 0.62f),
            ) {
                Text(
                    command,
                    modifier = Modifier.padding(10.dp),
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (request.smartDenied) {
            Text(
                "Hermes marcó esta acción como sensible. Revísala antes de permitirla.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            request.choices.forEach { choice ->
                OutlinedButton(
                    onClick = { onChoice(choice) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp),
                ) {
                    Text(approvalChoiceLabel(choice))
                }
            }
        }
    }
}

@Composable
private fun ClarifyCard(request: HermesClarifyRequest, onAnswer: (String) -> Unit) {
    var draft by rememberSaveable(request.requestId) { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Text(
            request.question,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        request.choices.forEach { choice ->
            OutlinedButton(
                onClick = { onAnswer(choice) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 44.dp),
            ) {
                Text(choice)
            }
        }
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Tu respuesta") },
            singleLine = false,
            maxLines = 3,
        )
        Button(
            onClick = { onAnswer(draft.trim()) },
            enabled = draft.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 44.dp),
        ) {
            Text("Continuar")
        }
    }
}

private fun approvalChoiceLabel(choice: String): String = when (choice.lowercase()) {
    "once", "allow_once" -> "Permitir una vez"
    "session", "allow_session" -> "Permitir en esta sesión"
    "always", "permanent", "allow_always" -> "Permitir siempre"
    "deny", "reject" -> "Denegar"
    else -> choice.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

private fun activitySummarySentence(activities: List<AgentActivity>): String {
    val labels = activities
        .filter { it.status != AgentActivityStatus.RUNNING }
        .map { activityLabel(it.name, present = false) }
        .distinct()
    if (labels.isEmpty()) return "Hermes está trabajando en la tarea"
    val joined = when (labels.size) {
        1 -> labels.first()
        2 -> "${labels[0]} y ${labels[1]}"
        else -> labels.dropLast(1).joinToString(", ") + " y ${labels.last()}"
    }
    return "Se $joined"
}

private fun activityLabel(name: String, present: Boolean): String {
    return when (name.lowercase().replace('-', '_')) {
        "terminal", "shell_command", "run_command", "exec", "process" ->
            if (present) "Ejecutando comandos" else "ejecutó comandos"
        "edit_file", "apply_patch", "write_file", "file_edit", "patch_file" ->
            if (present) "Editando un archivo" else "editó un archivo"
        "web_search", "search_web" ->
            if (present) "Buscando en la web" else "buscó en la web"
        "web_extract", "web_open", "open_url" ->
            if (present) "Leyendo páginas web" else "leyó páginas web"
        "browser", "browser_open", "browser_click", "browser_navigate" ->
            if (present) "Usando el navegador" else "usó el navegador"
        "read_file", "list_files", "search_files", "grep", "rg" ->
            if (present) "Leyendo archivos" else "leyó archivos"
        "delegate_task", "spawn_agent" ->
            if (present) "Delegando una tarea" else "delegó una tarea"
        "todo" ->
            if (present) "Actualizando tareas" else "actualizó las tareas"
        "python", "execute_code" ->
            if (present) "Ejecutando código" else "ejecutó código"
        else -> {
            val pretty = name.replace('_', ' ').replace('-', ' ')
                .replace(Regex("\\s+"), " ").trim()
            if (present) "Ejecutando $pretty" else "ejecutó $pretty"
        }
    }
}

@Composable
private fun ThinkingSummary(
    reasoning: String,
    durationMs: Long?,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle)
                .padding(vertical = 1.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Icon(
                Icons.Outlined.Terminal,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Text(
                if (durationMs != null) {
                    "Pensó durante ${formatThinkingDuration(durationMs)}"
                } else {
                    "Pensamiento"
                },
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Medium,
            )
            Icon(
                if (expanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
                contentDescription = if (expanded) "Ocultar pensamiento" else "Mostrar pensamiento",
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) {
            if (reasoning.isBlank()) {
                Text(
                    "Hermes no compartió el detalle del pensamiento para esta respuesta.",
                    modifier = Modifier.padding(top = 10.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Column(
                    modifier = Modifier
                        .heightIn(max = 280.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(top = 10.dp),
                ) {
                    HermesMarkdown(reasoning, compact = true)
                }
            }
        }
    }
}

private enum class MarkdownBlockType {
    PARAGRAPH,
    HEADING,
    UNORDERED_LIST,
    ORDERED_LIST,
    QUOTE,
    CODE,
    DIVIDER,
}

private data class MarkdownBlock(
    val type: MarkdownBlockType,
    val text: String = "",
    val items: List<String> = emptyList(),
    val level: Int = 0,
)

private fun parseHermesMarkdown(source: String): List<MarkdownBlock> {
    val lines = source.replace("\r\n", "\n").replace('\r', '\n').lines()
    val blocks = mutableListOf<MarkdownBlock>()
    val paragraphLines = mutableListOf<String>()
    val headingRegex = Regex("""^(#{1,6})\s+(.+?)(?:\s+#+)?$""")
    val listRegex = Regex("""^([-*+]|\d+[.)])\s+(.+)$""")

    fun flushParagraph() {
        if (paragraphLines.isNotEmpty()) {
            blocks += MarkdownBlock(
                type = MarkdownBlockType.PARAGRAPH,
                text = paragraphLines.joinToString("\n").trim(),
            )
            paragraphLines.clear()
        }
    }

    var index = 0
    while (index < lines.size) {
        val trimmed = lines[index].trim()
        if (trimmed.isBlank()) {
            flushParagraph()
            index++
            continue
        }

        if (trimmed.startsWith("```")) {
            flushParagraph()
            index++
            val codeLines = mutableListOf<String>()
            while (index < lines.size && !lines[index].trim().startsWith("```")) {
                codeLines += lines[index]
                index++
            }
            if (index < lines.size) index++
            blocks += MarkdownBlock(MarkdownBlockType.CODE, codeLines.joinToString("\n"))
            continue
        }

        val heading = headingRegex.matchEntire(trimmed)
        if (heading != null) {
            flushParagraph()
            blocks += MarkdownBlock(
                type = MarkdownBlockType.HEADING,
                text = heading.groupValues[2].trim(),
                level = heading.groupValues[1].length,
            )
            index++
            continue
        }

        val dividerCharacters = trimmed.filterNot { it.isWhitespace() }
        if (dividerCharacters.length >= 3 && dividerCharacters.all { it == dividerCharacters.first() } &&
            dividerCharacters.first() in "-*_") {
            flushParagraph()
            blocks += MarkdownBlock(MarkdownBlockType.DIVIDER)
            index++
            continue
        }

        if (trimmed.startsWith(">")) {
            flushParagraph()
            val quoteLines = mutableListOf<String>()
            while (index < lines.size && lines[index].trim().startsWith(">")) {
                quoteLines += lines[index].trim().removePrefix(">").trimStart()
                index++
            }
            blocks += MarkdownBlock(MarkdownBlockType.QUOTE, quoteLines.joinToString("\n"))
            continue
        }

        val firstListItem = listRegex.matchEntire(trimmed)
        if (firstListItem != null) {
            flushParagraph()
            val ordered = firstListItem.groupValues[1].first().isDigit()
            val items = mutableListOf<String>()
            while (index < lines.size) {
                val currentLine = lines[index].trim()
                if (currentLine.isBlank()) {
                    val nextLine = lines.getOrNull(index + 1)?.trim().orEmpty()
                    val nextItem = listRegex.matchEntire(nextLine)
                    if (nextItem != null && nextItem.groupValues[1].first().isDigit() == ordered) {
                        index++
                        continue
                    }
                    break
                }
                val item = listRegex.matchEntire(currentLine) ?: break
                if (item.groupValues[1].first().isDigit() != ordered) break
                items += item.groupValues[2].trim()
                index++
            }
            blocks += MarkdownBlock(
                type = if (ordered) MarkdownBlockType.ORDERED_LIST else MarkdownBlockType.UNORDERED_LIST,
                items = items,
            )
            continue
        }

        paragraphLines += lines[index]
        index++
    }
    flushParagraph()
    return blocks
}

@Composable
private fun HermesMarkdown(
    source: String,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val blocks = remember(source) { parseHermesMarkdown(source) }
    val bodyColor = MaterialTheme.colorScheme.onSurface
    val mutedColor = MaterialTheme.colorScheme.onSurfaceVariant
    val codeBackground = MaterialTheme.colorScheme.background.copy(alpha = 0.46f)
    val spacing = if (compact) 7.dp else 11.dp

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(spacing)) {
        blocks.forEach { block ->
            when (block.type) {
                MarkdownBlockType.PARAGRAPH -> Text(
                    text = renderInlineMarkdown(block.text, bodyColor, codeBackground, MaterialTheme.colorScheme.primary),
                    style = (if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyLarge)
                        .copy(lineHeight = if (compact) 20.sp else 27.sp),
                )
                MarkdownBlockType.HEADING -> {
                    val style = when (block.level) {
                        1 -> MaterialTheme.typography.titleLarge
                        2 -> MaterialTheme.typography.titleMedium
                        else -> MaterialTheme.typography.titleSmall
                    }
                    Text(
                        text = renderInlineMarkdown(block.text, bodyColor, codeBackground, MaterialTheme.colorScheme.primary),
                        style = style.copy(
                            lineHeight = if (block.level <= 2) 28.sp else 23.sp,
                            fontWeight = FontWeight.SemiBold,
                        ),
                    )
                }
                MarkdownBlockType.UNORDERED_LIST,
                MarkdownBlockType.ORDERED_LIST -> Column(
                    verticalArrangement = Arrangement.spacedBy(if (compact) 5.dp else 8.dp),
                ) {
                    block.items.forEachIndexed { itemIndex, item ->
                        Row(
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                if (block.type == MarkdownBlockType.ORDERED_LIST) "${itemIndex + 1}." else "•",
                                style = if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = renderInlineMarkdown(item, bodyColor, codeBackground, MaterialTheme.colorScheme.primary),
                                modifier = Modifier.weight(1f),
                                style = (if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyLarge)
                                    .copy(lineHeight = if (compact) 20.sp else 25.sp),
                            )
                        }
                    }
                }
                MarkdownBlockType.QUOTE -> Surface(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.52f),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text(
                        text = renderInlineMarkdown(block.text, mutedColor, codeBackground, MaterialTheme.colorScheme.primary),
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        style = (if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyLarge)
                            .copy(fontStyle = FontStyle.Italic, lineHeight = if (compact) 20.sp else 25.sp),
                    )
                }
                MarkdownBlockType.CODE -> Surface(
                    color = MaterialTheme.colorScheme.background.copy(alpha = 0.72f),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text(
                        block.text,
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace,
                            lineHeight = 19.sp,
                        ),
                        color = mutedColor,
                    )
                }
                MarkdownBlockType.DIVIDER -> HorizontalDivider(
                    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.28f),
                )
            }
        }
    }
}

private fun renderInlineMarkdown(
    source: String,
    baseColor: Color,
    codeBackground: Color,
    linkColor: Color,
): AnnotatedString = buildAnnotatedString {
    var index = 0
    while (index < source.length) {
        if (source[index] == '\\' && index + 1 < source.length) {
            append(source[index + 1])
            index += 2
            continue
        }

        if (source[index] == '`') {
            val end = source.indexOf('`', index + 1)
            if (end > index + 1) {
                withStyle(
                    SpanStyle(
                        fontFamily = FontFamily.Monospace,
                        background = codeBackground,
                        color = baseColor,
                    ),
                ) {
                    append(source.substring(index + 1, end))
                }
                index = end + 1
                continue
            }
        }

        if (source[index] == '[') {
            val labelEnd = source.indexOf(']', index + 1)
            if (labelEnd > index + 1 && source.startsWith("](", labelEnd)) {
                val urlEnd = source.indexOf(')', labelEnd + 2)
                if (urlEnd > labelEnd + 2) {
                    withStyle(
                        SpanStyle(
                            color = linkColor,
                            textDecoration = TextDecoration.Underline,
                        ),
                    ) {
                        append(source.substring(index + 1, labelEnd))
                    }
                    index = urlEnd + 1
                    continue
                }
            }
        }

        val marker = when {
            source.startsWith("**", index) -> "**"
            source.startsWith("__", index) -> "__"
            source.startsWith("~~", index) -> "~~"
            source[index] == '*' || source[index] == '_' -> source[index].toString()
            else -> null
        }
        if (marker != null) {
            val end = source.indexOf(marker, index + marker.length)
            if (end > index + marker.length && source.substring(index + marker.length, end).isNotBlank()) {
                val inner = source.substring(index + marker.length, end)
                val style = when (marker) {
                    "~~" -> SpanStyle(textDecoration = TextDecoration.LineThrough)
                    "**", "__" -> SpanStyle(fontWeight = FontWeight.Bold)
                    else -> SpanStyle(fontStyle = FontStyle.Italic)
                }
                withStyle(style) {
                    append(renderInlineMarkdown(inner, baseColor, codeBackground, linkColor))
                }
                index = end + marker.length
                continue
            }
        }

        append(source[index])
        index++
    }
}

private fun formatThinkingDuration(durationMs: Long): String {
    val totalSeconds = durationMs / 1000L
    if (totalSeconds < 1L) return "menos de 1 s"
    return if (totalSeconds < 60L) {
        "$totalSeconds s"
    } else {
        "${totalSeconds / 60L} min ${totalSeconds % 60L} s"
    }
}

@Composable
private fun ErrorBanner(message: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.error.copy(alpha = 0.16f)),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.45f)),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = "Error", tint = HermesWarning)
            Text(message, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
