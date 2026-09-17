package com.webox.service;

import com.webox.common.ApiException;
import com.webox.common.Json;
import com.webox.common.Money;
import com.webox.domain.Enums;
import com.webox.domain.UserAddress;
import com.webox.domain.UserPreference;
import com.webox.dto.PreferenceDtos;
import com.webox.repository.UserAddressRepository;
import com.webox.repository.UserPreferenceRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Dietary preferences (allergens, cuisines, spice, taste, budget) and delivery address history. */
@Service
public class PreferenceService {

    private static final int MAX_HISTORY = 10;

    private final UserPreferenceRepository preferences;
    private final UserAddressRepository addresses;
    private final Clock clock;

    public PreferenceService(UserPreferenceRepository preferences, UserAddressRepository addresses, Clock clock) {
        this.preferences = preferences;
        this.addresses = addresses;
        this.clock = clock;
    }

    @Transactional
    public UserPreference ensureFor(Long userId) {
        return preferences.findById(userId).orElseGet(() -> {
            UserPreference created = new UserPreference();
            created.setUserId(userId);
            created.setUpdatedAt(Instant.now(clock));
            return preferences.save(created);
        });
    }

    @Transactional
    public PreferenceDtos.PreferenceView view(Long userId) {
        UserPreference pref = ensureFor(userId);
        return new PreferenceDtos.PreferenceView(
                Json.toList(pref.getAllergens()),
                Json.toList(pref.getCuisinePreferences()),
                pref.getSpiceLevel(),
                pref.getTaste(),
                pref.getBudgetMin() == null ? null : Money.toCents(pref.getBudgetMin()),
                pref.getBudgetMax() == null ? null : Money.toCents(pref.getBudgetMax()),
                pref.isRecommendEnabled());
    }

    @Transactional
    public PreferenceDtos.PreferenceView update(Long userId, PreferenceDtos.PreferenceUpdateRequest request) {
        List<String> allergens = validAllergens(request.allergens());
        List<String> cuisines = validCuisines(request.cuisinePreferences());
        String spice = validateEnum(request.spiceLevel(), Enums.SpiceLevel.class, "spiceLevel");
        String taste = validateEnum(request.taste(), Enums.Taste.class, "taste");
        if (request.budgetMinCents() != null && request.budgetMaxCents() != null
                && request.budgetMinCents() > request.budgetMaxCents()) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                    java.util.Map.of("budgetMinCents", "Minimum budget must not exceed the maximum budget."));
        }

        UserPreference pref = ensureFor(userId);
        pref.setAllergens(Json.toCsv(allergens));
        pref.setCuisinePreferences(Json.toCsv(cuisines));
        pref.setSpiceLevel(spice);
        pref.setTaste(taste);
        pref.setBudgetMin(request.budgetMinCents() == null ? null : Money.fromCents(request.budgetMinCents()));
        pref.setBudgetMax(request.budgetMaxCents() == null ? null : Money.fromCents(request.budgetMaxCents()));
        if (request.recommendEnabled() != null) {
            pref.setRecommendEnabled(request.recommendEnabled());
        }
        pref.setUpdatedAt(Instant.now(clock));
        preferences.save(pref);
        return view(userId);
    }

    @Transactional(readOnly = true)
    public List<PreferenceDtos.AddressView> addressHistory(Long userId) {
        return addresses.findByUserIdOrderByLastUsedAtDesc(userId, Limit.of(MAX_HISTORY)).stream()
                .map(a -> new PreferenceDtos.AddressView(a.getId(), a.getAddress(), a.getLastUsedAt().toString()))
                .toList();
    }

    /** Remembers (or refreshes) an address so the next checkout can offer it as a shortcut. */
    @Transactional
    public void rememberAddress(Long userId, String rawAddress) {
        String address = rawAddress == null ? "" : rawAddress.trim();
        if (address.isEmpty()) {
            return;
        }
        UserAddress existing = addresses.findByUserIdAndAddress(userId, address).orElse(null);
        if (existing != null) {
            existing.setLastUsedAt(Instant.now(clock));
            addresses.save(existing);
        } else {
            addresses.save(UserAddress.of(userId, address));
        }
    }

    public List<String> allergensOf(Long userId) {
        return Json.toList(ensureFor(userId).getAllergens());
    }

    public List<String> cuisinesOf(Long userId) {
        return Json.toList(ensureFor(userId).getCuisinePreferences());
    }

    public BigDecimal budgetMaxOf(Long userId) {
        return ensureFor(userId).getBudgetMax();
    }

    private List<String> validAllergens(List<String> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream().map(v -> validateEnum(v, Enums.Allergen.class, "allergens")).distinct().toList();
    }

    private List<String> validCuisines(List<String> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream().map(v -> {
            Enums.Category category = Enums.Category.fromValue(v);
            if (category == null) {
                throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                        java.util.Map.of("cuisinePreferences", "Unknown cuisine: " + v));
            }
            return category.value();
        }).distinct().toList();
    }

    private <E extends Enum<E>> String validateEnum(String value, Class<E> type, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        for (E candidate : type.getEnumConstants()) {
            if (candidate.name().equalsIgnoreCase(value.trim())) {
                return candidate.name();
            }
        }
        throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                java.util.Map.of(field, "Unsupported value: " + value));
    }
}
