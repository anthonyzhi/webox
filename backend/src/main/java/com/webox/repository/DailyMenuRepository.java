package com.webox.repository;

import com.webox.domain.DailyMenu;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DailyMenuRepository extends JpaRepository<DailyMenu, Long> {

    /**
     * Menu search for the employee page: filtering, sorting and paging all happen in SQL
     * (indexed on menu_date), so the request stays cheap as the catalogue grows.
     * The option groups are enriched from the cached catalogue afterwards.
     */
    @Query("""
            select m from DailyMenu m join fetch m.dish d
            where m.menuDate = :date
              and d.active = true
              and (:q is null or lower(d.name) like :q or lower(d.description) like :q)
              and (:categories is null or d.category in :categories)
            """)
    Page<DailyMenu> searchMenu(@Param("date") LocalDate date,
                               @Param("q") String q,
                               @Param("categories") Collection<String> categories,
                               Pageable pageable);

    /** Facet counts for the category chips (ignores the category filter itself). */
    @Query("""
            select d.category, count(m) from DailyMenu m join m.dish d
            where m.menuDate = :date and d.active = true
              and (:q is null or lower(d.name) like :q or lower(d.description) like :q)
            group by d.category
            """)
    List<Object[]> countByCategory(@Param("date") LocalDate date, @Param("q") String q);

    @Query("select m from DailyMenu m join fetch m.dish where m.menuDate = :date order by m.id asc")
    List<DailyMenu> findByMenuDate(@Param("date") LocalDate date);

    @Query("""
            select m from DailyMenu m join fetch m.dish d
            where m.menuDate = :date and d.active = true
            order by m.id asc
            """)
    List<DailyMenu> findActiveByMenuDate(@Param("date") LocalDate date);

    Optional<DailyMenu> findByMenuDateAndDishId(LocalDate date, Long dishId);

    List<DailyMenu> findByMenuDateAndDishIdIn(LocalDate date, Collection<Long> dishIds);

    @Query("select distinct m.menuDate from DailyMenu m order by m.menuDate desc")
    List<LocalDate> findDistinctMenuDates();

    /**
     * The single point where stock is consumed. The guard lives in the WHERE clause, so the
     * database — not the application — decides whether the portion is still available; concurrent
     * submissions therefore serialise on the row and can never oversell.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update daily_menu
               set sold_quantity = sold_quantity + :qty, updated_at = :now
             where id = :id and sold_quantity + :qty <= total_quantity
            """, nativeQuery = true)
    int reserveStock(@Param("id") Long id, @Param("qty") int qty, @Param("now") LocalDateTime now);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update daily_menu
               set sold_quantity = greatest(sold_quantity - :qty, 0), updated_at = :now
             where id = :id
            """, nativeQuery = true)
    int releaseStock(@Param("id") Long id, @Param("qty") int qty, @Param("now") LocalDateTime now);

    @Query("""
            select m from DailyMenu m join fetch m.dish d
            where m.menuDate = :date and (m.totalQuantity - m.soldQuantity) <= :threshold
            order by (m.totalQuantity - m.soldQuantity) asc
            """)
    List<DailyMenu> findLowStock(@Param("date") LocalDate date, @Param("threshold") int threshold);
}
