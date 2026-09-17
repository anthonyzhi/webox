package com.webox.service;

import com.webox.common.ApiException;
import com.webox.common.ErrorResponse;
import com.webox.common.Json;
import com.webox.common.Money;
import com.webox.domain.Enums;
import com.webox.domain.Order;
import com.webox.domain.OrderItem;
import com.webox.dto.OrderDtos;
import com.webox.repository.DailyMenuRepository;
import com.webox.repository.OrderItemRepository;
import com.webox.repository.OrderRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Checkout rules, order history and cancellation. */
@Service
public class OrderService {

    private static final int MAX_PAGE_SIZE = 50;
    private static final String IDEMPOTENCY_KEY_PATTERN = "[A-Za-z0-9_-]{8,80}";

    private final OrderRepository orders;
    private final OrderItemRepository orderItems;
    private final OrderPlacementService placement;
    private final DailyMenuRepository menu;
    private final MealSlotService slots;
    private final MenuService menuService;
    private final StockStreamService stockStream;
    private final Clock clock;

    public OrderService(OrderRepository orders, OrderItemRepository orderItems, OrderPlacementService placement,
                        DailyMenuRepository menu, MealSlotService slots, MenuService menuService,
                        StockStreamService stockStream, Clock clock) {
        this.orders = orders;
        this.orderItems = orderItems;
        this.placement = placement;
        this.menu = menu;
        this.slots = slots;
        this.menuService = menuService;
        this.stockStream = stockStream;
        this.clock = clock;
    }

    /**
     * Submits an order at most once per idempotency key.
     * <p>Three layers guard against a double-click or a retried request: the browser disables the
     * button and reuses one key per checkout attempt; the key is looked up before doing any work; and
     * the {@code uk_orders_user_idempotency} unique index makes a racing duplicate impossible — if two
     * requests slip through together, the loser catches the constraint violation and returns the
     * winner's order instead of creating a second one.
     */
    public OrderDtos.PlaceOrderResponse place(Long userId, String idempotencyKey, OrderDtos.PlaceOrderRequest request) {
        String key = idempotencyKey == null ? "" : idempotencyKey.trim();
        if (!key.matches(IDEMPOTENCY_KEY_PATTERN)) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                    Map.of("Idempotency-Key", "Provide an 8-80 character idempotency key of letters, digits, '-' or '_'."));
        }
        Order replay = orders.findByUserIdAndIdempotencyKey(userId, key).orElse(null);
        if (replay != null) {
            return replayOf(replay);
        }
        try {
            return placement.place(userId, key, request);
        } catch (DataIntegrityViolationException e) {
            Order raced = orders.findByUserIdAndIdempotencyKey(userId, key).orElse(null);
            if (raced != null) {
                return replayOf(raced);
            }
            MealSlotService.Slot resolved = slots.resolve(request.deliveryDate(), request.mealPeriod());
            Order active = activeOrder(userId, resolved);
            if (active != null) {
                throw ApiException.conflict("ACTIVE_ORDER_EXISTS",
                        "You already have an order for " + slots.label(resolved.date(), resolved.period()) + ".",
                        new ErrorResponse.ActiveOrderRef(active.getId(), active.getOrderNo(), active.getStatus().name()));
            }
            throw e;
        }
    }

    /** Tells checkout which slot will actually be booked and whether an order already exists for it. */
    @Transactional(readOnly = true)
    public OrderDtos.OrderContextResponse context(Long userId, LocalDate requestedDate, Enums.MealPeriod requestedPeriod) {
        MealSlotService.Slot next = slots.nextBookableSlot();
        MealSlotService.Slot requested = new MealSlotService.Slot(
                requestedDate == null ? next.date() : requestedDate,
                requestedPeriod == null ? next.period() : requestedPeriod);
        MealSlotService.Slot resolved = slots.resolve(requested.date(), requested.period());
        boolean autoSwitched = !resolved.equals(requested);
        Order active = activeOrder(userId, resolved);
        OrderDtos.ActiveOrderRef existing = active == null ? null
                : new OrderDtos.ActiveOrderRef(active.getId(), active.getOrderNo(), active.getStatus());
        return new OrderDtos.OrderContextResponse(menuService.slotView(resolved, autoSwitched),
                slots.isBookable(requested.date(), requested.period()), autoSwitched, existing,
                new OrderDtos.OrderRulesView(MealSlotService.MAX_QUANTITY_PER_ORDER,
                        MealSlotService.LUNCH_CUTOFF.toString(), MealSlotService.DINNER_CUTOFF.toString()));
    }

    @Transactional(readOnly = true)
    public OrderDtos.OrderPage list(Long userId, int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), MAX_PAGE_SIZE),
                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")));
        Page<Order> result = orders.findByUserId(userId, pageable);
        List<Long> ids = result.getContent().stream().map(Order::getId).toList();
        Map<Long, List<OrderItem>> byOrder = ids.isEmpty() ? Map.of()
                : orderItems.findByOrderIdIn(ids).stream()
                        .collect(Collectors.groupingBy(item -> item.getOrder().getId()));
        List<OrderDtos.OrderView> items = result.getContent().stream()
                .map(order -> toView(order, byOrder.getOrDefault(order.getId(), List.of())))
                .toList();
        return new OrderDtos.OrderPage(result.getNumber(), result.getSize(), result.getTotalElements(),
                result.getTotalPages(), items);
    }

    @Transactional(readOnly = true)
    public OrderDtos.OrderView detail(Long userId, Long orderId) {
        Order order = requireOwned(userId, orderId);
        return toView(order, order.getItems());
    }

    /** Cancels a pending order and returns its portions to the day's menu. */
    @Transactional
    public OrderDtos.OrderView cancel(Long userId, Long orderId) {
        Order order = requireOwned(userId, orderId);
        if (order.getStatus() != Enums.OrderStatus.Pending) {
            throw ApiException.conflict("ORDER_NOT_CANCELLABLE",
                    "Only pending orders can be cancelled. This order is " + order.getStatus() + ".");
        }
        order.setStatus(Enums.OrderStatus.Cancelled);
        order.setActiveSlot(null);
        order.setUpdatedAt(Instant.now(clock));
        orders.save(order);

        LocalDateTime now = LocalDateTime.now(clock);
        List<OrderItem> items = order.getItems();
        List<Long> menuIds = new java.util.ArrayList<>();
        for (OrderItem item : items) {
            if (item.getMenuId() != null) {
                menu.releaseStock(item.getMenuId(), item.getQuantity(), now);
                menuIds.add(item.getMenuId());
            }
        }
        stockStream.publishAfterCommit(order.getDeliveryDate(), menuIds);
        return toView(order, items);
    }

    private OrderDtos.PlaceOrderResponse replayOf(Order order) {
        Order withItems = orders.findWithItemsById(order.getId()).orElse(order);
        return new OrderDtos.PlaceOrderResponse(toView(withItems, withItems.getItems()), true,
                withItems.getDeliveryDate(), withItems.getMealPeriod());
    }

    private Order requireOwned(Long userId, Long orderId) {
        return orders.findWithItemsById(orderId)
                .filter(order -> order.getUserId().equals(userId))
                .orElseThrow(() -> ApiException.notFound("ORDER_NOT_FOUND", "Order not found."));
    }

    private Order activeOrder(Long userId, MealSlotService.Slot slot) {
        List<Order> active = orders.findByUserIdAndDeliveryDateAndMealPeriodAndStatusIn(
                userId, slot.date(), slot.period(), List.of(Enums.OrderStatus.Pending, Enums.OrderStatus.Confirmed));
        return active.isEmpty() ? null : active.get(0);
    }

    static OrderDtos.OrderView toView(Order order, List<OrderItem> items) {
        List<OrderDtos.OrderItemView> itemViews = items.stream().map(OrderService::toItemView).toList();
        String summary = itemViews.isEmpty() ? ""
                : itemViews.stream().map(item -> item.quantity() + "× " + item.dishName())
                        .collect(Collectors.joining(", "));
        return new OrderDtos.OrderView(
                order.getId(), order.getOrderNo(), order.getStatus(), order.getDeliveryDate(), order.getMealPeriod(),
                order.getAddress(), Money.toCents(order.getTotalAmount()), order.getTotalQuantity(),
                order.getCreatedAt().toString(), summary, itemViews);
    }

    private static OrderDtos.OrderItemView toItemView(OrderItem item) {
        List<OrderDtos.OrderOptionView> options = Json.readMapList(item.getOptionsJson()).stream()
                .map(option -> new OrderDtos.OrderOptionView(
                        String.valueOf(option.get("groupName")),
                        String.valueOf(option.get("optionName")),
                        ((Number) option.getOrDefault("extraPriceCents", 0)).longValue()))
                .toList();
        return new OrderDtos.OrderItemView(
                item.getDishId(), item.getDishName(), item.getImageUrl(), item.getQuantity(),
                Money.toCents(item.getBasePrice()), Money.toCents(item.getOptionsPrice()),
                Money.toCents(item.getUnitPrice()), Money.toCents(item.getSubtotal()), options);
    }
}
