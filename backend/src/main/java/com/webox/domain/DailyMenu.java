package com.webox.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;

/**
 * Per-dish, per-day availability and stock. {@code soldQuantity} is only ever changed by a guarded
 * UPDATE (see OrderRepository.reserveStock) so two simultaneous diners cannot oversell one portion.
 */
@Entity
@Table(name = "daily_menu")
public class DailyMenu {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "menu_date", nullable = false)
    private LocalDate menuDate;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "dish_id", nullable = false)
    private Dish dish;

    @Column(name = "total_quantity", nullable = false)
    private int totalQuantity;

    @Column(name = "sold_quantity", nullable = false)
    private int soldQuantity;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    public int remaining() {
        return Math.max(0, totalQuantity - soldQuantity);
    }

    public boolean soldOut() {
        return remaining() <= 0;
    }

    public boolean lowStock() {
        return remaining() > 0 && remaining() <= 3;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public LocalDate getMenuDate() { return menuDate; }
    public void setMenuDate(LocalDate menuDate) { this.menuDate = menuDate; }
    public Dish getDish() { return dish; }
    public void setDish(Dish dish) { this.dish = dish; }
    public int getTotalQuantity() { return totalQuantity; }
    public void setTotalQuantity(int totalQuantity) { this.totalQuantity = totalQuantity; }
    public int getSoldQuantity() { return soldQuantity; }
    public void setSoldQuantity(int soldQuantity) { this.soldQuantity = soldQuantity; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
