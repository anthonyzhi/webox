package com.webox.dto;

import java.util.List;

/** Menu, dish detail, catalogue enums and ordering-rule views. */
public final class MenuDtos {

    private MenuDtos() {}

    public record OptionView(Long id, String name, long extraPriceCents) {}

    public record OptionGroupView(Long id, String name, boolean required, boolean multiSelect, List<OptionView> options) {}

    /** Immutable snapshot of a dish definition. Cached in memory: it changes only when an admin edits
     *  the catalogue, while stock (which changes constantly) is always read live from daily_menu. */
    public record DishCore(
            Long id, String name, String description, long priceCents, String category, String protein,
            List<String> allergens, String spiceLevel, String imageUrl, List<OptionGroupView> optionGroups) {}

    public record PreferenceMatch(boolean preferredCuisine, boolean spiceMatch, boolean withinBudget) {}

    public record MenuItemView(
            Long menuId, Long dishId, String name, String description, long priceCents, String category,
            String protein, List<String> allergens, String spiceLevel, String imageUrl,
            int remaining, boolean lowStock, boolean soldOut,
            List<OptionGroupView> optionGroups, PreferenceMatch preferenceMatch, boolean recommended) {}

    public record CategoryFacet(String value, long count) {}

    public record SlotView(String deliveryDate, String mealPeriod, String label, String cutoffAt, boolean autoSwitched) {}

    public record MenuRules(int maxQuantityPerOrder, SlotView nextSlot) {}

    public record MenuPageResponse(String date, int page, int size, long totalElements, int totalPages,
                                   List<CategoryFacet> categories, List<MenuItemView> items, MenuRules rules) {}

    public record MenuItemResponse(MenuItemView item, MenuRules rules) {}

    public record EnumsResponse(List<String> categories, List<String> spiceLevels, List<String> allergens,
                               List<String> tastes, List<String> mealPeriods, List<String> orderStatuses,
                               String currencySymbol) {}
}
