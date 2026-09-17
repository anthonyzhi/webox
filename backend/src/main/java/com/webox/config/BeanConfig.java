package com.webox.config;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneId;
import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
public class BeanConfig {

    /** Single source of "now" for meal cut-off logic, bound to the canteen's timezone. */
    @Bean
    public Clock clock(AppProperties properties) {
        return Clock.system(ZoneId.of(properties.getTimezone()));
    }

    @Bean
    public Cache<String, Object> dishCatalogCache(AppProperties properties) {
        return Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofSeconds(properties.getCache().getDishTtlSeconds()))
                .maximumSize(2000)
                .recordStats()
                .build();
    }

    @Bean
    public Cache<String, Object> menuCache(AppProperties properties) {
        return Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofSeconds(properties.getCache().getMenuTtlSeconds()))
                .maximumSize(200)
                .recordStats()
                .build();
    }

    /** SSE work (LLM streaming, stock fan-out) must never occupy the request threads. */
    @Bean(name = "sseExecutor")
    public Executor sseExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(16);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("webox-sse-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.initialize();
        return executor;
    }
}
