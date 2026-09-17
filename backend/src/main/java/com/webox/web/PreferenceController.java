package com.webox.web;

import com.webox.domain.User;
import com.webox.dto.PreferenceDtos;
import com.webox.service.PreferenceService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me")
public class PreferenceController {

    private final PreferenceService preferenceService;

    public PreferenceController(PreferenceService preferenceService) {
        this.preferenceService = preferenceService;
    }

    @GetMapping("/preferences")
    public PreferenceDtos.PreferenceView preferences(@RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user) {
        return preferenceService.view(user.getId());
    }

    @PutMapping("/preferences")
    public PreferenceDtos.PreferenceView update(
            @RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user,
            @Valid @RequestBody PreferenceDtos.PreferenceUpdateRequest request) {
        return preferenceService.update(user.getId(), request);
    }

    @GetMapping("/addresses")
    public List<PreferenceDtos.AddressView> addresses(@RequestAttribute(AuthInterceptor.USER_ATTRIBUTE) User user) {
        return preferenceService.addressHistory(user.getId());
    }
}
