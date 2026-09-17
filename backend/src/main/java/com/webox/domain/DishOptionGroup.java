package com.webox.domain;

import org.hibernate.annotations.BatchSize;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;

/** A choice the employee must (required) or may (optional) make for a dish, e.g. "Bun" or "Add-ons". */
@Entity
@Table(name = "dish_option_groups")
public class DishOptionGroup {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "dish_id", nullable = false)
    private Dish dish;

    @Column(nullable = false, length = 60)
    private String name;

    @Column(nullable = false)
    private boolean required;

    @Column(name = "multi_select", nullable = false)
    private boolean multiSelect;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @OneToMany(mappedBy = "group", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("sortOrder ASC, id ASC")
    @BatchSize(size = 200)
    private List<DishOption> options = new ArrayList<>();

    public void addOption(DishOption option) {
        option.setGroup(this);
        options.add(option);
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Dish getDish() { return dish; }
    public void setDish(Dish dish) { this.dish = dish; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public boolean isRequired() { return required; }
    public void setRequired(boolean required) { this.required = required; }
    public boolean isMultiSelect() { return multiSelect; }
    public void setMultiSelect(boolean multiSelect) { this.multiSelect = multiSelect; }
    public int getSortOrder() { return sortOrder; }
    public void setSortOrder(int sortOrder) { this.sortOrder = sortOrder; }
    public List<DishOption> getOptions() { return options; }
    public void setOptions(List<DishOption> options) { this.options = options; }
}
