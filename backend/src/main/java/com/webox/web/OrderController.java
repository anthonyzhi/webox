package com.webox.web;

import com.webox.domain.Enums;
import com.webox.domain.User;
import com.webox.dto.OrderDtos;
import com.webox.service.OrderService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    /** Used by the checkout screen to show the booked slot and any existing order for it. */
    @GetMapping("/context")
    public OrderDtos.OrderContextResponse context(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate deliveryDate,
            @RequestParam(required = false) Enums.MealPeriod mealPeriod) {
        return orderService.context(user.getId(), deliveryDate, mealPeriod);
    }

    @PostMapping
    public ResponseEntity<OrderDtos.PlaceOrderResponse> place(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody OrderDtos.PlaceOrderRequest request) {
        OrderDtos.PlaceOrderResponse response = orderService.place(user.getId(), idempotencyKey, request);
        return ResponseEntity.status(response.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(response);
    }

    @GetMapping
    public OrderDtos.OrderPage list(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return orderService.list(user.getId(), page, size);
    }

    @GetMapping("/{orderId}")
    public OrderDtos.OrderView detail(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @PathVariable Long orderId) {
        return orderService.detail(user.getId(), orderId);
    }

    @PostMapping("/{orderId}/cancel")
    public OrderDtos.OrderView cancel(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @PathVariable Long orderId) {
        return orderService.cancel(user.getId(), orderId);
    }
}
