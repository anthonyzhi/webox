package com.webox.service;

import com.webox.common.ApiException;
import com.webox.domain.DailyMenu;
import com.webox.domain.Enums;
import com.webox.dto.MenuDtos;
import com.webox.dto.PreferenceDtos;
import com.webox.repository.DailyMenuRepository;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Employee-facing menu reads.
 * <p>Filtering, sorting and paging run in SQL on the indexed {@code daily_menu(menu_date)} table, while
 * the dish definition (price, allergens, option groups) comes from {@link CatalogService}'s cache.
 * Stock is read live so "12 left" is never a stale number, and stock changes are pushed to open
 * browsers through {@link StockStreamService}.
 */
@Service
public class MenuService {

    private static final int MAX_PAGE_SIZE = 48;
    private static final Map<String, Sort> SORTS = Map.of(
            "price_asc", Sort.by(Sort.Order.asc("dish.price")),
            "price_desc", Sort.by(Sort.Order.desc("dish.price")),
            "name", Sort.by(Sort.Order.asc("dish.name")),
            "default", Sort.by(Sort.Order.asc("id")));

    private final DailyMenuRepository menu;
    private final CatalogService catalog;
    private final PreferenceService preferences;
    private final MealSlotService slots;

    public MenuService(DailyMenuRepository menu, CatalogService catalog, PreferenceService preferences,
                       MealSlotService slots) {
        this.menu = menu;
        this.catalog = catalog;
        this.preferences = preferences;
        this.slots = slots;
    }

    @Transactional(readOnly = true)
    public MenuDtos.MenuPageResponse search(Long userId, LocalDate date, List<String> categories, String q,
                                            int page, int size, String sort, boolean personalized) {
        // "Today's menu" by default: while a meal can still be ordered that is today, and once both
        // cut-offs have passed it is the next bookable day — otherwise the page would open on a menu
        // nobody can order from.
        LocalDate menuDate = date == null ? defaultMenuDate() : date;
        String term = normalizeSearch(q);
        List<String> categoryFilter = normalizeCategories(categories);
        int safePage = Math.max(0, page);
        int safeSize = Math.min(Math.max(1, size), MAX_PAGE_SIZE);

        Map<Long, MenuDtos.DishCore> dishes = catalog.catalog();
        PreferenceDtos.PreferenceView prefs = preferences.view(userId);
        Pageable pageable = PageRequest.of(safePage, safeSize, SORTS.getOrDefault(sort == null ? "default" : sort,
                SORTS.get("default")));

        List<MenuDtos.MenuItemView> items;
        long total;
        int totalPages;
        if (personalized) {
            // Personalised ordering cannot be expressed as a SQL ORDER BY over preference data, so the
            // (small, cache-backed) match set is ranked in memory and then sliced.
            Page<DailyMenu> all = menu.searchMenu(menuDate, term, categoryFilter, Pageable.unpaged());
            List<MenuDtos.MenuItemView> ranked = all.getContent().stream()
                    .map(row -> toView(row, dishes.get(row.getDish().getId()), prefs))
                    .filter(Objects::nonNull)
                    .sorted(personalizedOrder())
                    .toList();
            total = ranked.size();
            totalPages = (int) Math.ceil(total / (double) safeSize);
            int from = Math.min(safePage * safeSize, ranked.size());
            int to = Math.min(from + safeSize, ranked.size());
            items = ranked.subList(from, to);
        } else {
            Page<DailyMenu> result = menu.searchMenu(menuDate, term, categoryFilter, pageable);
            items = result.getContent().stream()
                    .map(row -> toView(row, dishes.get(row.getDish().getId()), prefs))
                    .filter(Objects::nonNull)
                    .toList();
            total = result.getTotalElements();
            totalPages = result.getTotalPages();
        }

        return new MenuDtos.MenuPageResponse(menuDate.toString(), safePage, safeSize, total, totalPages,
                facets(menuDate, term), items, rules());
    }

    @Transactional(readOnly = true)
    public MenuDtos.MenuItemResponse item(Long userId, Long menuId) {
        DailyMenu row = menu.findById(menuId)
                .orElseThrow(() -> ApiException.notFound("MENU_ITEM_NOT_FOUND", "This dish is not on the menu."));
        MenuDtos.DishCore core = catalog.catalog().get(row.getDish().getId());
        if (core == null) {
            throw ApiException.notFound("MENU_ITEM_NOT_FOUND", "This dish is not available today.");
        }
        MenuDtos.MenuItemView view = toView(row, core, preferences.view(userId));
        return new MenuDtos.MenuItemResponse(view, rules());
    }

    public MenuDtos.MenuRules rules() {
        return new MenuDtos.MenuRules(MealSlotService.MAX_QUANTITY_PER_ORDER, slotView());
    }

    /** The day the menu opens on: today, or the next bookable day once both cut-offs have passed. */
    public LocalDate defaultMenuDate() {
        return slots.nextBookableSlot().date();
    }

    public MenuDtos.SlotView slotView() {
        MealSlotService.Slot slot = slots.nextBookableSlot();
        return new MenuDtos.SlotView(slot.date().toString(), slot.period().name(),
                slots.label(slot.date(), slot.period()), slots.cutoffAt(slot.date(), slot.period()).toString(), false);
    }

    public MenuDtos.SlotView slotView(MealSlotService.Slot slot, boolean autoSwitched) {
        return new MenuDtos.SlotView(slot.date().toString(), slot.period().name(),
                slots.label(slot.date(), slot.period()), slots.cutoffAt(slot.date(), slot.period()).toString(),
                autoSwitched);
    }

    public MenuDtos.EnumsResponse enums() {
        return new MenuDtos.EnumsResponse(
                List.of(Enums.Category.values()).stream().map(Enums.Category::value).toList(),
                List.of(Enums.SpiceLevel.values()).stream().map(Enum::name).toList(),
                List.of(Enums.Allergen.values()).stream().map(Enum::name).toList(),
                List.of(Enums.Taste.values()).stream().map(Enum::name).toList(),
                List.of(Enums.MealPeriod.values()).stream().map(Enum::name).toList(),
                List.of(Enums.OrderStatus.values()).stream().map(Enum::name).toList(),
                "¥");
    }

    /** Allergens of a dish that the employee flagged; used by the add-to-cart confirmation. */
    public List<String> flaggedAllergens(Long userId, List<String> dishAllergens) {
        List<String> flagged = preferences.view(userId).allergens();
        return dishAllergens.stream().filter(flagged::contains).toList();
    }

    private List<MenuDtos.CategoryFacet> facets(LocalDate date, String term) {
        Map<String, Long> counts = menu.countByCategory(date, term).stream()
                .filter(row -> row[0] != null)
                .collect(Collectors.toMap(row -> (String) row[0], row -> ((Number) row[1]).longValue(),
                        (a, b) -> a, LinkedHashMap::new));
        List<MenuDtos.CategoryFacet> result = new ArrayList<>();
        for (Enums.Category category : Enums.Category.values()) {
            result.add(new MenuDtos.CategoryFacet(category.value(), counts.getOrDefault(category.value(), 0L)));
        }
        return result;
    }

    private MenuDtos.MenuItemView toView(DailyMenu row, MenuDtos.DishCore core,
                                        PreferenceDtos.PreferenceView prefs) {
        if (core == null) {
            return null;
        }
        MenuDtos.PreferenceMatch match = match(core, prefs);
        boolean recommended = match.preferredCuisine() && (match.spiceMatch() || match.withinBudget());
        return new MenuDtos.MenuItemView(
                row.getId(), core.id(), core.name(), core.description(), core.priceCents(), core.category(),
                core.protein(), core.allergens(), core.spiceLevel(), core.imageUrl(),
                row.remaining(), row.lowStock(), row.soldOut(),
                core.optionGroups(), match, recommended);
    }

    private MenuDtos.PreferenceMatch match(MenuDtos.DishCore core, PreferenceDtos.PreferenceView prefs) {
        boolean cuisine = prefs.cuisinePreferences().contains(core.category());
        boolean spice = prefs.spiceLevel() != null && prefs.spiceLevel().equals(core.spiceLevel());
        boolean budget = prefs.budgetMaxCents() == null || core.priceCents() <= prefs.budgetMaxCents();
        return new MenuDtos.PreferenceMatch(cuisine, spice, budget);
    }

    private Comparator<MenuDtos.MenuItemView> personalizedOrder() {
        return Comparator.comparingInt((MenuDtos.MenuItemView i) -> i.recommended() ? 0 : 1)
                .thenComparingInt(i -> i.preferenceMatch().preferredCuisine() ? 0 : 1)
                .thenComparingInt(i -> i.preferenceMatch().spiceMatch() ? 0 : 1)
                .thenComparingLong(MenuDtos.MenuItemView::menuId);
    }

    /** Escapes LIKE wildcards so a user searching for "100%" cannot turn it into a pattern. */
    static String normalizeSearch(String q) {
        if (q == null) {
            return null;
        }
        String trimmed = q.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        if (trimmed.length() > 50) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                    Map.of("q", "Search keyword must be at most 50 characters."));
        }
        String escaped = trimmed.toLowerCase(Locale.ROOT)
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + escaped + "%";
    }

    static List<String> normalizeCategories(List<String> categories) {
        if (categories == null || categories.isEmpty()) {
            return null;
        }
        List<String> values = new ArrayList<>();
        for (String raw : categories) {
            if (raw == null || raw.isBlank()) {
                continue;
            }
            Enums.Category category = Enums.Category.fromValue(raw);
            if (category == null) {
                throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                        Map.of("categories", "Unknown category: " + raw));
            }
            values.add(category.value());
        }
        return values.isEmpty() ? null : values;
    }
}
