package com.webox.service;

import com.webox.domain.DailyMenu;
import com.webox.repository.DailyMenuRepository;
import java.io.IOException;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Server-Sent Events fan-out for stock levels.
 * <p>Employees watching the menu see portions disappear as colleagues order, without polling: the
 * server pushes only the rows that changed. SSE (not WebSocket) because the traffic is one-way and
 * EventSource reconnects by itself.
 */
@Service
public class StockStreamService {

    private static final Logger log = LoggerFactory.getLogger(StockStreamService.class);

    public record StockItem(long menuId, int remaining, boolean lowStock, boolean soldOut) {}

    private final Map<String, List<SseEmitter>> subscribers = new ConcurrentHashMap<>();
    private final DailyMenuRepository menu;

    public StockStreamService(DailyMenuRepository menu) {
        this.menu = menu;
    }

    public SseEmitter subscribe(LocalDate date) {
        SseEmitter emitter = new SseEmitter(0L);
        List<SseEmitter> list = subscribers.computeIfAbsent(date.toString(), key -> new CopyOnWriteArrayList<>());
        list.add(emitter);
        emitter.onCompletion(() -> list.remove(emitter));
        emitter.onTimeout(() -> list.remove(emitter));
        emitter.onError(error -> list.remove(emitter));
        try {
            emitter.send(SseEmitter.event().name("snapshot").data(snapshot(date)));
        } catch (IOException | IllegalStateException e) {
            list.remove(emitter);
        }
        return emitter;
    }

    /** Pushes the current stock of the given menu rows to everyone watching that date. */
    public void publish(LocalDate date, Collection<Long> menuIds) {
        List<SseEmitter> list = subscribers.get(date.toString());
        if (list == null || list.isEmpty() || menuIds == null || menuIds.isEmpty()) {
            return;
        }
        List<StockItem> changed = currentStock(menuIds);
        if (changed.isEmpty()) {
            return;
        }
        Map<String, Object> payload = Map.of("date", date.toString(), "items", changed);
        for (SseEmitter emitter : list) {
            try {
                emitter.send(SseEmitter.event().name("stock").data(payload));
            } catch (IOException | IllegalStateException e) {
                list.remove(emitter);
                emitter.complete();
            }
        }
    }

    /**
     * Broadcasts only after the surrounding transaction commits, so a rolled-back order can never
     * advertise stock that was never taken.
     */
    public void publishAfterCommit(LocalDate date, Collection<Long> menuIds) {
        if (menuIds == null || menuIds.isEmpty()) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publish(date, menuIds);
                }
            });
        } else {
            publish(date, menuIds);
        }
    }

    @Scheduled(fixedDelay = 20_000)
    public void heartbeat() {
        for (Map.Entry<String, List<SseEmitter>> entry : subscribers.entrySet()) {
            for (SseEmitter emitter : entry.getValue()) {
                try {
                    emitter.send(SseEmitter.event().comment("keep-alive"));
                } catch (IOException | IllegalStateException e) {
                    entry.getValue().remove(emitter);
                }
            }
        }
        subscribers.values().removeIf(List::isEmpty);
    }

    public int subscriberCount() {
        return subscribers.values().stream().mapToInt(List::size).sum();
    }

    private Map<String, Object> snapshot(LocalDate date) {
        List<StockItem> items = menu.findActiveByMenuDate(date).stream()
                .map(StockStreamService::toItem)
                .toList();
        return Map.of("date", date.toString(), "items", items);
    }

    private List<StockItem> currentStock(Collection<Long> menuIds) {
        try {
            return menu.findAllById(menuIds).stream().map(StockStreamService::toItem).toList();
        } catch (RuntimeException e) {
            log.warn("Unable to read stock for streaming: {}", e.getMessage());
            return List.of();
        }
    }

    private static StockItem toItem(DailyMenu row) {
        return new StockItem(row.getId(), row.remaining(), row.lowStock(), row.soldOut());
    }
}
