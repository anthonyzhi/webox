package com.webox.repository;

import com.webox.domain.Enums;
import com.webox.domain.OrderItem;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderItemRepository extends JpaRepository<OrderItem, Long> {

    /** One query for a whole page of orders instead of one per order (avoids the N+1 on My Orders). */
    List<OrderItem> findByOrderIdIn(Collection<Long> orderIds);

    /** Dishes the employee ordered recently — used to avoid recommending the same meal again within 7 days. */
    @Query("""
            select distinct i.dishId from OrderItem i
            where i.order.userId = :userId and i.order.createdAt >= :since and i.order.status <> :excluded
            """)
    List<Long> findRecentlyOrderedDishIds(@Param("userId") Long userId,
                                          @Param("since") Instant since,
                                          @Param("excluded") Enums.OrderStatus excluded);

    @Query("""
            select i.dishName, sum(i.quantity), coalesce(sum(i.subtotal), 0) from OrderItem i
            where i.order.createdAt >= :from and i.order.createdAt < :to and i.order.status <> :excluded
            group by i.dishName
            order by sum(i.quantity) desc
            """)
    List<Object[]> topDishes(@Param("from") Instant from, @Param("to") Instant to,
                             @Param("excluded") Enums.OrderStatus excluded, Pageable pageable);
}
