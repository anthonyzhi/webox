# WeBox — Corporate Employee Meal Ordering Platform

A production-minded full-stack implementation of the WeBox PRD: employees browse the day's menu, customise
dishes, order lunch or dinner, and the canteen manages the catalogue, the daily menu and the numbers from a
separate **Console** module.

* **All user-facing text is English** (UI copy, dish data, toasts, validation, AI reasons) as required by §1 of the PRD.
* **Tier 1 + Tier 2 complete, Tier 3 implemented** — see [Feature coverage](#feature-coverage).
* **Stack**: vanilla ES-module SPA (no build step) → Java 17 + Spring Boot 3.2 REST/SSE API → standalone MySQL 8.

> 中文速览：本项目为一套完整可运行的全栈实现（前端零构建 SPA + Java 17/Spring Boot + 独立 MySQL 8）。
> 员工端含注册登录、菜单搜索/筛选/分页、自定义选项与实时价格、购物车、结算下单（幂等）、订单管理、
> 饮食偏好与订餐规则；Console 后台含菜品管理、每日菜单与库存、经营数据看板；Tier 3 的库存实时同步（SSE）、
> 防超卖扣减、AI 推荐（LLM 流式 / 无 Key 时降级为本地规则推荐）均已实现。启动步骤见下文
> [Quick start](#quick-start)。

---

## Feature coverage

| Tier | Feature | Status | Where |
|------|---------|--------|-------|
| 1 | Registration / login, email + password rules, hashed passwords, session survives refresh | ✅ | `AuthController`, `AuthService`, `js/pages/auth.js` |
| 1 | Daily menu cards with image, price (¥ to the cent), cuisine tag | ✅ | `MenuController`, `js/pages/menu.js` |
| 1 | Dish detail: description, protein, allergens, spice level | ✅ | `GET /api/menu/items/{id}`, `js/pages/dish.js` |
| 1 | Customisation options (required/optional, single/multi, surcharges) with live price | ✅ | `dish_option_groups`, `dish_options`, `js/pages/dish.js` |
| 1 | Category filter (multi-select) + search (name & description) | ✅ | `DailyMenuRepository.searchMenu`, `MenuService` |
| 1 | Cart: repeat adds, quantity edit, remove, live total, distinct lines per option set | ✅ | `js/store.js`, cart drawer |
| 1 | Checkout: delivery date, meal period, address (history + new), order summary | ✅ | `OrderController`, `js/pages/checkout.js` |
| 1 | **Idempotent submission** — one order per submit attempt, even with rapid double clicks | ✅ | `OrderService.place` + `uk_orders_user_idempotency` |
| 1 | Order success page, order history, order detail, cancel while `Pending` | ✅ | `js/pages/orders.js` |
| 2 | Allergen flags with an add-to-cart confirmation (not filtering) | ✅ | `PreferenceService`, `js/app.js` |
| 2 | Cuisine / spice / taste preferences, "Recommend for me" ordering + highlighting | ✅ | `MenuService.search(personalized=true)` |
| 2 | Per-meal budget with a non-blocking checkout warning | ✅ | `js/pages/checkout.js` |
| 2 | **Max 5 servings per order**, enforced client *and* server side with a visible reason | ✅ | `MealSlotService.MAX_QUANTITY_PER_ORDER`, `OrderPlacementService` |
| 2 | **Cut-off times** 10:00 / 15:00 with automatic switch to the nearest bookable slot | ✅ | `MealSlotService`, `GET /api/orders/context` |
| 2 | **One active order per day + meal period** | ✅ | `uk_orders_active_slot`, `ACTIVE_ORDER_EXISTS` |
| 2 | Console: dish table with search/filter, create/edit, image upload, on/off shelf | ✅ | `AdminDishController`, `js/pages/console-dishes.js` |
| 2 | Console: set the daily menu (date + per-dish quantities), including *today* for demos | ✅ | `AdminMenuService`, `js/pages/console-menu.js` |
| 3 | Stock per dish per day, low-stock (≤3) and sold-out states, no ordering when sold out | ✅ | `daily_menu`, `stockView()` |
| 3 | **Realtime stock without refresh** (SSE push on every change) | ✅ | `StockStreamService`, `GET /api/stream/stock` |
| 3 | **No overselling under concurrency** (guarded SQL update) and re-validation at submit | ✅ | `DailyMenuRepository.reserveStock` |
| 3 | Stock returned when an order is cancelled | ✅ | `OrderService.cancel` |
| 3 | AI assistant: NL prompt, preference/allergen/7-day aware, streamed, dish cards with reasons | ✅ | `RecommendationService`, `js/ai.js` |
| 3 | Console dashboard: today's KPIs, top-10 bar chart, lunch vs dinner, 7-day trend, low stock | ✅ | `DashboardService`, `js/pages/console-dashboard.js` |

### Deliberate scope decisions

* **Redis is not used.** The PRD makes it optional; the same goals are met with an in-process Caffeine cache
  (write-through eviction on every admin change) plus MySQL row-level stock updates. See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#why-no-redis).
* **The Console does not change order status.** §4.3 specifies dish management and §5.3 the dashboard; order
  status transitions (`Pending → Confirmed → Completed`) are not part of the specified requirements, so the
  `Confirmed`/`Completed` figures come from seeded history. The data model already supports adding it.
* **The menu opens on "the current ordering day"**: today while a meal can still be ordered, and the next
  bookable day once both cut-offs have passed. Once 15:00 has gone, "today's menu" is unorderable, and opening
  the app on a menu that cannot be ordered would be a dead end (PRD §4.2 requires the auto-switch behaviour,
  which this makes consistent).

---

## Architecture at a glance

```
  ┌──────────────────────────── Browser (mobile + desktop) ────────────────────────────┐
  │  Vanilla ES-module SPA  (frontend/)                                                │
  │   hash router · reactive store · fetch wrapper · SSE client · hand-rolled SVG charts │
  └───────────────┬───────────────────────────────┬────────────────────────────────────┘
                  │ REST (JSON, cents)            │ SSE (stock, AI tokens)
  ┌───────────────▼───────────────────────────────▼────────────────────────────────────┐
  │  Spring Boot 3.2 · JDK 17   (backend/)                                             │
  │  Controllers ── AuthInterceptor(@RequireRole) ── GlobalExceptionHandler            │
  │  Services: Auth · Menu(+Caffeine cache) · OrderPlacement/Order · Preference         │
  │            AdminDish · AdminMenu · Dashboard · StockStream(SSE) · Recommendation(AI) │
  │  Repositories: Spring Data JPA (no SQL string building anywhere)                     │
  └───────────────┬────────────────────────────────────────────────────────────────────┘
                  │ JDBC (HikariCP)
  ┌───────────────▼────────────────────────────────────────────────────────────────────┐
  │  MySQL 8 (standalone process, schema.sql applied on boot, DataSeeder seeds demos)   │
  └────────────────────────────────────────────────────────────────────────────────────┘
```

Details — module boundaries, data flow, the concurrency and idempotency decisions, and the caching strategy —
are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The HTTP contract is in [docs/API.md](docs/API.md).

### Tech choices and why

| Choice | Why |
|--------|-----|
| **Java 17 + Spring Boot 3.2** | Required by the PRD. Boot gives production-grade HTTP, JPA, validation, scheduling and connection pooling without bespoke plumbing. Bytecode targets 17 (`maven.compiler.release=17`). |
| **MySQL 8, standalone** | Required by the PRD (no embedded DB). Real transactions, real row locking, real `DECIMAL`. |
| **Spring Data JPA** | Search/filter/paging run in SQL with bound parameters, which is also the SQL-injection defence. |
| **Caffeine (in-process cache)** | The menu is read hundreds of times a minute during the 09:30–10:00 rush; the dish catalogue is cached with explicit eviction on admin writes. Chosen over Redis because the PRD makes an external cache optional and a single-node deployment gains nothing from the extra moving part. |
| **Opaque DB-backed sessions + BCrypt** | Sessions survive restart and work across instances; passwords are never stored in plain text. A small `AuthInterceptor` enforces authentication and `@RequireRole` authorisation explicitly per handler. |
| **SSE (not WebSocket)** | Stock updates and AI output are one-directional; `EventSource` reconnects automatically and needs no protocol handshake. |
| **Vanilla ES-module SPA, no bundler** | Zero build step means "clone → run" is literally one command, with no toolchain drift. The app needs routing, a reactive store, fetch and two charts — hand-rolled in ~7k lines of dependency-free JS. Responsive layout, debounced inputs, cent-exact money and XSS-safe rendering are all implemented directly. |
| **Integer cents over the wire** | Eliminates float drift; the DB stores `DECIMAL(10,2)` and the UI formats `¥22.50`. |
| **OpenAI-compatible LLM client** | One streaming client works with OpenAI, DeepSeek, Qwen-compatible endpoints, Moonshot or a local vLLM/Ollama gateway — just point `LLM_BASE_URL` at it. |

---

## Quick start

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| JDK | **17** (17+ also fine) | `java -version` |
| Maven | 3.8+ | any recent Maven |
| MySQL | **8.x**, as a standalone server | must be running and reachable over TCP |

### 1. Start MySQL and create the database

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS webox CHARACTER SET utf8mb4;"
```

The JDBC URL also carries `createDatabaseIfNotExist=true`, so on a local instance this step is optional —
the schema itself is always created/updated by `schema.sql` on boot.

### 2. Run the application

```bash
cd backend
mvn spring-boot:run          # compiles, copies the SPA into the jar's static assets, starts on :8080
```

Open **http://localhost:8080** — the API and the UI are served by the same process.

Or use the helper script, which also starts MySQL if needed and loads `webox/.env`
(the AI assistant is wired to DeepSeek via that file — see the LLM variables below):

```bash
scripts/run-backend.sh
```

Connection settings come from the environment (defaults in brackets):

```bash
DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=webox DB_USERNAME=root DB_PASSWORD=secret \
WEB0X_TZ=Asia/Shanghai SERVER_PORT=8080 \
mvn spring-boot:run
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_HOST` / `DB_PORT` / `DB_NAME` | `127.0.0.1` / `3306` / `webox` | MySQL connection |
| `DB_USERNAME` / `DB_PASSWORD` | `root` / *(empty)* | MySQL credentials |
| `DB_POOL_SIZE` | `20` | Hikari pool size |
| `WEB0X_TZ` | `Asia/Shanghai` | Canteen timezone — drives the 10:00 / 15:00 cut-offs and dashboard days |
| `SERVER_PORT` | `8080` | HTTP port |
| `WEB0X_UPLOAD_DIR` | `./uploads` | Where Console image uploads are written (also served at `/uploads/**`) |
| `LLM_API_KEY` | *(empty)* | Enables the real LLM for AI recommendations |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `LLM_MODEL` | `gpt-4o-mini` | Model name |

### 3. Sign in

The first start seeds a demo-ready dataset: 20 dishes, today's and tomorrow's menu with stock, a week of order
history, and these accounts:

| Role | Email | Password |
|------|-------|----------|
| Employee | `employee@webox.com` | `Employee123` |
| Admin (Console) | `admin@webox.com` | `Admin12345` |

The demo employee already flags **Egg** as an allergen and prefers Chinese/Japanese with a ¥15–¥40 budget, so
the allergen prompt, personalisation and AI filtering are all visible immediately.

### 4. Verify

```bash
mvn test                       # 31 unit tests: cut-offs, money, search sanitising, preferences, AI ranking
./scripts/smoke-test.sh        # 42 end-to-end assertions against a running instance
```

The smoke test exercises what matters most: idempotent re-submission, the 5-serving cap, one-active-order-per-slot,
**three employees racing for the last portion (exactly one wins)**, stock returned on cancellation, Console
authorisation, the SSE streams and the registration rules.

### 5. Enable real AI recommendations (optional)

```bash
export LLM_API_KEY=sk-...                 # plus LLM_BASE_URL / LLM_MODEL if not OpenAI
mvn spring-boot:run
```

Without a key the assistant still works: the deterministic on-device ranker streams the same event sequence and
the UI says so explicitly (`No LLM is configured, so we matched dishes on-device…`). Rules that apply in **both**
modes: dishes containing a flagged allergen, sold-out dishes and dishes ordered in the last 7 days are removed
before ranking, and a dish id the model invents is dropped when the streamed answer is parsed.

---

## Repository layout

```
webox/
├── backend/                     Spring Boot application (Maven)
│   └── src/main/java/com/webox/
│       ├── domain/              JPA entities + shared enums
│       ├── repository/          Spring Data repositories (incl. the guarded stock UPDATE)
│       ├── service/             business rules (menu, orders, preferences, Console, SSE)
│       │   └── ai/              LLM client + recommendation orchestration
│       ├── web/                 controllers, auth interceptor, @RequireRole
│       ├── dto/                 request/response records
│       ├── common/              ApiException, error envelope, money, JSON helpers
│       └── config/              properties, caches, clock, seeder, schema
│   └── src/main/resources/schema.sql     idempotent DDL, applied on every boot
│   └── src/test/java/...         unit tests (no database required)
├── frontend/                    Zero-build SPA (copied into the jar during `process-resources`)
│   ├── index.html · styles.css
│   ├── js/  api · store · router · utils · ai · app + pages/ (employee & Console)
│   └── assets/images/           20 dish photos from the candidate pack
├── docs/API.md                  full HTTP contract (paths, payloads, error codes)
├── docs/ARCHITECTURE.md         modules, data flow, concurrency, caching, trade-offs
├── scripts/smoke-test.sh        end-to-end assertions
└── ai-conversations/            raw AI coding transcript(s) — see its README
```

## Environment notes (this machine)

The sandbox had no JDK 17, Maven or MySQL and Maven Central is unreachable, so the following local adjustments
were made — they do not affect the project itself:

* **Maven mirror** in `~/.m2/settings.xml` routes `central` to `https://mirrors.cloud.tencent.com/nexus/repository/maven-public/`.
* **MySQL 8.0.29** was installed from a binary tarball into `~/tools/mysql` (Homebrew has no bottle for this
  macOS build) and started with
  `~/tools/mysql/bin/mysqld --basedir=~/tools/mysql --datadir=~/tools/mysql/data --socket=/tmp/mysql-webox.sock --mysqlx=0`.
* **Temurin JDK 17** lives in `~/tools/jdk/jdk-17.0.20.1+1` and **Maven 3.9.16** in `~/tools/maven`; the app was
  built and run with `JAVA_HOME=~/tools/jdk/jdk-17.0.20.1+1/Contents/Home ~/tools/maven/bin/mvn spring-boot:run`.
