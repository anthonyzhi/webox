package com.webox.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "webox")
public class AppProperties {

    private String timezone = "Asia/Shanghai";
    private String uploadDir = "./uploads";
    private Session session = new Session();
    private Cache cache = new Cache();
    private Llm llm = new Llm();

    public String getTimezone() { return timezone; }
    public void setTimezone(String timezone) { this.timezone = timezone; }
    public String getUploadDir() { return uploadDir; }
    public void setUploadDir(String uploadDir) { this.uploadDir = uploadDir; }
    public Session getSession() { return session; }
    public void setSession(Session session) { this.session = session; }
    public Cache getCache() { return cache; }
    public void setCache(Cache cache) { this.cache = cache; }
    public Llm getLlm() { return llm; }
    public void setLlm(Llm llm) { this.llm = llm; }

    public static class Session {
        private long ttlHours = 168;

        public long getTtlHours() { return ttlHours; }
        public void setTtlHours(long ttlHours) { this.ttlHours = ttlHours; }
    }

    /** Two hot caches: the dish catalogue (expensive joins, changed rarely) and the per-day menu
     *  composition (queried on every menu request during the 09:30-10:00 rush). */
    public static class Cache {
        private long dishTtlSeconds = 300;
        private long menuTtlSeconds = 20;

        public long getDishTtlSeconds() { return dishTtlSeconds; }
        public void setDishTtlSeconds(long dishTtlSeconds) { this.dishTtlSeconds = dishTtlSeconds; }
        public long getMenuTtlSeconds() { return menuTtlSeconds; }
        public void setMenuTtlSeconds(long menuTtlSeconds) { this.menuTtlSeconds = menuTtlSeconds; }
    }

    public static class Llm {
        private String baseUrl = "https://api.openai.com/v1";
        private String apiKey = "";
        private String model = "gpt-4o-mini";
        private int timeoutSeconds = 25;

        public boolean configured() {
            return apiKey != null && !apiKey.isBlank();
        }

        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public int getTimeoutSeconds() { return timeoutSeconds; }
        public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
    }
}
