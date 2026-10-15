package com.hijosdelsol.hermesmobile.net

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object HermesEndpoint {
    fun base(raw: String): HttpUrl {
        val value = raw.trim().let { candidate ->
            if (candidate.contains("://")) candidate else "http://$candidate"
        }.trimEnd('/')

        val parsed = value.toHttpUrlOrNull()
            ?: throw IllegalArgumentException("URL inválida. Usa http://host:9119")

        require(parsed.scheme == "http" || parsed.scheme == "https") {
            "Hermes usa HTTP o HTTPS"
        }

        return parsed.newBuilder()
            .fragment(null)
            .query(null)
            .build()
    }

    fun api(raw: String, path: String, query: Map<String, String> = emptyMap()): HttpUrl {
        val builder = base(raw).newBuilder()
        builder.addPathSegments(path.trim('/'))
        query.forEach { (key, value) -> builder.addQueryParameter(key, value) }
        return builder.build()
    }

    fun websocket(raw: String, authName: String, authValue: String): HttpUrl {
        val base = base(raw)
        return base.newBuilder()
            .addPathSegments("api/ws")
            .addQueryParameter(authName, authValue)
            .build()
    }
}
