package com.webox.config;

import com.webox.service.AuthService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Housekeeping so the session table cannot grow without bound on a long-running deployment. */
@Component
public class SessionJanitor {

    private static final Logger log = LoggerFactory.getLogger(SessionJanitor.class);

    private final AuthService authService;

    public SessionJanitor(AuthService authService) {
        this.authService = authService;
    }

    @Scheduled(fixedDelay = 3_600_000L, initialDelay = 600_000L)
    public void purgeExpiredSessions() {
        int removed = authService.purgeExpiredSessions();
        if (removed > 0) {
            log.info("Removed {} expired session(s)", removed);
        }
    }
}
