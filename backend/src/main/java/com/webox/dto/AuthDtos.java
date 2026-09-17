package com.webox.dto;

import com.webox.domain.Enums;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Request/response bodies for registration, sign-in and the session endpoint. */
public final class AuthDtos {

    private AuthDtos() {}

    public static final String PASSWORD_REGEX = "^(?=.*[A-Za-z])(?=.*\\d).{8,72}$";
    public static final String PASSWORD_MESSAGE = "Password must be at least 8 characters and contain both letters and numbers.";

    public record RegisterRequest(
            @NotBlank(message = "Email is required.")
            @Email(message = "Enter a valid email address.")
            @Size(max = 200, message = "Email must be at most 200 characters.")
            String email,

            @NotBlank(message = PASSWORD_MESSAGE)
            @Pattern(regexp = PASSWORD_REGEX, message = PASSWORD_MESSAGE)
            String password,

            @NotBlank(message = "Name is required.")
            @Size(min = 1, max = 100, message = "Name must be between 1 and 100 characters.")
            String displayName) {}

    public record LoginRequest(
            @NotBlank(message = "Email is required.")
            @Size(max = 200, message = "Email must be at most 200 characters.")
            String email,

            @NotBlank(message = "Password is required.")
            @Size(max = 72, message = "Password must be at most 72 characters.")
            String password) {}

    public record UserView(Long id, String email, String displayName, Enums.Role role) {}

    public record AuthResponse(String token, String expiresAt, UserView user) {}

    public record MeResponse(UserView user, PreferenceDtos.PreferenceView preferences) {}
}
