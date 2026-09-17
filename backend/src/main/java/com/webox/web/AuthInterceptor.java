package com.webox.web;

import com.webox.common.ApiException;
import com.webox.config.AppProperties;
import com.webox.domain.User;
import com.webox.domain.UserSession;
import com.webox.repository.UserRepository;
import com.webox.repository.UserSessionRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Token based authentication and role authorisation for /api/**.
 * <p>A short, explicit interceptor keeps the rules readable: no endpoint is reachable without a
 * valid session unless it is on the public allow-list, and admin-only handlers must say so via
 * {@link RequireRole}. Both the {@code Authorization} header (normal calls) and a {@code token}
 * query parameter (EventSource, which cannot set headers) are accepted.
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    public static final String USER_ATTRIBUTE = "authUser";

    private final UserSessionRepository sessions;
    private final UserRepository users;
    private final Clock clock;
    private final AppProperties properties;

    public AuthInterceptor(UserSessionRepository sessions, UserRepository users, Clock clock, AppProperties properties) {
        this.sessions = sessions;
        this.users = users;
        this.clock = clock;
        this.properties = properties;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }
        String path = request.getRequestURI();
        if (isPublic(path)) {
            return true;
        }

        UserSession session = resolveSession(request)
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in to continue."));
        if (session.getExpiresAt().isBefore(Instant.now(clock))) {
            sessions.deleteById(session.getToken());
            throw ApiException.unauthorized("SESSION_EXPIRED", "Your session has expired. Please sign in again.");
        }

        User user = users.findById(session.getUserId())
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in to continue."));
        request.setAttribute(USER_ATTRIBUTE, user);

        RequireRole required = handlerMethod.getMethodAnnotation(RequireRole.class);
        if (required == null) {
            required = handlerMethod.getBeanType().getAnnotation(RequireRole.class);
        }
        if (required != null && user.getRole() != required.value()) {
            throw ApiException.forbidden("FORBIDDEN",
                    "You do not have permission to access this resource.");
        }
        return true;
    }

    private boolean isPublic(String path) {
        return path.equals("/api/auth/login") || path.equals("/api/auth/register") || path.startsWith("/api/health");
    }

    private java.util.Optional<UserSession> resolveSession(HttpServletRequest request) {
        String token = null;
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            token = header.substring(7).trim();
        }
        if (token == null || token.isEmpty()) {
            token = request.getParameter("token");
        }
        if (token == null || token.isEmpty()) {
            return java.util.Optional.empty();
        }
        return sessions.findByToken(token);
    }
}
