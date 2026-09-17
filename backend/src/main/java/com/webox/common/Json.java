package com.webox.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;

/** Small JSON helpers for the denormalised columns (allergens, cuisine preferences, item options). */
public final class Json {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};

    private Json() {}

    public static List<String> toList(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return List.of(csv.split(",")).stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    public static String toCsv(List<String> values) {
        if (values == null || values.isEmpty()) return "";
        return String.join(",", values.stream().map(String::trim).filter(s -> !s.isEmpty()).distinct().toList());
    }

    public static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("Unable to serialise value", e);
        }
    }

    public static List<Map<String, Object>> readMapList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return MAPPER.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    public static List<String> readStringList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return MAPPER.readValue(json, STRING_LIST);
        } catch (Exception e) {
            return List.of();
        }
    }
}
