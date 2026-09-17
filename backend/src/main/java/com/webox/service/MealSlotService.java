package com.webox.service;

import com.webox.domain.Enums;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import org.springframework.stereotype.Service;

/**
 * Canteen ordering rules, kept in one place because three layers depend on them:
 * checkout (auto-switch), order submission (server-side enforcement) and the Console.
 * Lunch must be ordered before 10:00, dinner before 15:00 (same day).
 */
@Service
public class MealSlotService {

    public static final LocalTime LUNCH_CUTOFF = LocalTime.of(10, 0);
    public static final LocalTime DINNER_CUTOFF = LocalTime.of(15, 0);
    public static final int MAX_QUANTITY_PER_ORDER = 5;
    public static final int LOW_STOCK_THRESHOLD = 3;

    private final Clock clock;

    public MealSlotService(Clock clock) {
        this.clock = clock;
    }

    public record Slot(LocalDate date, Enums.MealPeriod period) {}

    public ZonedDateTime now() {
        return ZonedDateTime.now(clock);
    }

    public LocalDate today() {
        return LocalDate.now(clock);
    }

    /** The nearest slot that can still be ordered: today's lunch, else today's dinner, else tomorrow's lunch. */
    public Slot nextBookableSlot() {
        ZonedDateTime now = now();
        LocalDate today = now.toLocalDate();
        if (now.toLocalTime().isBefore(LUNCH_CUTOFF)) {
            return new Slot(today, Enums.MealPeriod.LUNCH);
        }
        if (now.toLocalTime().isBefore(DINNER_CUTOFF)) {
            return new Slot(today, Enums.MealPeriod.DINNER);
        }
        return new Slot(today.plusDays(1), Enums.MealPeriod.LUNCH);
    }

    /** A past date is never bookable; a future date is always bookable; today depends on the cut-off. */
    public boolean isBookable(LocalDate date, Enums.MealPeriod period) {
        if (date == null || period == null) {
            return false;
        }
        ZonedDateTime now = now();
        if (date.isBefore(now.toLocalDate())) {
            return false;
        }
        if (date.isAfter(now.toLocalDate())) {
            return true;
        }
        return now.toLocalTime().isBefore(cutoffOf(period));
    }

    /**
     * Applies the auto-switch rule: an out-of-time request is silently moved to the nearest bookable
     * slot so the employee always ends up with a valid order (and is told about the change).
     */
    public Slot resolve(LocalDate requestedDate, Enums.MealPeriod requestedPeriod) {
        if (isBookable(requestedDate, requestedPeriod)) {
            return new Slot(requestedDate, requestedPeriod);
        }
        Slot next = nextBookableSlot();
        // Ordering ahead stays supported: if the employee picked a later date than the next slot, keep it.
        if (requestedDate != null && requestedDate.isAfter(next.date())) {
            return new Slot(requestedDate, requestedPeriod);
        }
        return next;
    }

    public LocalDateTime cutoffAt(LocalDate date, Enums.MealPeriod period) {
        return LocalDateTime.of(date, cutoffOf(period));
    }

    public LocalTime cutoffOf(Enums.MealPeriod period) {
        return period == Enums.MealPeriod.LUNCH ? LUNCH_CUTOFF : DINNER_CUTOFF;
    }

    public String label(LocalDate date, Enums.MealPeriod period) {
        LocalDate today = today();
        String day;
        if (date.equals(today)) {
            day = "Today";
        } else if (date.equals(today.plusDays(1))) {
            day = "Tomorrow";
        } else {
            day = date.toString();
        }
        return day + " " + (period == Enums.MealPeriod.LUNCH ? "Lunch" : "Dinner");
    }
}
