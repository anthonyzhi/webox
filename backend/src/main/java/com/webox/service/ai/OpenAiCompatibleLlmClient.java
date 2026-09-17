package com.webox.service.ai;

import com.webox.config.AppProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * OpenAI-compatible streaming client ({@code /chat/completions} with {@code stream:true}).
 * <p>Deliberately protocol-level rather than vendor-SDK based: any endpoint that speaks the OpenAI
 * schema (OpenAI, DeepSeek, Qwen/DashScope compatible mode, Moonshot, a local vLLM/Ollama gateway, …)
 * works by changing {@code LLM_BASE_URL} / {@code LLM_MODEL} / {@code LLM_API_KEY}.
 * <p>Content deltas are handed to the caller as they arrive, which is what makes the recommendation
 * panel stream instead of waiting for the full answer.
 */
@Component
public class OpenAiCompatibleLlmClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAiCompatibleLlmClient.class);

    private final AppProperties properties;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient httpClient;

    public OpenAiCompatibleLlmClient(AppProperties properties) {
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    public boolean configured() {
        return properties.getLlm().configured();
    }

    public String providerName() {
        return "openai-compatible";
    }

    public String model() {
        return properties.getLlm().getModel();
    }

    /**
     * Streams the completion, invoking {@code onDelta} for every content chunk.
     *
     * @throws LlmException when the endpoint is unreachable, rejects the key or streams no content.
     */
    public void stream(String systemPrompt, String userPrompt, Consumer<String> onDelta) {
        AppProperties.Llm llm = properties.getLlm();
        ObjectNode payload = mapper.createObjectNode();
        payload.put("model", llm.getModel());
        payload.put("stream", true);
        payload.put("temperature", 0.4);
        ArrayNode messages = payload.putArray("messages");
        messages.addObject().put("role", "system").put("content", systemPrompt);
        messages.addObject().put("role", "user").put("content", userPrompt);

        String url = llm.getBaseUrl().replaceAll("/+$", "") + "/chat/completions";
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(llm.getTimeoutSeconds()))
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream")
                    .header("Authorization", "Bearer " + llm.getApiKey())
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
                    .build();
        } catch (Exception e) {
            throw new LlmException("Unable to prepare the LLM request: " + e.getMessage(), e);
        }

        try {
            HttpResponse<Stream<String>> response =
                    httpClient.send(request, HttpResponse.BodyHandlers.ofLines());
            if (response.statusCode() >= 400) {
                throw new LlmException("The LLM endpoint returned HTTP " + response.statusCode() + ".");
            }
            boolean[] sawContent = {false};
            response.body()
                    .takeWhile(line -> !line.startsWith("data: [DONE]"))
                    .filter(line -> line.startsWith("data:"))
                    .map(line -> line.substring(5).trim())
                    .filter(json -> !json.isEmpty())
                    .forEach(json -> extractContent(json).ifPresent(chunk -> {
                        sawContent[0] = true;
                        onDelta.accept(chunk);
                    }));
            if (!sawContent[0]) {
                throw new LlmException("The LLM endpoint streamed no content.");
            }
        } catch (LlmException e) {
            throw e;
        } catch (Exception e) {
            throw new LlmException("The LLM request failed: " + e.getMessage(), e);
        }
    }

    private java.util.Optional<String> extractContent(String json) {
        try {
            JsonNode node = mapper.readTree(json);
            JsonNode choices = node.path("choices");
            if (!choices.isArray() || choices.isEmpty()) {
                return java.util.Optional.empty();
            }
            String content = choices.get(0).path("delta").path("content").asText("");
            return content.isEmpty() ? java.util.Optional.empty() : java.util.Optional.of(content);
        } catch (Exception e) {
            log.debug("Skipping unparsable LLM chunk: {}", e.getMessage());
            return java.util.Optional.empty();
        }
    }

    public static class LlmException extends RuntimeException {
        public LlmException(String message) {
            super(message);
        }

        public LlmException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
