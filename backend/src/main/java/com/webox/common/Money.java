package com.webox.common;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** All money crossing the API is an integer number of cents; storage is DECIMAL(10,2).
 *  Nothing in the system ever holds a monetary value in a double. */
public final class Money {

    public static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    public static final int MAX_CENTS = 100_000; // ¥1,000.00 upper bound for a single price field

    private Money() {}

    public static long toCents(BigDecimal amount) {
        if (amount == null) return 0L;
        return amount.movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    public static BigDecimal fromCents(long cents) {
        return BigDecimal.valueOf(cents).movePointLeft(2).setScale(2, RoundingMode.UNNECESSARY);
    }

    public static BigDecimal normalize(BigDecimal amount) {
        return amount == null ? BigDecimal.ZERO.setScale(2) : amount.setScale(2, RoundingMode.HALF_UP);
    }
}
