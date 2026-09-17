package com.webox.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.hibernate.annotations.BatchSize;

@Entity
@Table(name = "dishes")
public class Dish {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 500)
    private String description;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal price;

    /** Stored as the display value ("Light Meal") so the DB, API and UI share one spelling. */
    @Column(nullable = false, length = 40)
    private String category;

    @Column(nullable = false, length = 120)
    private String protein = "";

    /** Comma separated Allergen names. */
    @Column(nullable = false, length = 255)
    private String allergens = "";

    @Enumerated(EnumType.STRING)
    @Column(name = "spice_level", nullable = false, length = 20)
    private Enums.SpiceLevel spiceLevel = Enums.SpiceLevel.None;

    @Column(name = "image_url", length = 300)
    private String imageUrl;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    /** Batched lazy loading: the catalogue is read whole every time it is (re)built, so 3 queries
     *  replace the N+1 that a naive per-dish load would cause. */
    @OneToMany(mappedBy = "dish", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("sortOrder ASC, id ASC")
    @BatchSize(size = 100)
    private List<DishOptionGroup> optionGroups = new ArrayList<>();

    public void addOptionGroup(DishOptionGroup group) {
        group.setDish(this);
        optionGroups.add(group);
    }

    public void clearOptionGroups() {
        optionGroups.clear();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getProtein() { return protein; }
    public void setProtein(String protein) { this.protein = protein; }
    public String getAllergens() { return allergens; }
    public void setAllergens(String allergens) { this.allergens = allergens; }
    public Enums.SpiceLevel getSpiceLevel() { return spiceLevel; }
    public void setSpiceLevel(Enums.SpiceLevel spiceLevel) { this.spiceLevel = spiceLevel; }
    public String getImageUrl() { return imageUrl; }
    public void setImageUrl(String imageUrl) { this.imageUrl = imageUrl; }
    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
    public List<DishOptionGroup> getOptionGroups() { return optionGroups; }
    public void setOptionGroups(List<DishOptionGroup> optionGroups) { this.optionGroups = optionGroups; }
}
