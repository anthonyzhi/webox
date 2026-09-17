package com.webox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.webox.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Menu query sanitising. Search terms are bound as parameters (never concatenated), and LIKE wildcards
 * are escaped so a user typing "%" searches for a literal percent sign instead of matching everything.
 */
class MenuQueryTest {

    @Test
    @DisplayName("search terms are lowercased and wrapped for a contains match")
    void normalizesSearchTerm() {
        assertThat(MenuService.normalizeSearch("  Burger ")).isEqualTo("%burger%");
    }

    @Test
    @DisplayName("LIKE wildcards in user input are escaped")
    void escapesWildcards() {
        assertThat(MenuService.normalizeSearch("100%")).isEqualTo("%100\\%%");
        assertThat(MenuService.normalizeSearch("a_b")).isEqualTo("%a\\_b%");
        assertThat(MenuService.normalizeSearch("back\\slash")).isEqualTo("%back\\\\slash%");
    }

    @Test
    @DisplayName("empty search is treated as no filter")
    void blankSearchIsNull() {
        assertThat(MenuService.normalizeSearch(null)).isNull();
        assertThat(MenuService.normalizeSearch("   ")).isNull();
    }

    @Test
    @DisplayName("search keywords are capped at 50 characters")
    void rejectsOverlongSearch() {
        assertThatThrownBy(() -> MenuService.normalizeSearch("x".repeat(51)))
                .isInstanceOf(ApiException.class)
                .hasFieldOrPropertyWithValue("code", "VALIDATION_ERROR");
    }

    @Test
    @DisplayName("categories are normalised to their display spelling")
    void normalizesCategories() {
        assertThat(MenuService.normalizeCategories(List.of("chinese", "Light Meal")))
                .containsExactly("Chinese", "Light Meal");
        assertThat(MenuService.normalizeCategories(List.of())).isNull();
        assertThat(MenuService.normalizeCategories(List.of(" ", ""))).isNull();
    }

    @Test
    @DisplayName("unknown categories are rejected instead of silently ignored")
    void rejectsUnknownCategory() {
        assertThatThrownBy(() -> MenuService.normalizeCategories(List.of("Martian")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Please check");
    }
}
