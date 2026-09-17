package com.webox.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Money must never drift: everything is an exact cent count in and out. */
class MoneyTest {

    @Test
    @DisplayName("half-up conversion to cents")
    void convertsToCents() {
        assertThat(Money.toCents(new BigDecimal("22.50"))).isEqualTo(2250);
        assertThat(Money.toCents(new BigDecimal("0.01"))).isEqualTo(1);
        assertThat(Money.toCents(new BigDecimal("0.005"))).isEqualTo(1);
        assertThat(Money.toCents(new BigDecimal("45.00"))).isEqualTo(4500);
        assertThat(Money.toCents(null)).isZero();
    }

    @Test
    @DisplayName("cents round-trip back to a two-decimal amount")
    void roundTripsFromCents() {
        assertThat(Money.fromCents(2250)).isEqualByComparingTo("22.50");
        assertThat(Money.fromCents(1)).isEqualByComparingTo("0.01");
        assertThat(Money.toCents(Money.fromCents(3580))).isEqualTo(3580);
    }

    @Test
    @DisplayName("summing line totals stays exact (the classic 0.1 + 0.2 trap)")
    void sumsExactly() {
        long total = 0;
        for (int i = 0; i < 3; i++) {
            total += Money.toCents(new BigDecimal("0.10"));
        }
        assertThat(Money.fromCents(total)).isEqualByComparingTo("0.30");
    }

    @Test
    @DisplayName("option surcharges add up without rounding surprises")
    void addsSurcharges() {
        long unit = Money.toCents(new BigDecimal("38.00")) + Money.toCents(new BigDecimal("3.00"))
                + Money.toCents(new BigDecimal("5.00"));
        assertThat(unit).isEqualTo(4600);
        assertThat(Money.fromCents(unit * 2)).isEqualByComparingTo("92.00");
    }
}
