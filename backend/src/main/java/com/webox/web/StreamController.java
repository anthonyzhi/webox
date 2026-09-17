package com.webox.web;

import com.webox.common.ApiException;
import com.webox.domain.User;
import com.webox.service.MealSlotService;
import com.webox.service.StockStreamService;
import com.webox.service.ai.RecommendationService;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Streaming endpoints. {@code EventSource} cannot send headers, so the token may arrive as a query
 *  parameter — {@link AuthInterceptor} accepts either. */
@RestController
@RequestMapping("/api")
public class StreamController {

    private final StockStreamService stockStream;
    private final RecommendationService recommendations;
    private final MealSlotService slots;

    public StreamController(StockStreamService stockStream, RecommendationService recommendations,
                            MealSlotService slots) {
        this.stockStream = stockStream;
        this.recommendations = recommendations;
        this.slots = slots;
    }

    @GetMapping("/stream/stock")
    public SseEmitter stock(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return stockStream.subscribe(date == null ? slots.today() : date);
    }

    @GetMapping("/ai/recommend")
    public SseEmitter recommend(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @RequestParam String prompt,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        String trimmed = prompt == null ? "" : prompt.trim();
        if (trimmed.isEmpty() || trimmed.length() > 300) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                    java.util.Map.of("prompt", "Describe what you feel like eating in 1-300 characters."));
        }
        SseEmitter emitter = new SseEmitter(120_000L);
        recommendations.stream(user.getId(), trimmed, date, emitter);
        return emitter;
    }
}
