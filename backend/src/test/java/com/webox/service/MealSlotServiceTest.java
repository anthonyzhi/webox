package com.webox.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.webox.domain.Enums;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The cut-off rules from the PRD, verified at their boundaries — 09:59 vs 10:00 and 14:59 vs 15:00 are
 * exactly where a canteen system goes wrong.
 */
class MealSlotServiceTest {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final LocalDate WEDNESDAY = LocalDate.of(2026, 9, 16);

    private MealSlotService serviceAt(String time) {
        Instant instant = java.time.ZonedDateTime.of(WEDNESDAY, java.time.LocalTime.parse(time), ZONE).toInstant();
        return new MealSlotService(Clock.fixed(instant, ZONE));
    }

    @Test
    @DisplayName("before 10:00 today's lunch is still bookable")
    void lunchIsBookableBeforeCutoff() {
        MealSlotService service = serviceAt("09:59:59");
        assertThat(service.isBookable(WEDNESDAY, Enums.MealPeriod.LUNCH)).isTrue();
        assertThat(service.nextBookableSlot()).isEqualTo(new MealSlotService.Slot(WEDNESDAY, Enums.MealPeriod.LUNCH));
    }

    @Test
    @DisplayName("at 10:00 sharp lunch closes and the next slot becomes today's dinner")
    void lunchClosesAtTen() {
        MealSlotService service = serviceAt("10:00:00");
        assertThat(service.isBookable(WEDNESDAY, Enums.MealPeriod.LUNCH)).isFalse();
        assertThat(service.isBookable(WEDNESDAY, Enums.MealPeriod.DINNER)).isTrue();
        assertThat(service.nextBookableSlot()).isEqualTo(new MealSlotService.Slot(WEDNESDAY, Enums.MealPeriod.DINNER));
    }

    @Test
    @DisplayName("after 15:00 both meals are closed and ordering moves to tomorrow's lunch")
    void everythingClosesAtFifteen() {
        MealSlotService service = serviceAt("15:00:01");
        assertThat(service.isBookable(WEDNESDAY, Enums.MealPeriod.DINNER)).isFalse();
        assertThat(service.nextBookableSlot())
                .isEqualTo(new MealSlotService.Slot(WEDNESDAY.plusDays(1), Enums.MealPeriod.LUNCH));
    }

    @Test
    @DisplayName("a late lunch request is switched to today's dinner (PRD worked example: 10:30)")
    void lateLunchSwitchesToDinner() {
        MealSlotService service = serviceAt("10:30:00");
        MealSlotService.Slot resolved = service.resolve(WEDNESDAY, Enums.MealPeriod.LUNCH);
        assertThat(resolved).isEqualTo(new MealSlotService.Slot(WEDNESDAY, Enums.MealPeriod.DINNER));
    }

    @Test
    @DisplayName("a late dinner request rolls over to tomorrow's lunch")
    void lateDinnerRollsToTomorrowLunch() {
        MealSlotService service = serviceAt("16:20:00");
        assertThat(service.resolve(WEDNESDAY, Enums.MealPeriod.DINNER))
                .isEqualTo(new MealSlotService.Slot(WEDNESDAY.plusDays(1), Enums.MealPeriod.LUNCH));
    }

    @Test
    @DisplayName("a request that is already valid is never rewritten")
    void validRequestsAreUntouched() {
        MealSlotService service = serviceAt("09:00:00");
        assertThat(service.resolve(WEDNESDAY, Enums.MealPeriod.LUNCH))
                .isEqualTo(new MealSlotService.Slot(WEDNESDAY, Enums.MealPeriod.LUNCH));
    }

    @Test
    @DisplayName("pre-ordering a later date is preserved instead of being pulled forward")
    void futureDatesArePreserved() {
        MealSlotService service = serviceAt("16:20:00");
        LocalDate friday = WEDNESDAY.plusDays(2);
        assertThat(service.resolve(friday, Enums.MealPeriod.DINNER))
                .isEqualTo(new MealSlotService.Slot(friday, Enums.MealPeriod.DINNER));
    }

    @Test
    @DisplayName("past dates are never bookable")
    void pastDatesAreRejected() {
        MealSlotService service = serviceAt("09:00:00");
        assertThat(service.isBookable(WEDNESDAY.minusDays(1), Enums.MealPeriod.LUNCH)).isFalse();
        assertThat(service.resolve(WEDNESDAY.minusDays(1), Enums.MealPeriod.LUNCH))
                .isEqualTo(new MealSlotService.Slot(WEDNESDAY, Enums.MealPeriod.LUNCH));
    }

    @Test
    @DisplayName("slot labels are human readable")
    void labelsReadNaturally() {
        MealSlotService service = serviceAt("09:00:00");
        assertThat(service.label(WEDNESDAY, Enums.MealPeriod.LUNCH)).isEqualTo("Today Lunch");
        assertThat(service.label(WEDNESDAY.plusDays(1), Enums.MealPeriod.DINNER)).isEqualTo("Tomorrow Dinner");
        assertThat(service.label(WEDNESDAY.plusDays(5), Enums.MealPeriod.LUNCH)).isEqualTo("2026-09-21 Lunch");
    }
}
