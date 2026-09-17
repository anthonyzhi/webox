package com.webox.repository;

import com.webox.domain.Dish;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DishRepository extends JpaRepository<Dish, Long> {

    Optional<Dish> findById(Long id);

    List<Dish> findByActiveTrueOrderByIdAsc();

    boolean existsByNameIgnoreCase(String name);

    Optional<Dish> findByNameIgnoreCase(String name);

    @Query("""
            select d from Dish d
            where (:q is null or lower(d.name) like :q or lower(d.description) like :q)
              and (:category is null or d.category = :category)
              and (:active is null or d.active = :active)
            """)
    Page<Dish> searchForConsole(@Param("q") String q,
                                @Param("category") String category,
                                @Param("active") Boolean active,
                                Pageable pageable);

    List<Dish> findByIdIn(Collection<Long> ids);
}
