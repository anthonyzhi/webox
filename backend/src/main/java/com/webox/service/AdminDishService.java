package com.webox.service;

import com.webox.common.ApiException;
import com.webox.common.Json;
import com.webox.common.Money;
import com.webox.domain.Dish;
import com.webox.domain.DishOption;
import com.webox.domain.DishOptionGroup;
import com.webox.domain.Enums;
import com.webox.dto.AdminDtos;
import com.webox.repository.DishRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Console catalogue management. Every write evicts the catalogue cache so employees see the change
 *  on their next request instead of waiting for a TTL to expire. */
@Service
public class AdminDishService {

    private static final int MAX_PAGE_SIZE = 100;

    private final DishRepository dishes;
    private final CatalogService catalog;
    private final Clock clock;

    public AdminDishService(DishRepository dishes, CatalogService catalog, Clock clock) {
        this.dishes = dishes;
        this.catalog = catalog;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AdminDtos.AdminDishPage page(String q, String category, Boolean active, int page, int size) {
        String term = q == null || q.isBlank() ? null : "%" + q.trim().toLowerCase() + "%";
        String categoryValue = null;
        if (category != null && !category.isBlank()) {
            Enums.Category parsed = Enums.Category.fromValue(category);
            if (parsed == null) {
                throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                        Map.of("category", "Unknown category: " + category));
            }
            categoryValue = parsed.value();
        }
        Pageable pageable = PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), MAX_PAGE_SIZE),
                Sort.by(Sort.Order.asc("id")));
        Page<Dish> result = dishes.searchForConsole(term, categoryValue, active, pageable);
        List<AdminDtos.AdminDishView> items = result.getContent().stream().map(AdminDishService::toView).toList();
        return new AdminDtos.AdminDishPage(result.getNumber(), result.getSize(), result.getTotalElements(),
                result.getTotalPages(), items);
    }

    @Transactional
    public AdminDtos.AdminDishView create(AdminDtos.DishWriteRequest request) {
        if (dishes.existsByNameIgnoreCase(request.name().trim())) {
            throw ApiException.conflict("DISH_NAME_TAKEN", "A dish named \"" + request.name().trim() + "\" already exists.");
        }
        Dish dish = new Dish();
        dish.setCreatedAt(Instant.now(clock));
        apply(dish, request);
        dishes.save(dish);
        catalog.evict();
        return toView(dish);
    }

    @Transactional
    public AdminDtos.AdminDishView update(Long id, AdminDtos.DishWriteRequest request) {
        Dish dish = dishes.findById(id)
                .orElseThrow(() -> ApiException.notFound("DISH_NOT_FOUND", "Dish not found."));
        dishes.findByNameIgnoreCase(request.name().trim())
                .filter(other -> !other.getId().equals(id))
                .ifPresent(other -> {
                    throw ApiException.conflict("DISH_NAME_TAKEN",
                            "A dish named \"" + request.name().trim() + "\" already exists.");
                });
        apply(dish, request);
        dishes.save(dish);
        catalog.evict();
        return toView(dish);
    }

    @Transactional
    public AdminDtos.AdminDishView updateStatus(Long id, boolean active) {
        Dish dish = dishes.findById(id)
                .orElseThrow(() -> ApiException.notFound("DISH_NOT_FOUND", "Dish not found."));
        dish.setActive(active);
        dish.setUpdatedAt(Instant.now(clock));
        dishes.save(dish);
        catalog.evict();
        return toView(dish);
    }

    private void apply(Dish dish, AdminDtos.DishWriteRequest request) {
        Enums.Category category = Enums.Category.fromValue(request.category());
        if (category == null) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                    Map.of("category", "Unknown category: " + request.category()));
        }
        Enums.SpiceLevel spice = parseEnum(request.spiceLevel(), Enums.SpiceLevel.class, "spiceLevel");
        List<String> allergens = request.allergens() == null ? List.of()
                : request.allergens().stream()
                        .map(value -> parseEnum(value, Enums.Allergen.class, "allergens").name())
                        .distinct()
                        .toList();

        dish.setName(request.name().trim());
        dish.setDescription(request.description().trim());
        dish.setPrice(Money.fromCents(request.priceCents()));
        dish.setCategory(category.value());
        dish.setProtein(request.protein() == null ? "" : request.protein().trim());
        dish.setAllergens(Json.toCsv(allergens));
        dish.setSpiceLevel(spice);
        dish.setImageUrl(request.imageUrl() == null || request.imageUrl().isBlank() ? null : request.imageUrl().trim());
        if (request.active() != null) {
            dish.setActive(request.active());
        }
        dish.setUpdatedAt(Instant.now(clock));

        if (request.optionGroups() != null) {
            dish.clearOptionGroups();
            int groupOrder = 0;
            for (AdminDtos.OptionGroupWrite groupRequest : request.optionGroups()) {
                DishOptionGroup group = new DishOptionGroup();
                group.setName(groupRequest.name().trim());
                group.setRequired(groupRequest.required());
                group.setMultiSelect(groupRequest.multiSelect());
                group.setSortOrder(groupOrder++);
                Set<String> optionNames = new HashSet<>();
                int optionOrder = 0;
                for (AdminDtos.OptionWrite optionRequest : groupRequest.options() == null ? List.<AdminDtos.OptionWrite>of() : groupRequest.options()) {
                    String optionName = optionRequest.name().trim();
                    if (!optionNames.add(optionName.toLowerCase())) {
                        throw ApiException.badRequest("DUPLICATE_OPTION_NAME",
                                "Option \"" + optionName + "\" appears twice in group \"" + group.getName() + "\".",
                                Map.of("optionGroups", "Duplicate option name: " + optionName));
                    }
                    DishOption option = new DishOption();
                    option.setName(optionName);
                    option.setExtraPrice(Money.fromCents(optionRequest.extraPriceCents()));
                    option.setSortOrder(optionOrder++);
                    group.addOption(option);
                }
                dish.addOptionGroup(group);
            }
        }
    }

    private static <E extends Enum<E>> E parseEnum(String value, Class<E> type, String field) {
        if (value == null || value.isBlank()) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                    Map.of(field, "A value is required."));
        }
        for (E candidate : type.getEnumConstants()) {
            if (candidate.name().equalsIgnoreCase(value.trim())) {
                return candidate;
            }
        }
        throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                Map.of(field, "Unsupported value: " + value));
    }

    static AdminDtos.AdminDishView toView(Dish dish) {
        return new AdminDtos.AdminDishView(
                dish.getId(), dish.getName(), dish.getDescription(), Money.toCents(dish.getPrice()),
                dish.getCategory(), dish.getProtein(), Json.toList(dish.getAllergens()),
                dish.getSpiceLevel().name(), dish.getImageUrl(), dish.isActive(),
                dish.getUpdatedAt().toString(), CatalogService.toOptionGroups(dish.getOptionGroups()));
    }
}
