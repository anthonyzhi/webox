package com.webox.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.webox.common.Money;
import com.webox.domain.Dish;
import com.webox.domain.DishOption;
import com.webox.domain.DishOptionGroup;
import com.webox.dto.MenuDtos;
import com.webox.repository.DishRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * In-process cache of the dish catalogue.
 * <p>Why this and not a plain read: during the 09:30-10:00 rush every employee loads the same menu
 * repeatedly, and a dish definition costs three queries (dish, option groups, options) plus joins.
 * The catalogue changes only when an admin edits it, so it is cached until an admin write evicts it
 * (write-through invalidation, no TTL races on stale data) with a TTL as a safety net.
 * <p>Stock is deliberately <em>not</em> cached — it changes on every order and must always be exact.
 */
@Service
public class CatalogService {

    private static final String CATALOG_KEY = "active-catalog";

    private final DishRepository dishes;
    private final Cache<String, Object> dishCache;

    public CatalogService(DishRepository dishes, Cache<String, Object> dishCatalogCache) {
        this.dishes = dishes;
        this.dishCache = dishCatalogCache;
    }

    /** dishId -> immutable dish definition (price, allergens, spice, option groups). */
    @SuppressWarnings("unchecked")
    @Transactional(readOnly = true)
    public Map<Long, MenuDtos.DishCore> catalog() {
        Object cached = dishCache.getIfPresent(CATALOG_KEY);
        if (cached != null) {
            return (Map<Long, MenuDtos.DishCore>) cached;
        }
        Map<Long, MenuDtos.DishCore> fresh = loadCatalog();
        dishCache.put(CATALOG_KEY, fresh);
        return fresh;
    }

    public void evict() {
        dishCache.invalidateAll();
    }

    private Map<Long, MenuDtos.DishCore> loadCatalog() {
        Map<Long, MenuDtos.DishCore> map = new LinkedHashMap<>();
        for (Dish dish : dishes.findByActiveTrueOrderByIdAsc()) {
            map.put(dish.getId(), toCore(dish, true));
        }
        return map;
    }

    public static MenuDtos.DishCore toCore(Dish dish, boolean withOptions) {
        return new MenuDtos.DishCore(
                dish.getId(),
                dish.getName(),
                dish.getDescription(),
                Money.toCents(dish.getPrice()),
                dish.getCategory(),
                dish.getProtein(),
                com.webox.common.Json.toList(dish.getAllergens()),
                dish.getSpiceLevel().name(),
                dish.getImageUrl(),
                withOptions ? toOptionGroups(dish.getOptionGroups()) : List.of());
    }

    public static List<MenuDtos.OptionGroupView> toOptionGroups(List<DishOptionGroup> groups) {
        return groups.stream().map(group -> new MenuDtos.OptionGroupView(
                group.getId(),
                group.getName(),
                group.isRequired(),
                group.isMultiSelect(),
                group.getOptions().stream().map(CatalogService::toOption).toList())).toList();
    }

    private static MenuDtos.OptionView toOption(DishOption option) {
        return new MenuDtos.OptionView(option.getId(), option.getName(), Money.toCents(option.getExtraPrice()));
    }
}
