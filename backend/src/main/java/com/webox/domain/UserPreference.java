package com.webox.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;

/** 1:1 with User. Only meaningful for employees; the Console ignores it. */
@Entity
@Table(name = "user_preferences")
public class UserPreference {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(nullable = false, length = 255)
    private String allergens = "";

    @Column(name = "cuisine_preferences", nullable = false, length = 255)
    private String cuisinePreferences = "";

    @Column(name = "spice_level", length = 20)
    private String spiceLevel;

    @Column(length = 20)
    private String taste;

    @Column(name = "budget_min", precision = 10, scale = 2)
    private BigDecimal budgetMin;

    @Column(name = "budget_max", precision = 10, scale = 2)
    private BigDecimal budgetMax;

    @Column(name = "recommend_enabled", nullable = false)
    private boolean recommendEnabled;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getAllergens() { return allergens; }
    public void setAllergens(String allergens) { this.allergens = allergens; }
    public String getCuisinePreferences() { return cuisinePreferences; }
    public void setCuisinePreferences(String cuisinePreferences) { this.cuisinePreferences = cuisinePreferences; }
    public String getSpiceLevel() { return spiceLevel; }
    public void setSpiceLevel(String spiceLevel) { this.spiceLevel = spiceLevel; }
    public String getTaste() { return taste; }
    public void setTaste(String taste) { this.taste = taste; }
    public BigDecimal getBudgetMin() { return budgetMin; }
    public void setBudgetMin(BigDecimal budgetMin) { this.budgetMin = budgetMin; }
    public BigDecimal getBudgetMax() { return budgetMax; }
    public void setBudgetMax(BigDecimal budgetMax) { this.budgetMax = budgetMax; }
    public boolean isRecommendEnabled() { return recommendEnabled; }
    public void setRecommendEnabled(boolean recommendEnabled) { this.recommendEnabled = recommendEnabled; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
