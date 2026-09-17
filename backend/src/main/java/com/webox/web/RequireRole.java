package com.webox.web;

import com.webox.domain.Enums;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares the role required to reach a handler. Enforced by {@link AuthInterceptor}, so a missing
 * check is visible on the controller rather than hidden in path configuration.
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireRole {
    Enums.Role value();
}
