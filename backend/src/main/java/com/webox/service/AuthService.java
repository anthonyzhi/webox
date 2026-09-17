package com.webox.service;

import com.webox.common.ApiException;
import com.webox.config.AppProperties;
import com.webox.domain.Enums;
import com.webox.domain.User;
import com.webox.domain.UserSession;
import com.webox.dto.AuthDtos;
import com.webox.dto.PreferenceDtos;
import com.webox.repository.UserRepository;
import com.webox.repository.UserSessionRepository;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Registration, sign-in and session handling. Passwords are stored as BCrypt hashes only. */
@Service
public class AuthService {

    private final UserRepository users;
    private final UserSessionRepository sessions;
    private final PreferenceService preferences;
    private final Clock clock;
    private final AppProperties properties;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder(10);
    private final SecureRandom random = new SecureRandom();

    public AuthService(UserRepository users, UserSessionRepository sessions, PreferenceService preferences,
                       Clock clock, AppProperties properties) {
        this.users = users;
        this.sessions = sessions;
        this.preferences = preferences;
        this.clock = clock;
        this.properties = properties;
    }

    @Transactional
    public AuthDtos.AuthResponse register(AuthDtos.RegisterRequest request) {
        String email = normalizeEmail(request.email());
        if (users.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("EMAIL_TAKEN", "This email is already registered. Try signing in instead.");
        }
        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setDisplayName(request.displayName().trim());
        user.setRole(Enums.Role.EMPLOYEE);
        user.setCreatedAt(Instant.now(clock));
        try {
            users.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) {
            // Two simultaneous registrations for the same address: the unique index is the arbiter.
            throw ApiException.conflict("EMAIL_TAKEN", "This email is already registered. Try signing in instead.");
        }
        preferences.ensureFor(user.getId());
        return issueToken(user);
    }

    @Transactional
    public AuthDtos.AuthResponse login(AuthDtos.LoginRequest request) {
        String email = normalizeEmail(request.email());
        User user = users.findByEmailIgnoreCase(email)
                .orElseThrow(() -> invalidCredentials());
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw invalidCredentials();
        }
        return issueToken(user);
    }

    @Transactional
    public void logout(String token) {
        if (token != null && !token.isBlank()) {
            sessions.deleteById(token);
        }
    }

    @Transactional(readOnly = true)
    public AuthDtos.MeResponse me(User user) {
        return new AuthDtos.MeResponse(view(user), preferences.view(user.getId()));
    }

    public AuthDtos.UserView view(User user) {
        return new AuthDtos.UserView(user.getId(), user.getEmail(), user.getDisplayName(), user.getRole());
    }

    private AuthDtos.AuthResponse issueToken(User user) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        UserSession session = new UserSession();
        session.setToken(token);
        session.setUserId(user.getId());
        session.setCreatedAt(Instant.now(clock));
        session.setExpiresAt(Instant.now(clock).plus(Duration.ofHours(properties.getSession().getTtlHours())));
        sessions.save(session);
        return new AuthDtos.AuthResponse(token, session.getExpiresAt().toString(), view(user));
    }

    private ApiException invalidCredentials() {
        return ApiException.unauthorized("INVALID_CREDENTIALS", "Incorrect email or password.");
    }

    private String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    /** Housekeeping: expired tokens are dropped hourly by {@code SessionJanitor}. */
    @Transactional
    public int purgeExpiredSessions() {
        return sessions.deleteExpired(Instant.now(clock));
    }

    @Transactional(readOnly = true)
    public PreferenceDtos.PreferenceView preferencesFor(Long userId) {
        return preferences.view(userId);
    }
}
