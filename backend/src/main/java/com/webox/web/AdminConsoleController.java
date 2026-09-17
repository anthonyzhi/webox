package com.webox.web;

import com.webox.domain.Enums;
import com.webox.dto.AdminDtos;
import com.webox.dto.PreferenceDtos;
import com.webox.service.AdminMenuService;
import com.webox.service.DashboardService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
@RequireRole(Enums.Role.ADMIN)
public class AdminConsoleController {

    private final AdminMenuService menuService;
    private final DashboardService dashboardService;

    public AdminConsoleController(AdminMenuService menuService, DashboardService dashboardService) {
        this.menuService = menuService;
        this.dashboardService = dashboardService;
    }

    @GetMapping("/daily-menu")
    public AdminDtos.DailyMenuResponse dailyMenu(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return menuService.dailyMenu(date == null ? LocalDate.now() : date);
    }

    @PutMapping("/daily-menu")
    public AdminDtos.DailyMenuResponse setDailyMenu(@Valid @RequestBody AdminDtos.DailyMenuWriteRequest request) {
        return menuService.setDailyMenu(request);
    }

    @GetMapping("/dashboard")
    public PreferenceDtos.DashboardResponse dashboard(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return dashboardService.dashboard(date == null ? dashboardService.today() : date);
    }
}
