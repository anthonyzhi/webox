package com.webox.config;

import com.webox.common.Json;
import com.webox.common.Money;
import com.webox.domain.DailyMenu;
import com.webox.domain.Dish;
import com.webox.domain.DishOption;
import com.webox.domain.DishOptionGroup;
import com.webox.domain.Enums;
import com.webox.domain.Order;
import com.webox.domain.OrderItem;
import com.webox.domain.User;
import com.webox.domain.UserPreference;
import com.webox.repository.DailyMenuRepository;
import com.webox.repository.DishRepository;
import com.webox.repository.OrderRepository;
import com.webox.repository.UserPreferenceRepository;
import com.webox.repository.UserRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeds a demo-ready database: the catalogue, an admin and demo employees, today's <em>and</em>
 * tomorrow's menu with stock, a week of finished orders so the dashboard, trend chart and rankings
 * show real numbers, and a handful of stock situations to demonstrate the low-stock/sold-out states.
 * <p>Idempotent: existing dishes, users and menus are never overwritten, and past orders are only
 * generated when the orders table is empty — restarting the app is always safe.
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);
    private static final String ADMIN_EMAIL = "admin@webox.com";
    private static final String ADMIN_PASSWORD = "Admin12345";
    private static final String EMPLOYEE_EMAIL = "employee@webox.com";
    private static final String EMPLOYEE_PASSWORD = "Employee123";
    private static final String DEMO_ADDRESS = "HQ Tower, Floor 12, Meeting Room B";

    private final UserRepository users;
    private final UserPreferenceRepository preferences;
    private final DishRepository dishes;
    private final DailyMenuRepository menu;
    private final OrderRepository orders;
    private final Clock clock;

    public DataSeeder(UserRepository users, UserPreferenceRepository preferences, DishRepository dishes,
                      DailyMenuRepository menu, OrderRepository orders, Clock clock) {
        this.users = users;
        this.preferences = preferences;
        this.dishes = dishes;
        this.menu = menu;
        this.orders = orders;
        this.clock = clock;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        seedUsers();
        seedCatalogue();
        seedMenus();
        seedHistory();
    }

    private void seedUsers() {
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(10);
        if (!users.existsByEmailIgnoreCase(ADMIN_EMAIL)) {
            User admin = new User();
            admin.setEmail(ADMIN_EMAIL);
            admin.setDisplayName("WeBox Admin");
            admin.setPasswordHash(encoder.encode(ADMIN_PASSWORD));
            admin.setRole(Enums.Role.ADMIN);
            admin.setCreatedAt(Instant.now(clock));
            users.save(admin);
            log.info("Seeded Console admin account {}", ADMIN_EMAIL);
        }
        if (!users.existsByEmailIgnoreCase(EMPLOYEE_EMAIL)) {
            User employee = new User();
            employee.setEmail(EMPLOYEE_EMAIL);
            employee.setDisplayName("Demo Employee");
            employee.setPasswordHash(encoder.encode(EMPLOYEE_PASSWORD));
            employee.setRole(Enums.Role.EMPLOYEE);
            employee.setCreatedAt(Instant.now(clock));
            users.save(employee);
            UserPreference pref = new UserPreference();
            pref.setUserId(employee.getId());
            pref.setAllergens(Enums.Allergen.Egg.name());
            pref.setCuisinePreferences(Enums.Category.Chinese.value() + "," + Enums.Category.Japanese.value());
            pref.setSpiceLevel(Enums.SpiceLevel.Medium.name());
            pref.setTaste(Enums.Taste.Balanced.name());
            pref.setBudgetMin(Money.fromCents(1500));
            pref.setBudgetMax(Money.fromCents(4000));
            pref.setRecommendEnabled(true);
            pref.setUpdatedAt(Instant.now(clock));
            preferences.save(pref);
            log.info("Seeded demo employee account {}", EMPLOYEE_EMAIL);
        }
        for (int i = 2; i <= 5; i++) {
            String email = "employee" + i + "@webox.com";
            if (users.existsByEmailIgnoreCase(email)) {
                continue;
            }
            User user = new User();
            user.setEmail(email);
            user.setDisplayName("Employee " + i);
            user.setPasswordHash(encoder.encode("Employee" + i + "pass1"));
            user.setRole(Enums.Role.EMPLOYEE);
            user.setCreatedAt(Instant.now(clock).minus(java.time.Duration.ofDays(30)));
            users.save(user);
        }
    }

    private void seedCatalogue() {
        if (dishes.count() > 0) {
            return;
        }
        int image = 0;

        save(dish("Kung Pao Chicken",
                "Classic Sichuan dish, chicken stir-fried with peanuts and dried chili",
                2200, "Chinese", "Chicken", List.of("Peanuts"), "Medium", ++image));
        save(dish("Caesar Salad",
                "Fresh romaine lettuce with Parmesan and Caesar dressing",
                2850, "Light Meal", "None", List.of("Dairy", "Egg"), "None", ++image)
                .addOns(opt("Grilled Chicken", 600), opt("Bacon", 500), opt("Avocado", 400)));
        save(dish("Salmon Sashimi Set",
                "Fresh salmon sashimi with rice and miso soup",
                4500, "Japanese", "Fish", List.of("Fish"), "None", ++image));
        save(dish("Tomato Pasta",
                "Classic Italian tomato pasta with fresh basil",
                2650, "Western", "None", List.of("Gluten"), "None", ++image)
                .required("Pasta Type", false, "Spaghetti", "Fusilli", "Penne")
                .addOns(opt("Bacon", 500), opt("Cheese", 300)));
        save(dish("Tom Yum Soup",
                "Thai hot & sour shrimp soup with lemongrass, galangal, lime leaves",
                3200, "Southeast Asian", "Shrimp", List.of("Shellfish"), "Hot", ++image));
        save(dish("Chicken Quinoa Bowl",
                "Low-fat high-protein grilled chicken with quinoa, avocado, veggies",
                3580, "Light Meal", "Chicken", List.of(), "None", ++image)
                .required("Base", false, "Quinoa", "Brown Rice", "Mixed Grains"));
        save(dish("Mapo Tofu",
                "Sichuan classic, soft tofu with spicy minced meat",
                1800, "Chinese", "Tofu, Pork", List.of("Soy"), "Medium", ++image));
        save(dish("Korean Bibimbap",
                "Stone-pot mixed rice with veggies, fried egg, and chili sauce",
                3000, "Korean", "Egg", List.of("Egg", "Soy"), "Mild", ++image)
                .addOns(opt("Cheese", 300), opt("Fried Egg", 200), opt("Beef Slices", 800)));
        save(dish("Classic Beef Burger",
                "Angus beef patty with lettuce, tomato, onion",
                3800, "Western", "Beef", List.of("Gluten", "Dairy"), "None", ++image)
                .required("Bun", false, "Plain", "Whole Wheat")
                .required("Sauce", false, "Ketchup", "Mustard", "Mayo", "BBQ")
                .addOns(opt("Cheese", 300), opt("Bacon", 500), opt("Fried Egg", 200)));
        save(dish("Beef Noodle Soup",
                "Braised beef brisket with hand-pulled noodles and bok choy",
                3050, "Chinese", "Beef", List.of("Gluten", "Soy"), "Mild", ++image)
                .addOns(opt("Extra Beef", 800), opt("Bok Choy", 300)));
        save(dish("Grilled Salmon Bowl",
                "Grilled salmon fillet with seasonal greens and lemon",
                4200, "Light Meal", "Fish", List.of("Fish"), "None", ++image)
                .required("Base", false, "White Rice", "Quinoa"));
        save(dish("Margherita Pizza",
                "Wood-fired pizza with tomato, mozzarella and basil",
                3300, "Western", "None", List.of("Gluten", "Dairy"), "None", ++image)
                .addOns(opt("Extra Cheese", 400), opt("Basil Pesto", 300)));
        save(dish("Chicken Katsu Curry",
                "Crispy breaded chicken with Japanese curry sauce and rice",
                3400, "Japanese", "Chicken", List.of("Gluten", "Egg"), "Mild", ++image)
                .addOns(opt("Extra Curry Sauce", 300), opt("Extra Rice", 200)));
        save(dish("Tofu Veggie Stir-fry",
                "Wok-fried tofu with broccoli, peppers and sesame",
                1950, "Chinese", "Tofu", List.of("Soy"), "Mild", ++image));
        save(dish("Sushi Deluxe Platter",
                "Chef's selection of nigiri and maki rolls",
                5200, "Japanese", "Fish", List.of("Fish", "Shellfish"), "None", ++image));
        save(dish("Greek Chicken Salad",
                "Grilled chicken, cucumber, tomato, olives and feta",
                2700, "Light Meal", "Chicken", List.of("Dairy"), "None", ++image)
                .addOns(opt("Feta", 300), opt("Olives", 200)));
        save(dish("Bulgogi Beef Rice",
                "Marinated grilled beef with rice and pickled vegetables",
                3600, "Korean", "Beef", List.of("Soy", "Gluten"), "Mild", ++image));
        save(dish("Green Curry Chicken",
                "Thai green curry with coconut milk, bamboo shoots and basil",
                3100, "Southeast Asian", "Chicken", List.of(), "Medium", ++image));
        save(dish("Vegan Buddha Bowl",
                "Roasted vegetables, chickpeas and avocado on grains",
                2600, "Light Meal", "Tofu", List.of("Soy"), "None", ++image)
                .required("Base", false, "Quinoa", "Brown Rice"));
        save(dish("Pork Tonkotsu Ramen",
                "Rich pork broth ramen with chashu, egg and nori",
                3700, "Japanese", "Pork", List.of("Gluten", "Egg", "Soy"), "Mild", ++image)
                .addOns(opt("Extra Chashu", 700), opt("Sweet Corn", 200)));

        log.info("Seeded {} dishes", image);
    }

    /** Today and tomorrow must always be orderable; the past week backs the dashboard trend. */
    private void seedMenus() {
        LocalDate today = LocalDate.now(clock);
        List<Dish> active = dishes.findByActiveTrueOrderByIdAsc();
        if (active.isEmpty()) {
            return;
        }
        if (menu.findByMenuDate(today).isEmpty()) {
            Map<String, Integer> quantities = new LinkedHashMap<>();
            active.forEach(dish -> quantities.put(dish.getName(), 24));
            // Two deliberate demo situations: one dish running low, one sold out.
            quantities.put("Tom Yum Soup", 3);
            quantities.put("Sushi Deluxe Platter", 2);
            int soldTomYum = 1;
            int soldSushi = 2;
            for (Dish dish : active) {
                int total = quantities.get(dish.getName());
                int sold = dish.getName().equals("Tom Yum Soup") ? soldTomYum
                        : dish.getName().equals("Sushi Deluxe Platter") ? soldSushi : 0;
                saveMenuRow(today, dish, total, sold);
            }
            log.info("Seeded today's menu ({} dishes) with stock", active.size());
        }
        if (menu.findByMenuDate(today.plusDays(1)).isEmpty()) {
            for (Dish dish : active) {
                saveMenuRow(today.plusDays(1), dish, 30, 0);
            }
            log.info("Seeded tomorrow's menu ({} dishes)", active.size());
        }
    }

    /** A week of history so the dashboard, rankings and trend chart are populated from day one. */
    private void seedHistory() {
        if (orders.count() > 0) {
            return;
        }
        LocalDate today = LocalDate.now(clock);
        List<Dish> active = dishes.findByActiveTrueOrderByIdAsc();
        if (active.isEmpty()) {
            return;
        }
        for (int dayOffset = 7; dayOffset >= 2; dayOffset--) {
            LocalDate date = today.minusDays(dayOffset);
            List<DailyMenu> rows = menu.findByMenuDate(date);
            if (rows.isEmpty()) {
                rows = new ArrayList<>();
                for (Dish dish : active) {
                    rows.add(saveMenuRow(date, dish, 40, 0));
                }
            }
            seedDayOrders(date, rows);
        }
        log.info("Seeded order history for the dashboard");
    }

    private void seedDayOrders(LocalDate date, List<DailyMenu> rows) {
        Random random = new Random(date.toEpochDay());
        List<User> employees = users.findAll().stream()
                .filter(user -> user.getRole() == Enums.Role.EMPLOYEE)
                .toList();
        if (employees.isEmpty()) {
            return;
        }
        int ordersToday = 3 + random.nextInt(4);
        for (int i = 0; i < ordersToday; i++) {
            User employee = employees.get(random.nextInt(employees.size()));
            Enums.MealPeriod period = random.nextBoolean() ? Enums.MealPeriod.LUNCH : Enums.MealPeriod.DINNER;
            Enums.OrderStatus status = random.nextInt(10) == 0 ? Enums.OrderStatus.Cancelled
                    : random.nextInt(6) == 0 ? Enums.OrderStatus.Confirmed : Enums.OrderStatus.Completed;
            Order order = new Order();
            order.setOrderNo("WB" + date.toString().replace("-", "") + String.format("%06d", random.nextInt(1_000_000)));
            order.setUserId(employee.getId());
            order.setIdempotencyKey("seed-" + date + "-" + i + "-" + employee.getId());
            order.setStatus(status);
            order.setDeliveryDate(date);
            order.setMealPeriod(period);
            order.setAddress(DEMO_ADDRESS);
            order.setCreatedAt(date.atTime(period == Enums.MealPeriod.LUNCH ? 9 : 11, 30)
                    .atZone(clock.getZone()).toInstant());
            order.setUpdatedAt(order.getCreatedAt());
            order.setActiveSlot(status.isActive() ? Order.slotKey(employee.getId(), date, period) : null);

            int lineCount = 1 + random.nextInt(2);
            int totalQuantity = 0;
            BigDecimal total = BigDecimal.ZERO.setScale(2);
            List<DailyMenu> pool = new ArrayList<>(rows);
            for (int line = 0; line < lineCount && !pool.isEmpty(); line++) {
                DailyMenu menuRow = pool.remove(random.nextInt(pool.size()));
                int quantity = 1 + random.nextInt(2);
                BigDecimal unit = menuRow.getDish().getPrice();
                BigDecimal subtotal = unit.multiply(BigDecimal.valueOf(quantity));
                OrderItem item = new OrderItem();
                item.setDishId(menuRow.getDish().getId());
                item.setMenuId(menuRow.getId());
                item.setDishName(menuRow.getDish().getName());
                item.setImageUrl(menuRow.getDish().getImageUrl());
                item.setQuantity(quantity);
                item.setBasePrice(unit);
                item.setOptionsPrice(BigDecimal.ZERO.setScale(2));
                item.setUnitPrice(unit);
                item.setSubtotal(subtotal);
                item.setOptionsJson("[]");
                order.addItem(item);
                totalQuantity += quantity;
                total = total.add(subtotal);
                if (!status.isActive()) {
                    menuRow.setSoldQuantity(menuRow.getSoldQuantity() + quantity);
                    menu.save(menuRow);
                }
            }
            order.setTotalQuantity(totalQuantity);
            order.setTotalAmount(total);
            orders.save(order);
        }
    }

    private DailyMenu saveMenuRow(LocalDate date, Dish dish, int total, int sold) {
        DailyMenu row = new DailyMenu();
        row.setMenuDate(date);
        row.setDish(dish);
        row.setTotalQuantity(total);
        row.setSoldQuantity(sold);
        row.setUpdatedAt(Instant.now(clock));
        return menu.save(row);
    }

    private SeedDish dish(String name, String description, long priceCents, String category, String protein,
                          List<String> allergens, String spice, int imageNumber) {
        Dish dish = new Dish();
        dish.setName(name);
        dish.setDescription(description);
        dish.setPrice(Money.fromCents(priceCents));
        dish.setCategory(category);
        dish.setProtein(protein);
        dish.setAllergens(Json.toCsv(allergens));
        dish.setSpiceLevel(Enums.SpiceLevel.valueOf(spice));
        dish.setImageUrl(String.format("/assets/images/dish-%02d.jpg", imageNumber));
        dish.setActive(true);
        dish.setCreatedAt(Instant.now(clock));
        dish.setUpdatedAt(Instant.now(clock));
        return new SeedDish(dish);
    }

    private Dish save(SeedDish seedDish) {
        return dishes.save(seedDish.dish);
    }

    private OptionBuilder opt(String name, long extraCents) {
        return new OptionBuilder(name, extraCents);
    }

    private record OptionBuilder(String name, long extraCents) {}

    /** Small fluent helper so the seed data above stays readable. */
    private static class SeedDish {
        private final Dish dish;

        SeedDish(Dish dish) {
            this.dish = dish;
        }

        SeedDish required(String groupName, boolean multi, String... optionNames) {
            DishOptionGroup group = new DishOptionGroup();
            group.setName(groupName);
            group.setRequired(true);
            group.setMultiSelect(multi);
            group.setSortOrder(dish.getOptionGroups().size());
            int order = 0;
            for (String name : optionNames) {
                DishOption option = new DishOption();
                option.setName(name);
                option.setExtraPrice(BigDecimal.ZERO.setScale(2));
                option.setSortOrder(order++);
                group.addOption(option);
            }
            dish.addOptionGroup(group);
            return this;
        }

        SeedDish addOns(OptionBuilder... options) {
            DishOptionGroup group = new DishOptionGroup();
            group.setName("Add-ons");
            group.setRequired(false);
            group.setMultiSelect(true);
            group.setSortOrder(dish.getOptionGroups().size());
            int order = 0;
            for (OptionBuilder builder : options) {
                DishOption option = new DishOption();
                option.setName(builder.name());
                option.setExtraPrice(Money.fromCents(builder.extraCents()));
                option.setSortOrder(order++);
                group.addOption(option);
            }
            dish.addOptionGroup(group);
            return this;
        }
    }
}
