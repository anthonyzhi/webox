package com.webox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.webox.common.ApiException;
import com.webox.domain.UserPreference;
import com.webox.dto.PreferenceDtos;
import com.webox.repository.UserAddressRepository;
import com.webox.repository.UserPreferenceRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** Dietary preferences drive both on-device filtering and the AI prompt, so they are validated hard. */
@ExtendWith(MockitoExtension.class)
class PreferenceServiceTest {

    @Mock
    private UserPreferenceRepository preferences;

    @Mock
    private UserAddressRepository addresses;

    private PreferenceService service;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(Instant.parse("2026-09-16T01:00:00Z"), ZoneId.of("Asia/Shanghai"));
        service = new PreferenceService(preferences, addresses, clock);
        lenient().when(preferences.save(any(UserPreference.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private void stored(UserPreference preference) {
        // Requests that fail validation never reach the lookup, so this stub is intentionally lenient.
        lenient().when(preferences.findById(anyLong())).thenReturn(Optional.of(preference));
    }

    @Test
    @DisplayName("allergens, cuisines and budget are persisted in normalised form")
    void savesValidPreferences() {
        stored(new UserPreference());
        PreferenceDtos.PreferenceView view = service.update(7L, new PreferenceDtos.PreferenceUpdateRequest(
                List.of("Egg", "Peanuts", "Egg"),
                List.of("chinese", "Light Meal"),
                "medium",
                "balanced",
                1500L,
                4000L,
                true));

        ArgumentCaptor<UserPreference> saved = ArgumentCaptor.forClass(UserPreference.class);
        verify(preferences).save(saved.capture());
        assertThat(saved.getValue().getAllergens()).isEqualTo("Egg,Peanuts");
        assertThat(saved.getValue().getCuisinePreferences()).isEqualTo("Chinese,Light Meal");
        assertThat(saved.getValue().getSpiceLevel()).isEqualTo("Medium");
        assertThat(saved.getValue().getTaste()).isEqualTo("Balanced");
        assertThat(saved.getValue().isRecommendEnabled()).isTrue();
        assertThat(view.budgetMaxCents()).isEqualTo(4000);
    }

    @Test
    @DisplayName("an unknown allergen is rejected")
    void rejectsUnknownAllergen() {
        stored(new UserPreference());
        assertThatThrownBy(() -> service.update(7L, new PreferenceDtos.PreferenceUpdateRequest(
                List.of("Sesame"), null, null, null, null, null, null)))
                .isInstanceOf(ApiException.class)
                .hasFieldOrPropertyWithValue("code", "VALIDATION_ERROR");
    }

    @Test
    @DisplayName("an unknown cuisine is rejected")
    void rejectsUnknownCuisine() {
        stored(new UserPreference());
        assertThatThrownBy(() -> service.update(7L, new PreferenceDtos.PreferenceUpdateRequest(
                null, List.of("Martian"), null, null, null, null, null)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("a budget range that runs backwards is rejected")
    void rejectsInvertedBudget() {
        stored(new UserPreference());
        assertThatThrownBy(() -> service.update(7L, new PreferenceDtos.PreferenceUpdateRequest(
                null, null, null, null, 5000L, 1000L, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Please check");
    }

    @Test
    @DisplayName("a household budget in cents survives the round trip exactly")
    void keepsBudgetPrecision() {
        UserPreference existing = new UserPreference();
        stored(existing);
        service.update(7L, new PreferenceDtos.PreferenceUpdateRequest(
                null, null, null, null, 1550L, 3580L, false));
        assertThat(existing.getBudgetMin()).isEqualByComparingTo("15.50");
        assertThat(existing.getBudgetMax()).isEqualByComparingTo("35.80");
        assertThat(service.view(7L).budgetMinCents()).isEqualTo(1550);
    }
}
