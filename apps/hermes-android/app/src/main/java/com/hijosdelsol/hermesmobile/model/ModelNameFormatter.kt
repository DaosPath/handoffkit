package com.hijosdelsol.hermesmobile.model

import java.util.Locale

/**
 * Converts provider/Ollama identifiers into stable UI labels.
 *
 * The technical identifier is never changed; it remains the value sent to the
 * gateway. This formatter only controls presentation and deliberately omits
 * transient `:latest` tags and transport prefixes such as `hf.co/`.
 */
object ModelNameFormatter {
    fun displayName(id: String, provider: String = "", suppliedName: String? = null): String {
        val technicalId = id.trim()
        if (technicalId.isBlank()) return "Modelo sin nombre"

        suppliedName
            ?.trim()
            ?.takeIf { it.isNotBlank() && isHumanLabel(it, technicalId) }
            ?.let { return polish(it) }

        val lastSegment = technicalId.substringAfterLast('/').trim()
        val namespace = technicalId
            .substringBeforeLast('/', "")
            .substringAfterLast('/')
            .trim()
            .lowercase(Locale.ROOT)
        val base = lastSegment.substringBefore(':').trim()
            .removeSuffix("-GGUF")
            .removeSuffix("-gguf")
            .removeSuffix("_GGUF")
            .removeSuffix("_gguf")
        val tag = lastSegment.substringAfter(':', "")
            .takeIf { it.isNotBlank() && !it.equals("latest", ignoreCase = true) }

        val model = polishModelBase(base)
        val source = when (namespace) {
            "liquidai" -> "Liquid AI"
            "liquid-ai" -> "Liquid AI"
            else -> ""
        }
        val prefix = if (source.isNotBlank() && !model.startsWith(source)) "$source · " else ""
        val variant = tag?.let { " · ${polishVariant(it)}" }.orEmpty()
        return (prefix + model + variant).ifBlank { polish(technicalId) }
    }

    private fun isHumanLabel(candidate: String, technicalId: String): Boolean {
        if (candidate.equals(technicalId, ignoreCase = true)) return false
        if (candidate.contains("/")) return false
        if (candidate.contains("hf.co", ignoreCase = true)) return false
        return candidate.none { it == ':' }
    }

    private fun polishModelBase(raw: String): String {
        var value = raw.trim()
            .replace(Regex("(?i)^huihui[-_ ]"), "")
            .replace(Regex("(?i)^liquid[-_ ]?2\\.6b$"), "Liquid LFM2 2.6B")
            .replace(Regex("(?i)qwen35"), "Qwen 3.5")
            .replace(Regex("(?i)qwen3\\.5"), "Qwen 3.5")
            .replace(Regex("(?i)lfm2\\.5"), "LFM2.5")
            .replace(Regex("(?i)lfm2"), "LFM2")
            .replace(Regex("(?i)translategemma"), "TranslateGemma")
            .replace(Regex("(?i)gemma"), "Gemma")
            .replace(Regex("(?i)v(\\d+)[._](\\d+)"), "v$1.$2")
            .replace('_', ' ')
            .replace(Regex("[-]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        return polish(value)
    }

    private fun polishVariant(raw: String): String {
        val quantization = raw.trim().replace('-', '_')
        if (quantization.matches(Regex("(?i)q\\d+(?:_[a-z]){2,}"))) {
            return quantization.uppercase(Locale.ROOT)
        }
        val value = raw
            .replace(Regex("(?i)v(\\d+)[._](\\d+)"), "v$1.$2")
            .replace('_', ' ')
            .replace('-', ' ')
            .replace(Regex("\\s+"), " ")
            .trim()
        return value.split(' ')
            .filter { it.isNotBlank() }
            .joinToString(" ") { token ->
                when {
                    token.matches(Regex("(?i)q\\d+[a-z]*")) -> token.uppercase(Locale.ROOT)
                    token.matches(Regex("(?i)v\\d+(?:[._]\\d+)*")) -> "v" + token.drop(1).replace('_', '.')
                    else -> polish(token)
                }
            }
    }

    private fun polish(raw: String): String {
        val tokens = raw.replace('_', ' ').replace('-', ' ').split(Regex("\\s+"))
        return tokens
            .filter { it.isNotBlank() }
            .joinToString(" ") { token ->
                when {
                    token.equals("lfm2", ignoreCase = true) -> "LFM2"
                    token.matches(Regex("(?i)lfm2\\.\\d+")) -> token.uppercase(Locale.ROOT)
                    token.equals("qwen", ignoreCase = true) -> "Qwen"
                    token.equals("ai", ignoreCase = true) -> "AI"
                    token.matches(Regex("(?i)q\\d+[a-z_]*")) -> token.uppercase(Locale.ROOT)
                    token.matches(Regex("(?i)\\d+(?:\\.\\d+)?[bmk]")) ->
                        token.dropLast(1) + token.last().uppercaseChar()
                    token.matches(Regex("(?i)v\\d+(?:[._]\\d+)*")) ->
                        "v" + token.drop(1).replace('_', '.')
                    else -> token.replaceFirstChar { it.titlecase(Locale.ROOT) }
                }
            }
    }
}
