package com.webox.service.ai;

import com.webox.common.Json;
import com.webox.domain.DailyMenu;
import com.webox.domain.Enums;
import com.webox.dto.PreferenceDtos;
import com.webox.repository.DailyMenuRepository;
import com.webox.repository.OrderItemRepository;
import com.webox.service.MealSlotService;
import com.webox.service.PreferenceService;
import java.io.IOException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * The AI meal assistant.
 * <p>Hard guarantees are enforced <em>before</em> any model is involved: the candidate set excludes
 * sold-out dishes, anything containing an allergen the employee flagged, and anything they already ate
 * in the last seven days. The model therefore only ever ranks a safe, available shortlist — which also
 * means a hallucinated dish id cannot reach the UI, because unknown ids are dropped when the streamed
 * answer is parsed.
 * <p>With no {@code LLM_API_KEY} configured the deterministic ranker takes over and streams through the
 * exact same event sequence, so the feature stays runnable (and honest about which provider answered).
 */
@Service
public class RecommendationService {

    private static final Logger log = LoggerFactory.getLogger(RecommendationService.class);
    private static final int MAX_RECOMMENDATIONS = 4;
    private static final int RECENT_DAYS = 7;
    private static final Pattern RECOMMENDATION_LINE = Pattern.compile("^[\\s\\-*•`]*#*\\s*(\\d{1,10})\\s*[|:：]\\s*(.{3,240})$");
    private static final Set<String> LIGHT_HINTS = Set.of("light", "healthy", "low-fat", "low fat", "salad", "fresh", "not heavy");
    private static final Set<String> PROTEIN_HINTS = Set.of("protein", "high-protein", "high protein", "gym", "muscle", "filling");
    private static final Set<String> SPICY_HINTS = Set.of("spicy", "hot", "chili", "chilli", "sichuan");

    private final DailyMenuRepository menu;
    private final OrderItemRepository orderItems;
    private final PreferenceService preferences;
    private final MealSlotService slots;
    private final OpenAiCompatibleLlmClient llm;
    private final Executor sseExecutor;
    private final Clock clock;

    public RecommendationService(DailyMenuRepository menu, OrderItemRepository orderItems,
                                 PreferenceService preferences, MealSlotService slots,
                                 OpenAiCompatibleLlmClient llm,
                                 @Qualifier("sseExecutor") Executor sseExecutor, Clock clock) {
        this.menu = menu;
        this.orderItems = orderItems;
        this.preferences = preferences;
        this.slots = slots;
        this.llm = llm;
        this.sseExecutor = sseExecutor;
        this.clock = clock;
    }

    public record Candidate(Long menuId, String name, String description, long priceCents, String category,
                            String protein, String spiceLevel, List<String> allergens, String imageUrl,
                            boolean preferredCuisine, boolean spiceMatch, boolean withinBudget) {}

    public record Recommendation(Long menuId, String reason) {}

    /** Safe, available shortlist for the employee. */
    @Transactional(readOnly = true)
    public List<Candidate> candidates(Long userId, LocalDate date) {
        LocalDate menuDate = date == null ? slots.today() : date;
        PreferenceDtos.PreferenceView prefs = preferences.view(userId);
        Set<String> flagged = new LinkedHashSet<>(prefs.allergens());
        Set<Long> recentlyOrdered = new LinkedHashSet<>(orderItems.findRecentlyOrderedDishIds(
                userId, java.time.Instant.now(clock).minus(RECENT_DAYS, ChronoUnit.DAYS), Enums.OrderStatus.Cancelled));

        List<Candidate> candidates = new ArrayList<>();
        for (DailyMenu row : menu.findActiveByMenuDate(menuDate)) {
            if (row.soldOut()) {
                continue;
            }
            List<String> allergens = Json.toList(row.getDish().getAllergens());
            if (allergens.stream().anyMatch(flagged::contains)) {
                continue;
            }
            if (recentlyOrdered.contains(row.getDish().getId())) {
                continue;
            }
            candidates.add(new Candidate(
                    row.getId(),
                    row.getDish().getName(),
                    row.getDish().getDescription(),
                    com.webox.common.Money.toCents(row.getDish().getPrice()),
                    row.getDish().getCategory(),
                    row.getDish().getProtein(),
                    row.getDish().getSpiceLevel().name(),
                    allergens,
                    row.getDish().getImageUrl(),
                    prefs.cuisinePreferences().contains(row.getDish().getCategory()),
                    prefs.spiceLevel() != null && prefs.spiceLevel().equals(row.getDish().getSpiceLevel().name()),
                    prefs.budgetMaxCents() == null
                            || com.webox.common.Money.toCents(row.getDish().getPrice()) <= prefs.budgetMaxCents()));
        }
        return candidates;
    }

    /** Streams recommendations as SSE events: provider, candidate, delta, dish, done, error. */
    public void stream(Long userId, String prompt, LocalDate date, SseEmitter emitter) {
        sseExecutor.execute(() -> {
            try {
                List<Candidate> candidates = candidates(userId, date);
                send(emitter, "provider", Map.of(
                        "provider", llm.configured() ? llm.providerName() : "rule-based",
                        "model", llm.configured() ? llm.model() : "deterministic-ranker"));
                send(emitter, "candidate", Map.of("count", candidates.size()));

                if (candidates.isEmpty()) {
                    send(emitter, "done", Map.of("recommendations", List.of(), "note",
                            "No dishes match your preferences and filters right now."));
                    emitter.complete();
                    return;
                }

                if (llm.configured()) {
                    try {
                        streamFromLlm(userId, prompt, candidates, emitter);
                        emitter.complete();
                        return;
                    } catch (Exception e) {
                        log.warn("LLM recommendation failed, falling back to the local ranker: {}", e.getMessage());
                        send(emitter, "error", Map.of("message",
                                "The AI service is unavailable right now — showing on-device matches instead."));
                    }
                }
                streamLocalRanker(userId, prompt, candidates, emitter);
                emitter.complete();
            } catch (Exception e) {
                log.error("Recommendation stream failed", e);
                trySend(emitter, "error", Map.of("message", "The assistant could not complete this request."));
                emitter.complete();
            }
        });
    }

    private void streamFromLlm(Long userId, String prompt, List<Candidate> candidates, SseEmitter emitter) {
        PreferenceDtos.PreferenceView prefs = preferences.view(userId);
        List<Recommendation> collected = new ArrayList<>();
        StringBuilder pending = new StringBuilder();
        Set<Long> validIds = candidates.stream().map(Candidate::menuId).collect(java.util.stream.Collectors.toSet());

        llm.stream(systemPrompt(), userPrompt(prompt, candidates, prefs), chunk -> {
            trySend(emitter, "delta", Map.of("text", chunk));
            pending.append(chunk);
            int newline;
            while ((newline = pending.indexOf("\n")) >= 0) {
                String line = pending.substring(0, newline);
                pending.delete(0, newline + 1);
                parseLine(line, validIds, collected, emitter);
            }
        });
        if (pending.length() > 0) {
            parseLine(pending.toString(), validIds, collected, emitter);
        }
        if (collected.isEmpty()) {
            throw new IllegalStateException("The model did not return any usable recommendation lines.");
        }
        send(emitter, "done", Map.of("recommendations", collected));
    }

    private void parseLine(String rawLine, Set<Long> validIds, List<Recommendation> collected, SseEmitter emitter) {
        Matcher matcher = RECOMMENDATION_LINE.matcher(rawLine.trim());
        if (!matcher.matches()) {
            return;
        }
        long menuId;
        try {
            menuId = Long.parseLong(matcher.group(1));
        } catch (NumberFormatException e) {
            return;
        }
        // A menu id the model invented — or one dropped by the safety filter — is never shown.
        if (!validIds.contains(menuId) || collected.size() >= MAX_RECOMMENDATIONS
                || collected.stream().anyMatch(r -> r.menuId() == menuId)) {
            return;
        }
        String reason = matcher.group(2).replaceAll("[`*_#]", "").trim();
        Recommendation recommendation = new Recommendation(menuId, reason);
        collected.add(recommendation);
        send(emitter, "dish", recommendation);
    }

    private void streamLocalRanker(Long userId, String prompt, List<Candidate> candidates, SseEmitter emitter) {
        List<Recommendation> ranked = rankLocally(userId, prompt, candidates);
        List<Recommendation> sent = new ArrayList<>();
        for (Recommendation recommendation : ranked) {
            send(emitter, "dish", recommendation);
            sent.add(recommendation);
            try {
                // Keeps the progressive feel of a streamed answer even though this ranking is instant.
                Thread.sleep(140);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        send(emitter, "done", Map.of("recommendations", sent));
    }

    /** Deterministic ranker used when no API key is configured (and as the failure fallback). */
    @Transactional(readOnly = true)
    public List<Recommendation> rankLocally(Long userId, String prompt, List<Candidate> candidates) {
        String text = prompt == null ? "" : prompt.toLowerCase(Locale.ROOT);
        boolean light = LIGHT_HINTS.stream().anyMatch(text::contains);
        boolean protein = PROTEIN_HINTS.stream().anyMatch(text::contains);
        boolean spicy = SPICY_HINTS.stream().anyMatch(text::contains);

        return candidates.stream()
                .map(candidate -> Map.entry(candidate, score(candidate, text, light, protein, spicy)))
                .sorted(Map.Entry.<Candidate, Integer>comparingByValue(Comparator.reverseOrder())
                        .thenComparing(entry -> entry.getKey().menuId()))
                .limit(MAX_RECOMMENDATIONS)
                .map(entry -> new Recommendation(entry.getKey().menuId(),
                        reason(entry.getKey(), entry.getValue(), light, protein, spicy)))
                .toList();
    }

    private int score(Candidate candidate, String text, boolean light, boolean protein, boolean spicy) {
        int score = 0;
        if (light) {
            score += candidate.category().equals("Light Meal") ? 4 : 0;
            score += "None".equals(candidate.spiceLevel()) ? 2 : 0;
        }
        if (protein) {
            score += candidate.protein().isBlank() ? 0 : 3;
        }
        if (spicy) {
            score += switch (candidate.spiceLevel()) {
                case "Hot" -> 4;
                case "Medium" -> 2;
                default -> 0;
            };
        }
        if (candidate.preferredCuisine()) {
            score += 2;
        }
        if (candidate.spiceMatch()) {
            score += 1;
        }
        if (candidate.withinBudget()) {
            score += 1;
        }
        String name = candidate.name().toLowerCase(Locale.ROOT);
        String description = candidate.description().toLowerCase(Locale.ROOT);
        for (String token : text.split("[^a-z]+")) {
            if (token.length() >= 4 && (name.contains(token) || description.contains(token))) {
                score += 2;
            }
        }
        return score;
    }

    private String reason(Candidate candidate, int score, boolean light, boolean protein, boolean spicy) {
        List<String> parts = new ArrayList<>();
        if (light && candidate.category().equals("Light Meal")) {
            parts.add("a light, easy choice");
        } else if (protein && !candidate.protein().isBlank()) {
            parts.add("a solid protein source (" + candidate.protein() + ")");
        } else if (spicy && !"None".equals(candidate.spiceLevel())) {
            parts.add("brings the heat you asked for");
        } else if (candidate.preferredCuisine()) {
            parts.add("one of your preferred cuisines");
        } else {
            parts.add("a good match for your request");
        }
        if (candidate.preferredCuisine() && !parts.get(0).contains("preferred cuisines")) {
            parts.add("one of your preferred cuisines");
        }
        if (candidate.withinBudget()) {
            parts.add("within your per-meal budget");
        }
        if (candidate.allergens().isEmpty()) {
            parts.add("no allergens you flagged");
        } else {
            parts.add("none of the allergens you flagged");
        }
        String joined = String.join(", ", parts);
        return candidate.name() + " is " + joined + ".";
    }

    private String systemPrompt() {
        return """
                You are WeBox's meal assistant for a company canteen. You recommend today's dishes to an employee.
                Rules:
                - Only recommend dishes from the provided candidate list, using their numeric menu id.
                - Reply with one line per dish, in the exact format: MENU_ID|reason
                - Provide between 2 and %d lines, best match first. No headings, no bullet points, no numbering.
                - Each reason is one short English sentence (max 120 characters), addressed to the employee, and must
                  reference their request or their stated preferences.
                - Never invent dishes, prices or allergens. Never mention menu ids in the reason text.
                """.formatted(MAX_RECOMMENDATIONS);
    }

    private String userPrompt(String prompt, List<Candidate> candidates, PreferenceDtos.PreferenceView prefs) {
        StringBuilder sb = new StringBuilder();
        sb.append("Employee request: ").append(prompt).append("\n\n");
        sb.append("Employee preferences: ")
                .append("cuisines=").append(prefs.cuisinePreferences())
                .append(", spice=").append(prefs.spiceLevel() == null ? "not set" : prefs.spiceLevel())
                .append(", taste=").append(prefs.taste() == null ? "not set" : prefs.taste())
                .append(", budget max=").append(prefs.budgetMaxCents() == null ? "not set" : "¥" + prefs.budgetMaxCents() / 100.0)
                .append(", flagged allergens=").append(prefs.allergens())
                .append("\n\nCandidate dishes (already filtered for allergens, availability and recent orders):\n");
        for (Candidate candidate : candidates) {
            sb.append(candidate.menuId()).append(" | ").append(candidate.name())
                    .append(" | ").append(candidate.category())
                    .append(" | ¥").append(String.format("%.2f", candidate.priceCents() / 100.0))
                    .append(" | protein: ").append(candidate.protein().isBlank() ? "n/a" : candidate.protein())
                    .append(" | spice: ").append(candidate.spiceLevel())
                    .append(" | ").append(candidate.description())
                    .append("\n");
        }
        sb.append("\nAnswer with MENU_ID|reason lines only.");
        return sb.toString();
    }

    private void send(SseEmitter emitter, String event, Object payload) {
        try {
            emitter.send(SseEmitter.event().name(event).data(payload));
        } catch (IOException | IllegalStateException e) {
            throw new IllegalStateException("The client disconnected.", e);
        }
    }

    private void trySend(SseEmitter emitter, String event, Object payload) {
        try {
            emitter.send(SseEmitter.event().name(event).data(payload));
        } catch (IOException | IllegalStateException e) {
            log.debug("Dropping SSE event {}: client is gone", event);
        }
    }
}
