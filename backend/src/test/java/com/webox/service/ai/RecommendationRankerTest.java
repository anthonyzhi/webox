package com.webox.service.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.webox.service.ai.RecommendationService.Candidate;
import com.webox.service.ai.RecommendationService.Recommendation;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The deterministic ranker that answers when no LLM key is configured (and takes over if the model
 * call fails). It is pure logic, so it is tested without Spring or a database.
 */
class RecommendationRankerTest {

    private final RecommendationService service =
            new RecommendationService(null, null, null, null, null, null, null);

    private Candidate candidate(long menuId, String name, String category, String protein, String spice,
                                boolean cuisineMatch) {
        return new Candidate(menuId, name, "description of " + name, 3000, category, protein, spice,
                List.of(), "/assets/images/x.jpg", cuisineMatch, false, true);
    }

    private final List<Candidate> menu = List.of(
            candidate(1, "Classic Beef Burger", "Western", "Beef", "None", false),
            candidate(2, "Chicken Quinoa Bowl", "Light Meal", "Chicken", "None", true),
            candidate(3, "Tom Yum Soup", "Southeast Asian", "Shrimp", "Hot", false),
            candidate(4, "Kung Pao Chicken", "Chinese", "Chicken", "Medium", true),
            candidate(5, "Kung Pao Chicken Deluxe", "Chinese", "Chicken", "Medium", true));

    @Test
    @DisplayName("a light request surfaces the light, mild dishes first")
    void lightRequestPrefersLightDishes() {
        List<Recommendation> ranked = service.rankLocally(1L, "I want something light today", menu);
        assertThat(ranked).isNotEmpty();
        assertThat(ranked.get(0).menuId()).isEqualTo(2L);
        assertThat(ranked).hasSize(4);
    }

    @Test
    @DisplayName("a high-protein request favours dishes with a named protein source")
    void proteinRequestPrefersProtein() {
        List<Recommendation> ranked = service.rankLocally(1L, "A high-protein low-fat lunch", menu);
        assertThat(ranked.get(0).menuId()).isEqualTo(2L);
    }

    @Test
    @DisplayName("a spicy request surfaces the hot dish")
    void spicyRequestPrefersHotDishes() {
        List<Recommendation> ranked = service.rankLocally(1L, "something spicy please", menu);
        assertThat(ranked.get(0).menuId()).isEqualTo(3L);
    }

    @Test
    @DisplayName("keyword overlap with the dish name is rewarded")
    void keywordOverlapMatters() {
        List<Recommendation> ranked = service.rankLocally(1L, "I want the classic beef burger", menu);
        assertThat(ranked.get(0).menuId()).isEqualTo(1L);
    }

    @Test
    @DisplayName("never returns more than four recommendations and never repeats a dish")
    void capsAndDeduplicates() {
        List<Recommendation> ranked = service.rankLocally(1L, "anything", menu);
        assertThat(ranked).hasSize(4);
        assertThat(ranked.stream().map(Recommendation::menuId).distinct()).hasSize(4);
    }

    @Test
    @DisplayName("reasons are English sentences that name the dish")
    void reasonsAreReadable() {
        List<Recommendation> ranked = service.rankLocally(1L, "I want something light", menu);
        Recommendation first = ranked.get(0);
        assertThat(first.reason()).startsWith("Chicken Quinoa Bowl is ");
        assertThat(first.reason()).endsWith(".");
    }

    @Test
    @DisplayName("an empty shortlist is handled without exploding")
    void emptyCandidates() {
        assertThat(service.rankLocally(1L, "anything", List.of())).isEmpty();
    }
}
