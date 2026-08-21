package com.hijosdelsol.hermesmobile.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ModelNameFormatterTest {
    @Test
    fun hidesTransportPrefixAndLatestTag() {
        assertEquals(
            "Liquid AI · LFM2 2.6B · Q4_K_M",
            ModelNameFormatter.displayName(
                "hf.co/LiquidAI/LFM2-2.6B-GGUF:Q4_K_M",
                "ollama",
            ),
        )
        assertEquals(
            "Liquid LFM2 2.6B",
            ModelNameFormatter.displayName("liquid-2.6b:latest", "ollama"),
        )
    }

    @Test
    fun keepsReadableNamesForAgentModels() {
        assertEquals(
            "Qwen 3.5 Agent Coder v1.1",
            ModelNameFormatter.displayName("qwen35-agent-coder-v1_1:latest", "ollama"),
        )
        assertEquals(
            "TranslateGemma · 4B",
            ModelNameFormatter.displayName("translategemma:4b", "ollama"),
        )
    }
}
