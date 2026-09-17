package com.webox.dto;

import com.webox.domain.Enums;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/** Checkout, order history and ordering-rule views. */
public final class OrderDtos {

    private OrderDtos() {}

    public record OrderItemRequest(
            @NotNull(message = "Menu item is required.") Long menuId,
            @Min(value = 1, message = "Quantity must be at least 1.")
            @Max(value = 5, message = "Quantity must be at most 5.") int quantity,
            List<Long> optionIds) {}

    public record PlaceOrderRequest(
            @NotNull(message = "Delivery date is required.") LocalDate deliveryDate,
            @NotNull(message = "Meal period is required.") Enums.MealPeriod mealPeriod,
            @NotBlank(message = "Delivery address is required.")
            @Size(max = 200, message = "Address must be at most 200 characters.")
            String address,
            @NotEmpty(message = "Your cart is empty.")
            @Size(max = 10, message = "An order can contain at most 10 different dishes.")
            @Valid List<OrderItemRequest> items) {}

    public record OrderOptionView(String groupName, String optionName, long extraPriceCents) {}

    public record OrderItemView(Long dishId, String dishName, String imageUrl, int quantity,
                                long basePriceCents, long optionsPriceCents, long unitPriceCents,
                                long subtotalCents, List<OrderOptionView> options) {}

    public record OrderView(Long id, String orderNo, Enums.OrderStatus status, LocalDate deliveryDate,
                            Enums.MealPeriod mealPeriod, String address, long totalCents, int totalQuantity,
                            String createdAt, String itemSummary, List<OrderItemView> items) {}

    public record OrderPage(int page, int size, long totalElements, int totalPages, List<OrderView> items) {}

    public record PlaceOrderResponse(OrderView order, boolean replayed,
                                     LocalDate requestedDeliveryDate, Enums.MealPeriod requestedMealPeriod) {}

    public record ActiveOrderRef(Long orderId, String orderNo, Enums.OrderStatus status) {}

    public record OrderRulesView(int maxQuantityPerOrder, String lunchCutoff, String dinnerCutoff) {}

    public record OrderContextResponse(MenuDtos.SlotView nextSlot, boolean requestedSlotBookable,
                                       boolean autoSwitched, ActiveOrderRef existingActiveOrder,
                                       OrderRulesView rules) {}
}
