package com.webox.web;

import com.webox.domain.Enums;
import com.webox.dto.AdminDtos;
import com.webox.service.AdminDishService;
import com.webox.service.StorageService;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Console catalogue management. The class-level role requirement keeps employees out of the Console. */
@RestController
@RequestMapping("/api/admin")
@RequireRole(Enums.Role.ADMIN)
public class AdminDishController {

    private final AdminDishService dishService;
    private final StorageService storageService;

    public AdminDishController(AdminDishService dishService, StorageService storageService) {
        this.dishService = dishService;
        this.storageService = storageService;
    }

    @GetMapping("/dishes")
    public AdminDtos.AdminDishPage list(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) Boolean active,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return dishService.page(q, category, active, page, size);
    }

    @PostMapping("/dishes")
    public ResponseEntity<AdminDtos.AdminDishView> create(@Valid @RequestBody AdminDtos.DishWriteRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(dishService.create(request));
    }

    @PutMapping("/dishes/{id}")
    public AdminDtos.AdminDishView update(@PathVariable Long id,
                                          @Valid @RequestBody AdminDtos.DishWriteRequest request) {
        return dishService.update(id, request);
    }

    @PatchMapping("/dishes/{id}/status")
    public AdminDtos.AdminDishView updateStatus(@PathVariable Long id,
                                                @RequestBody Map<String, Boolean> body) {
        Boolean active = body.get("active");
        if (active == null) {
            throw com.webox.common.ApiException.badRequest("VALIDATION_ERROR", "Please check the highlighted fields.",
                    Map.of("active", "A boolean 'active' flag is required."));
        }
        return dishService.updateStatus(id, active);
    }

    @PostMapping("/uploads")
    public AdminDtos.UploadResponse upload(@RequestPart("file") MultipartFile file) {
        return storageService.store(file);
    }
}
