package com.webox.repository;

import com.webox.domain.Enums;
import com.webox.domain.Order;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderRepository extends JpaRepository<Order, Long> {

    /** Idempotency lookup: one order per (user, key) forever, which makes a retried submit a no-op. */
    Optional<Order> findByUserIdAndIdempotencyKey(Long userId, String idempotencyKey);

    @EntityGraph(attributePaths = {"items"})
    Optional<Order> findWithItemsById(Long id);

    Page<Order> findByUserId(Long userId, Pageable pageable);

    List<Order> findByUserIdAndDeliveryDateAndMealPeriodAndStatusIn(
            Long userId, LocalDate deliveryDate, Enums.MealPeriod mealPeriod, Collection<Enums.OrderStatus> statuses);

    @Query("""
            select count(o) from Order o
            where o.createdAt >= :from and o.createdAt < :to and o.status <> :excluded
            """)
    long countPlaced(@Param("from") Instant from, @Param("to") Instant to, @Param("excluded") Enums.OrderStatus excluded);

    @Query("""
            select coalesce(sum(o.totalAmount), 0) from Order o
            where o.createdAt >= :from and o.createdAt < :to and o.status <> :excluded
            """)
    java.math.BigDecimal revenuePlaced(@Param("from") Instant from, @Param("to") Instant to,
                                       @Param("excluded") Enums.OrderStatus excluded);

    @Query("""
            select o.status, count(o) from Order o
            where o.createdAt >= :from and o.createdAt < :to
            group by o.status
            """)
    List<Object[]> countByStatus(@Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            select o.mealPeriod, count(o), coalesce(sum(o.totalAmount), 0) from Order o
            where o.createdAt >= :from and o.createdAt < :to and o.status <> :excluded
            group by o.mealPeriod
            """)
    List<Object[]> breakdownByMealPeriod(@Param("from") Instant from, @Param("to") Instant to,
                                         @Param("excluded") Enums.OrderStatus excluded);

    /** Marks every active order of a slot as no longer occupying that slot. */
    @Query("select o from Order o where o.activeSlot = :slot")
    Optional<Order> findByActiveSlot(@Param("slot") String slot);
}
