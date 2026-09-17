package com.webox.service;

import com.webox.common.Money;
import com.webox.domain.Enums;
import com.webox.dto.PreferenceDtos;
import com.webox.repository.DailyMenuRepository;
import com.webox.repository.OrderItemRepository;
import com.webox.repository.OrderRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Console dashboard. Every figure is aggregated from the real {@code orders}/{@code order_items} tables
 * (cancelled orders are excluded from revenue and rankings), so the board cannot drift from the data.
 */
@Service
public class DashboardService {

    private static final int TOP_DISHES = 10;
    private static final int TREND_DAYS = 7;

    private final OrderRepository orders;
    private final OrderItemRepository orderItems;
    private final DailyMenuRepository menu;
    private final Clock clock;

    public DashboardService(OrderRepository orders, OrderItemRepository orderItems, DailyMenuRepository menu,
                            Clock clock) {
        this.orders = orders;
        this.orderItems = orderItems;
        this.menu = menu;
        this.clock = clock;
    }

    /** {@code date} is the day the orders were <em>placed</em>, which is what the canteen plans around. */
    @Transactional(readOnly = true)
    public PreferenceDtos.DashboardResponse dashboard(LocalDate date) {
        ZoneId zone = clock.getZone();
        Instant from = date.atStartOfDay(zone).toInstant();
        Instant to = date.plusDays(1).atStartOfDay(zone).toInstant();

        long orderCount = orders.countPlaced(from, to, Enums.OrderStatus.Cancelled);
        long revenue = Money.toCents(orders.revenuePlaced(from, to, Enums.OrderStatus.Cancelled));

        Map<Enums.OrderStatus, Long> byStatus = new EnumMap<>(Enums.OrderStatus.class);
        for (Object[] row : orders.countByStatus(from, to)) {
            byStatus.put((Enums.OrderStatus) row[0], ((Number) row[1]).longValue());
        }
        PreferenceDtos.DashboardToday today = new PreferenceDtos.DashboardToday(orderCount, revenue,
                byStatus.getOrDefault(Enums.OrderStatus.Completed, 0L),
                byStatus.getOrDefault(Enums.OrderStatus.Pending, 0L),
                byStatus.getOrDefault(Enums.OrderStatus.Confirmed, 0L),
                byStatus.getOrDefault(Enums.OrderStatus.Cancelled, 0L));

        List<PreferenceDtos.TopDish> top = orderItems
                .topDishes(from, to, Enums.OrderStatus.Cancelled, PageRequest.of(0, TOP_DISHES)).stream()
                .map(row -> new PreferenceDtos.TopDish((String) row[0], ((Number) row[1]).longValue(),
                        Money.toCents((java.math.BigDecimal) row[2])))
                .toList();

        Map<Enums.MealPeriod, Object[]> periods = new EnumMap<>(Enums.MealPeriod.class);
        for (Object[] row : orders.breakdownByMealPeriod(from, to, Enums.OrderStatus.Cancelled)) {
            periods.put((Enums.MealPeriod) row[0], row);
        }
        List<PreferenceDtos.MealPeriodStat> mealPeriod = new ArrayList<>();
        for (Enums.MealPeriod period : Enums.MealPeriod.values()) {
            Object[] row = periods.get(period);
            mealPeriod.add(new PreferenceDtos.MealPeriodStat(period,
                    row == null ? 0 : ((Number) row[1]).longValue(),
                    row == null ? 0 : Money.toCents((java.math.BigDecimal) row[2])));
        }

        List<PreferenceDtos.TrendPoint> trend = new ArrayList<>();
        for (int i = TREND_DAYS - 1; i >= 0; i--) {
            LocalDate day = date.minusDays(i);
            Instant dayFrom = day.atStartOfDay(zone).toInstant();
            Instant dayTo = day.plusDays(1).atStartOfDay(zone).toInstant();
            trend.add(new PreferenceDtos.TrendPoint(day.toString(),
                    orders.countPlaced(dayFrom, dayTo, Enums.OrderStatus.Cancelled),
                    Money.toCents(orders.revenuePlaced(dayFrom, dayTo, Enums.OrderStatus.Cancelled))));
        }

        List<PreferenceDtos.LowStockRow> lowStock = menu.findLowStock(date, MealSlotService.LOW_STOCK_THRESHOLD).stream()
                .map(row -> new PreferenceDtos.LowStockRow(row.getId(), row.getDish().getName(), row.remaining()))
                .toList();

        return new PreferenceDtos.DashboardResponse(date.toString(), today, top, mealPeriod, trend, lowStock);
    }

    /** Convenience for tests and future reports: today according to the canteen timezone. */
    public LocalDate today() {
        return LocalDate.now(clock);
    }
}
