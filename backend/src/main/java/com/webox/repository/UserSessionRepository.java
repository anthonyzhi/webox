package com.webox.repository;

import com.webox.domain.UserSession;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserSessionRepository extends JpaRepository<UserSession, String> {

    Optional<UserSession> findByToken(String token);

    @Modifying
    @Query("delete from UserSession s where s.expiresAt < :now")
    int deleteExpired(@Param("now") Instant now);

    @Modifying
    @Query("delete from UserSession s where s.userId = :userId")
    int deleteByUserId(@Param("userId") Long userId);
}
