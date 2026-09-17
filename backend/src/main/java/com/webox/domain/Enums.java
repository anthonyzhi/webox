package com.webox.domain;

/** Fixed vocabularies shared by the menu, preferences and the Console. Kept as enums so the
 *  database, the API and the UI cannot drift apart. */
public final class Enums {

    private Enums() {}

    public enum Role { EMPLOYEE, ADMIN }

    public enum Category { Chinese, Western, Japanese, Korean, Light_Meal, Southeast_Asian;
        /** Enum name uses underscores (Java identifiers); the wire/DB value uses spaces. */
        public String value() { return name().replace('_', ' '); }
        public static Category fromValue(String v) {
            if (v == null) return null;
            String n = v.trim().replace(' ', '_');
            for (Category c : values()) if (c.name().equalsIgnoreCase(n)) return c;
            return null;
        }
    }

    public enum SpiceLevel { None, Mild, Medium, Hot }

    public enum Allergen { Peanuts, Dairy, Egg, Gluten, Soy, Fish, Shellfish }

    public enum Taste { Light, Balanced, Rich }

    public enum MealPeriod { LUNCH, DINNER }

    public enum OrderStatus { Pending, Confirmed, Completed, Cancelled;
        public boolean isActive() { return this == Pending || this == Confirmed; }
    }
}
