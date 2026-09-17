package com.webox.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/** Uniform error envelope: {code, message, fieldErrors?, details?}. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(String code, String message, Map<String, String> fieldErrors, Object details) {

    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(code, message, null, null);
    }

    public static ErrorResponse fields(String code, String message, Map<String, String> fieldErrors) {
        return new ErrorResponse(code, message, fieldErrors, null);
    }

    public static ErrorResponse field(String code, String message, String field, String fieldMessage) {
        return new ErrorResponse(code, message, Map.of(field, fieldMessage), null);
    }

    public static ErrorResponse withDetails(String code, String message, Object details) {
        return new ErrorResponse(code, message, null, details);
    }

    public record StockShortage(long menuId, String dishName, int requested, int remaining) {}

    public record ActiveOrderRef(long orderId, String orderNo, String status) {}

    public record InvalidOption(long menuId, String groupName, String message) {}

    public record ListDetails(List<StockShortage> items) {}
}
