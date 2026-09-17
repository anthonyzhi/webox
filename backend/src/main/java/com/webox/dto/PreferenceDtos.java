package com.webox.dto;

import com.webox.domain.Enums;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/** Dietary preferences and delivery address history. */
public final class PreferenceDtos {

    private PreferenceDtos() {}

    public record PreferenceView(List<String> allergens, List<String> cuisinePreferences, String spiceLevel,
                                 String taste, Long budgetMinCents, Long budgetMaxCents, boolean recommendEnabled) {}

    public record PreferenceUpdateRequest(
            List<String> allergens,
            List<String> cuisinePreferences,
            String spiceLevel,
            String taste,
            @Min(value = 0, message = "Budget must not be negative.")
            @Max(value = 100_000, message = "Budget must be at most ¥1000.00.") Long budgetMinCents,
            @Min(value = 0, message = "Budget must not be negative.")
            @Max(value = 100_000, message = "Budget must be at most ¥1000.00.") Long budgetMaxCents,
            Boolean recommendEnabled) {}

    public record AddressView(Long id, String address, String lastUsedAt) {}

    public record AddressRequest(
            @NotBlank(message = "Address is required.")
            @Size(max = 200, message = "Address must be at most 200 characters.") String address) {}

    public record DashboardToday(long orderCount, long totalRevenueCents, long completed, long pending,
                                long confirmed, long cancelled) {}

    public record TopDish(String dishName, long quantity, long revenueCents) {}

    public record MealPeriodStat(Enums.MealPeriod mealPeriod, long orderCount, long revenueCents) {}

    public record TrendPoint(String date, long orderCount, long revenueCents) {}

    public record LowStockRow(Long menuId, String dishName, int remaining) {}

    public record DashboardResponse(String date, DashboardToday today, List<TopDish> topDishes,
                                    List<MealPeriodStat> mealPeriod, List<TrendPoint> trend,
                                    List<LowStockRow> lowStock) {}
}
