package com.webox.service;

import com.webox.common.ApiException;
import com.webox.common.Money;
import com.webox.domain.DailyMenu;
import com.webox.domain.Dish;
import com.webox.dto.AdminDtos;
import com.webox.repository.DailyMenuRepository;
import com.webox.repository.DishRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * "Set daily menu": decides which dishes are served on a given day and how many portions exist.
 * <p>Deliberately tolerant of both fresh saves and adjustments — the same screen initialises today's
 * menu (so a demo has something to order) and prepares tomorrow's.
 */
@Service
public class AdminMenuService {

    private final DailyMenuRepository menu;
    private final DishRepository dishes;
    private final StockStreamService stockStream;
    private final Clock clock;

    public AdminMenuService(DailyMenuRepository menu, DishRepository dishes, StockStreamService stockStream,
                            Clock clock) {
        this.menu = menu;
        this.dishes = dishes;
        this.stockStream = stockStream;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AdminDtos.DailyMenuResponse dailyMenu(LocalDate date) {
        List<AdminDtos.DailyMenuRow> rows = menu.findByMenuDate(date).stream()
                .map(AdminMenuService::toRow)
                .toList();
        return new AdminDtos.DailyMenuResponse(date.toString(), rows);
    }

    @Transactional
    public AdminDtos.DailyMenuResponse setDailyMenu(AdminDtos.DailyMenuWriteRequest request) {
        LocalDate date = request.date();
        List<AdminDtos.DailyMenuItemWrite> requested = request.items() == null ? List.of() : request.items();
        Set<Long> requestedIds = new HashSet<>();
        for (AdminDtos.DailyMenuItemWrite item : requested) {
            requestedIds.add(item.dishId());
        }

        Map<Long, Dish> dishById = new LinkedHashMap<>();
        dishes.findByIdIn(requestedIds).forEach(dish -> dishById.put(dish.getId(), dish));
        for (Long id : requestedIds) {
            if (!dishById.containsKey(id)) {
                throw ApiException.notFound("DISH_NOT_FOUND", "Dish " + id + " does not exist.");
            }
        }

        Map<Long, DailyMenu> existing = new LinkedHashMap<>();
        menu.findByMenuDate(date).forEach(row -> existing.put(row.getDish().getId(), row));

        // Dropping a dish that already sold portions would corrupt the takings — refuse instead.
        List<String> soldOut = new ArrayList<>();
        existing.forEach((dishId, row) -> {
            if (!requestedIds.contains(dishId) && row.getSoldQuantity() > 0) {
                soldOut.add(row.getDish().getName());
            }
        });
        if (!soldOut.isEmpty()) {
            throw ApiException.conflict("MENU_HAS_SALES",
                    "These dishes already have orders on " + date + " and cannot be removed: " + String.join(", ", soldOut) + ".");
        }

        for (AdminDtos.DailyMenuItemWrite item : requested) {
            DailyMenu row = existing.get(item.dishId());
            if (row == null) {
                row = new DailyMenu();
                row.setMenuDate(date);
                row.setDish(dishById.get(item.dishId()));
                row.setSoldQuantity(0);
            }
            if (item.totalQuantity() < row.getSoldQuantity()) {
                throw ApiException.conflict("MENU_HAS_SALES",
                        row.getDish().getName() + " already has " + row.getSoldQuantity()
                                + " portions ordered, so the quantity cannot be lowered below that.");
            }
            row.setTotalQuantity(item.totalQuantity());
            row.setUpdatedAt(Instant.now(clock));
            menu.save(row);
        }
        existing.forEach((dishId, row) -> {
            if (!requestedIds.contains(dishId)) {
                menu.delete(row);
            }
        });

        List<Long> affected = new ArrayList<>(existing.keySet());
        affected.addAll(requestedIds);
        stockStream.publishAfterCommit(date, affected);
        return dailyMenu(date);
    }

    static AdminDtos.DailyMenuRow toRow(DailyMenu row) {
        return new AdminDtos.DailyMenuRow(row.getId(), row.getDish().getId(), row.getDish().getName(),
                row.getDish().getCategory(), row.getDish().getImageUrl(),
                Money.toCents(row.getDish().getPrice()), row.getTotalQuantity(), row.getSoldQuantity(),
                row.remaining(), row.getDish().isActive());
    }
}
