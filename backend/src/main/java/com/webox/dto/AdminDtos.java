package com.webox.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/** Console write/read models for catalogue and daily-menu management. */
public final class AdminDtos {

    private AdminDtos() {}

    public record OptionWrite(
            @NotBlank(message = "Option name is required.")
            @Size(max = 60, message = "Option name must be at most 60 characters.") String name,
            @Min(value = 0, message = "Extra price must not be negative.")
            @Max(value = 100_000, message = "Extra price must be at most ¥1000.00.") long extraPriceCents) {}

    public record OptionGroupWrite(
            @NotBlank(message = "Option group name is required.")
            @Size(max = 60, message = "Option group name must be at most 60 characters.") String name,
            boolean required,
            boolean multiSelect,
            @Size(max = 20, message = "An option group can have at most 20 options.")
            @Valid List<OptionWrite> options) {}

    public record DishWriteRequest(
            @NotBlank(message = "Dish name is required.")
            @Size(max = 120, message = "Dish name must be at most 120 characters.") String name,
            @NotBlank(message = "Description is required.")
            @Size(max = 500, message = "Description must be at most 500 characters.") String description,
            @Min(value = 0, message = "Price must not be negative.")
            @Max(value = 100_000, message = "Price must be at most ¥1000.00.") long priceCents,
            @NotBlank(message = "Category is required.") String category,
            @Size(max = 120, message = "Protein must be at most 120 characters.") String protein,
            List<String> allergens,
            @NotBlank(message = "Spice level is required.") String spiceLevel,
            @Size(max = 300, message = "Image URL must be at most 300 characters.") String imageUrl,
            Boolean active,
            @Size(max = 8, message = "A dish can have at most 8 option groups.")
            @Valid List<OptionGroupWrite> optionGroups) {}

    public record AdminDishView(Long id, String name, String description, long priceCents, String category,
                                String protein, List<String> allergens, String spiceLevel, String imageUrl,
                                boolean active, String updatedAt, List<MenuDtos.OptionGroupView> optionGroups) {}

    public record AdminDishPage(int page, int size, long totalElements, int totalPages, List<AdminDishView> items) {}

    public record DailyMenuItemWrite(
            @NotNull(message = "Dish is required.") Long dishId,
            @Min(value = 0, message = "Quantity must not be negative.")
            @Max(value = 10_000, message = "Quantity must be at most 10000.") int totalQuantity) {}

    public record DailyMenuWriteRequest(
            @NotNull(message = "Date is required.") LocalDate date,
            @Size(max = 200, message = "Too many dishes for one day.")
            @Valid List<DailyMenuItemWrite> items) {}

    public record DailyMenuRow(Long menuId, Long dishId, String dishName, String category, String imageUrl,
                               long priceCents, int totalQuantity, int soldQuantity, int remaining, boolean active) {}

    public record DailyMenuResponse(String date, List<DailyMenuRow> items) {}

    public record UploadResponse(String url, long size, String contentType) {}
}
