# Hermes Pocket

Android companion for a Hermes Agent dashboard/gateway.

## MVP surface

- Connect to a Hermes dashboard URL.
- Authenticate with a loopback session token or Hermes native OAuth/PKCE in the system browser.
- Store connection secrets with Android Keystore-backed AES/GCM encryption.
- List saved sessions, resume a session, create a chat, and stream assistant output through `/api/ws`.
- Present detected models with stable human-readable names. The exact provider/Ollama
  identifier remains stored separately as `id` and is the only value sent to the
  gateway; aliases such as `:latest` and transport prefixes such as `hf.co/` do
  not leak into the primary label.

## Run

Open `apps/hermes-android/` in Android Studio and run `app`.

From a machine with Gradle available:

```powershell
gradle -p apps/hermes-android :app:assembleDebug
```

APK output: `apps/hermes-android/app/build/outputs/apk/debug/app-debug.apk`.

## Connection notes

- Android emulator → Hermes running on the host: use `http://10.0.2.2:9119`.
- Physical phone → use the host LAN address, for example `http://192.168.1.20:9119`, and allow the dashboard through the firewall.
- HTTPS/WSS is recommended outside a trusted LAN.
- Current Hermes non-loopback builds use the native browser login flow. The app does not embed credentials in a WebView.
- Hermes is a Browser Real **client**. It never launches Chromium. Browser progress,
  sources, failures, and cancel (Stop) come from gateway `browser.progress` /
  `browser.error` events.

Hermes protocol references used by this client:

- REST: `/api/status`, `/api/sessions`, `/api/sessions/:id/messages`, `/api/auth/ws-ticket`.
- Gateway WebSocket: `/api/ws` with JSON-RPC `session.create`, `session.resume`, `prompt.submit`, and `session.interrupt`.
