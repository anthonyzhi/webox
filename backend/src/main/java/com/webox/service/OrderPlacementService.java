package com.webox.service;

import com.webox.common.ApiException;
import com.webox.common.ErrorResponse;
import com.webox.common.Json;
import com.webox.common.Money;
import com.webox.domain.DailyMenu;
import com.webox.domain.Enums;
import com.webox.domain.Order;
import com.webox.domain.OrderItem;
import com.webox.dto.MenuDtos;
import com.webox.dto.OrderDtos;
import com.webox.repository.DailyMenuRepository;
import com.webox.repository.DishRepository;
import com.webox.repository.OrderRepository;
import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The transactional half of order placement. Kept separate from {@link OrderService} so that the
 * idempotency retry can run <em>outside</em> the failed transaction: once a unique-index violation has
 * marked the transaction rollback-only, the recovery lookup must happen in a fresh one.
 */
@Service
public class OrderPlacementService {

    private static final DateTimeFormatter ORDER_NO_DATE = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final OrderRepository orders;
    private final DailyMenuRepository menu;
    private final DishRepository dishes;
    private final CatalogService catalog;
    private final PreferenceService preferences;
    private final MealSlotService slots;
    private final StockStreamService stockStream;
    private final Clock clock;

    public OrderPlacementService(OrderRepository orders, DailyMenuRepository menu, DishRepository dishes,
                                 CatalogService catalog, PreferenceService preferences, MealSlotService slots,
                                 StockStreamService stockStream, Clock clock) {
        this.orders = orders;
        this.menu = menu;
        this.dishes = dishes;
        this.catalog = catalog;
        this.preferences = preferences;
        this.slots = slots;
        this.stockStream = stockStream;
        this.clock = clock;
    }

    @Transactional
    public OrderDtos.PlaceOrderResponse place(Long userId, String idempotencyKey, OrderDtos.PlaceOrderRequest request) {
        MealSlotService.Slot resolved = slots.resolve(request.deliveryDate(), request.mealPeriod());
        int totalQuantity = request.items().stream().mapToInt(OrderDtos.OrderItemRequest::quantity).sum();
        if (totalQuantity > MealSlotService.MAX_QUANTITY_PER_ORDER) {
            throw ApiException.conflict("MAX_QUANTITY_EXCEEDED",
                    "An order can contain at most " + MealSlotService.MAX_QUANTITY_PER_ORDER + " servings in total.");
        }

        Map<Long, Integer> quantityByMenuId = new LinkedHashMap<>();
        for (OrderDtos.OrderItemRequest item : request.items()) {
            quantityByMenuId.merge(item.menuId(), item.quantity(), Integer::sum);
        }

        Map<Long, DailyMenu> rows = new LinkedHashMap<>();
        menu.findAllById(quantityByMenuId.keySet()).forEach(row -> rows.put(row.getId(), row));

        List<OrderItem> orderItems = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO.setScale(2);
        for (OrderDtos.OrderItemRequest item : request.items()) {
            DailyMenu row = rows.get(item.menuId());
            if (row == null) {
                throw ApiException.notFound("MENU_ITEM_NOT_FOUND", "One of the selected dishes is no longer on the menu.");
            }
            if (!row.getMenuDate().equals(resolved.date())) {
                throw ApiException.conflict("MENU_CLOSED",
                        row.getDish().getName() + " is not available on the selected date.");
            }
            MenuDtos.DishCore core = catalog.catalog().get(row.getDish().getId());
            if (core == null) {
                throw ApiException.conflict("MENU_CLOSED",
                        row.getDish().getName() + " is no longer available on the menu.");
            }
            List<OrderDtos.OrderOptionView> chosen = resolveOptions(item, core);
            long optionsCents = chosen.stream().mapToLong(OrderDtos.OrderOptionView::extraPriceCents).sum();
            long unitCents = core.priceCents() + optionsCents;
            long subtotalCents = unitCents * item.quantity();

            OrderItem entity = new OrderItem();
            entity.setDishId(core.id());
            entity.setMenuId(row.getId());
            entity.setDishName(core.name());
            entity.setImageUrl(core.imageUrl());
            entity.setQuantity(item.quantity());
            entity.setBasePrice(Money.fromCents(core.priceCents()));
            entity.setOptionsPrice(Money.fromCents(optionsCents));
            entity.setUnitPrice(Money.fromCents(unitCents));
            entity.setSubtotal(Money.fromCents(subtotalCents));
            entity.setOptionsJson(Json.write(chosen));
            orderItems.add(entity);
            total = total.add(Money.fromCents(subtotalCents));
        }

        ensureStockAvailable(quantityByMenuId, rows);
        ensureNoActiveOrder(userId, resolved);

        Order order = new Order();
        order.setOrderNo(nextOrderNo(resolved.date()));
        order.setUserId(userId);
        order.setIdempotencyKey(idempotencyKey);
        order.setStatus(Enums.OrderStatus.Pending);
        order.setDeliveryDate(resolved.date());
        order.setMealPeriod(resolved.period());
        order.setAddress(request.address().trim());
        order.setTotalQuantity(totalQuantity);
        order.setTotalAmount(total);
        order.setActiveSlot(Order.slotKey(userId, resolved.date(), resolved.period()));
        order.setCreatedAt(java.time.Instant.now(clock));
        order.setUpdatedAt(java.time.Instant.now(clock));
        orderItems.forEach(order::addItem);
        // Flushing here surfaces the unique-index violations inside this transaction, where the
        // caller can translate them into "already submitted" / "already ordered this slot".
        orders.saveAndFlush(order);

        reserveStock(quantityByMenuId, rows);

        preferences.rememberAddress(userId, request.address());
        stockStream.publishAfterCommit(resolved.date(), quantityByMenuId.keySet());

        return new OrderDtos.PlaceOrderResponse(OrderService.toView(order, order.getItems()), false,
                request.deliveryDate(), request.mealPeriod());
    }

    /** Resolves the employee's option picks against the dish definition and prices them. */
    private List<OrderDtos.OrderOptionView> resolveOptions(OrderDtos.OrderItemRequest item, MenuDtos.DishCore core) {
        List<Long> requested = item.optionIds() == null ? List.of() : item.optionIds().stream().distinct().toList();
        List<OrderDtos.OrderOptionView> chosen = new ArrayList<>();
        for (MenuDtos.OptionGroupView group : core.optionGroups()) {
            List<MenuDtos.OptionView> picked = group.options().stream()
                    .filter(option -> requested.contains(option.id()))
                    .toList();
            if (picked.size() > 1 && !group.multiSelect()) {
                throw invalidOption(core, group.name(), "Only one option can be selected.");
            }
            if (picked.isEmpty() && group.required()) {
                throw invalidOption(core, group.name(), "This option group is required.");
            }
            picked.forEach(option -> chosen.add(
                    new OrderDtos.OrderOptionView(group.name(), option.name(), option.extraPriceCents())));
        }
        List<Long> known = core.optionGroups().stream()
                .flatMap(group -> group.options().stream())
                .map(MenuDtos.OptionView::id)
                .toList();
        for (Long id : requested) {
            if (!known.contains(id)) {
                throw invalidOption(core, null, "Unknown option selected.");
            }
        }
        return chosen;
    }

    private ApiException invalidOption(MenuDtos.DishCore core, String groupName, String message) {
        return ApiException.badRequest("INVALID_OPTIONS",
                "The options selected for " + core.name() + " are not valid.",
                new ErrorResponse.InvalidOption(core.id(), groupName, message));
    }

    private void ensureStockAvailable(Map<Long, Integer> quantityByMenuId, Map<Long, DailyMenu> rows) {
        List<ErrorResponse.StockShortage> shortages = new ArrayList<>();
        quantityByMenuId.forEach((menuId, quantity) -> {
            DailyMenu row = rows.get(menuId);
            if (row != null && row.remaining() < quantity) {
                shortages.add(new ErrorResponse.StockShortage(menuId, row.getDish().getName(), quantity, row.remaining()));
            }
        });
        if (!shortages.isEmpty()) {
            throw ApiException.conflict("INSUFFICIENT_STOCK",
                    "Some dishes do not have enough portions left.", new ErrorResponse.ListDetails(shortages));
        }
    }

    private void ensureNoActiveOrder(Long userId, MealSlotService.Slot slot) {
        List<Order> active = orders.findByUserIdAndDeliveryDateAndMealPeriodAndStatusIn(
                userId, slot.date(), slot.period(), List.of(Enums.OrderStatus.Pending, Enums.OrderStatus.Confirmed));
        if (!active.isEmpty()) {
            Order existing = active.get(0);
            throw ApiException.conflict("ACTIVE_ORDER_EXISTS",
                    "You already have an order for " + slots.label(slot.date(), slot.period()) + ".",
                    new ErrorResponse.ActiveOrderRef(existing.getId(), existing.getOrderNo(),
                            existing.getStatus().name()));
        }
    }

    /**
     * Consumes stock with a guarded UPDATE: the WHERE clause only matches while enough portions
     * remain, so concurrent orders for the same dish serialise on the row and the losing request is
     * told exactly which dish ran out — it can never oversell.
     */
    private void reserveStock(Map<Long, Integer> quantityByMenuId, Map<Long, DailyMenu> rows) {
        LocalDateTime now = LocalDateTime.now(clock);
        List<ErrorResponse.StockShortage> shortages = new ArrayList<>();
        quantityByMenuId.forEach((menuId, quantity) -> {
            int updated = menu.reserveStock(menuId, quantity, now);
            if (updated == 0) {
                DailyMenu row = menu.findById(menuId).orElse(rows.get(menuId));
                String name = row == null ? rows.get(menuId).getDish().getName() : row.getDish().getName();
                shortages.add(new ErrorResponse.StockShortage(menuId, name, quantity,
                        row == null ? 0 : row.remaining()));
            }
        });
        if (!shortages.isEmpty()) {
            throw ApiException.conflict("INSUFFICIENT_STOCK",
                    "Some dishes sold out while you were checking out.", new ErrorResponse.ListDetails(shortages));
        }
    }

    private String nextOrderNo(java.time.LocalDate date) {
        return "WB" + date.format(ORDER_NO_DATE) + String.format("%06d", RANDOM.nextInt(1_000_000));
    }
}
