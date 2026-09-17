package com.webox.web;

import com.webox.domain.User;
import com.webox.dto.MenuDtos;
import com.webox.service.MenuService;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Employee menu reads: the hot path during the 09:30-10:00 ordering rush. */
@RestController
@RequestMapping("/api")
public class MenuController {

    private final MenuService menuService;

    public MenuController(MenuService menuService) {
        this.menuService = menuService;
    }

    @GetMapping("/menu")
    public MenuDtos.MenuPageResponse menu(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) List<String> categories,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "12") int size,
            @RequestParam(defaultValue = "default") String sort,
            @RequestParam(defaultValue = "false") boolean personalized) {
        return menuService.search(user.getId(), date, categories, q, page, size, sort, personalized);
    }

    @GetMapping("/menu/items/{menuId}")
    public MenuDtos.MenuItemResponse item(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @PathVariable Long menuId) {
        return menuService.item(user.getId(), menuId);
    }

    @GetMapping("/meta/enums")
    public MenuDtos.EnumsResponse enums() {
        return menuService.enums();
    }
}
