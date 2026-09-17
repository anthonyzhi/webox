# WeBox — Architecture

This document explains how the system is put together, why the risky parts (concurrency, idempotency, caching)
were solved the way they were, and where the trade-offs are.

---

## 1. Context and constraints

The PRD pins down four things that shape every design decision:

1. **A real database must be the source of truth** — standalone MySQL, no embedded engines, money to the cent.
2. **The menu is read hard between 09:30 and 10:00** while many employees order the *same* dishes.
3. **An order must be created exactly once** per submission, even when the employee double-clicks on a slow network.
4. **The catalogue grows** (~50 dishes today, more later), so menu queries must stay cheap as it grows.

Everything below follows from those four.

---

## 2. Layering

```
web/         Controllers (HTTP shape only) + AuthInterceptor + @RequireRole + GlobalExceptionHandler
service/     Business rules and transaction boundaries — the only place that mutates domain state
repository/  Spring Data JPA interfaces; the only place that talks SQL
domain/      JPA entities + the fixed vocabularies (Category, SpiceLevel, Allergen, MealPeriod, OrderStatus)
dto/         Immutable request/response records — entities never leave the service layer
common/      ApiException, error envelope, Money, JSON helpers
config/      Properties, Caffeine caches, Clock, WebMvcConfigurer, DataSeeder, SessionJanitor
```

Rules that keep the layering honest:

* Controllers never touch repositories; they translate HTTP to service calls and let `GlobalExceptionHandler`
  shape failures into `{code, message, fieldErrors?, details?}`.
* Entities are mapped to DTOs inside the service, so lazy-loading surprises and accidental over-exposure of
  internal fields cannot leak to the API.
* `OrderPlacementService` is split from `OrderService` **because of transaction semantics** (see §5.2), not for
  cosmetic reasons.

### Frontend structure

```
js/api.js      fetch wrapper: base URL, bearer token, JSON, ApiError{code,message,fieldErrors,details}, 401 handling
js/store.js    single reactive store: session, cart, preferences, rules; persisted to localStorage
js/router.js   hash routing with role guards (employee vs Console layout)
js/utils.js    money formatting/parsing, escaping, debounce, validation helpers, badges, skeletons
js/ai.js       assistant panel + SSE client for conversational recommendations
js/app.js      shell: header/bottom nav, cart drawer, dialogs, toasts, session hydration
js/pages/*     one module per screen (menu, dish, checkout, orders, preferences, Console ×3)
```

Each page module owns its markup and event wiring and is torn down by the router (it returns a `cleanup`
function that aborts in-flight fetches, unsubscribes from the store and closes the SSE connection).

---

## 3. Data model

| Table | Purpose | Integrity guarantees |
|-------|---------|----------------------|
| `users` | employees and admins | `uk_users_email` (case-insensitive check in the service + unique index) |
| `user_preferences` | allergens, cuisines, spice, taste, budget | 1:1 with `users`, `ON DELETE CASCADE` |
| `user_addresses` | delivery address history | `uk_addr_user_address` prevents duplicates |
| `user_sessions` | opaque bearer tokens | PK on the token, `expires_at`, purged hourly by `SessionJanitor` |
| `dishes` | catalogue with price, protein, allergens, spice, image, shelf flag | `idx_dishes_active_category`, `idx_dishes_name` |
| `dish_option_groups` / `dish_options` | customisation (required/optional, single/multi, surcharge) | cascade delete with the dish |
| `daily_menu` | per-day availability and stock | `uk_menu_date_dish`; `idx_menu_date` drives every menu read; `sold_quantity` moves only via guarded UPDATE |
| `orders` | order header, totals, slot | `uk_orders_no`, **`uk_orders_user_idempotency`**, **`uk_orders_active_slot`** |
| `order_items` | price/name snapshot per line + option JSON + `menu_id` | `menu_id` is what makes cancellation able to give stock back |

Money is `DECIMAL(10,2)` everywhere and integer cents in the API; there is no `double` for money in the codebase.

---

## 4. Read path: menu (the hot path)

```
GET /api/menu?date&categories&q&page&size&sort&personalized
  │
  ├─ DailyMenuRepository.searchMenu(...)      SQL: filter + sort + LIMIT, index on (menu_date)
  │        └─ returns only the requested page (12 rows) with its dish joined
  ├─ CatalogService.catalog()                 Caffeine: dishId → price/allergens/spice/option groups
  ├─ PreferenceService.view(userId)           cuisine/spice/budget used for matching + highlighting
  └─ facets + rules                           category counts (SQL GROUP BY), next bookable slot
```

Why this shape:

* **Stock is never cached** — it changes on every order, so `remaining` is read live. What *is* cached is the
  expensive, rarely changing part: the dish definition with its option groups (3 queries per dish → 3 queries
  for the entire catalogue, thanks to `@BatchSize`).
* **Filtering, sorting and paging happen in SQL**, so a growing catalogue does not push work into the JVM.
* **The personalised path is the exception**: preference ordering cannot be expressed as an `ORDER BY` over
  preference data, so with `personalized=true` the (small) match set is ranked in memory and then sliced.
  The default path stays fully SQL-paged.
* Cache invalidation is **write-through**: every Console write (dish create/update/shelf change) calls
  `CatalogService.evict()`, with the 300 s TTL only as a safety net, so employees never see a stale dish.

---

## 5. Write path: placing an order

### 5.1 The whole transaction

```
POST /api/orders  (Idempotency-Key: <one key per checkout attempt>)
  │
  ├─ 0. key format check, then look up (user, key)            → replay? return the original order (200, replayed)
  ├─ 1. MealSlotService.resolve(date, period)                 → nearest bookable slot (10:00 / 15:00 cut-offs)
  ├─ 2. total servings > 5 ?                                  → 409 MAX_QUANTITY_EXCEEDED
  ├─ 3. load daily_menu rows for the requested items          → missing row → 404 / off-date → 409 MENU_CLOSED
  ├─ 4. validate options against the dish definition, price   → 400 INVALID_OPTIONS
  │      (server recomputes every cent; nothing about price is trusted from the client)
  ├─ 5. read stock, collect ALL shortfalls                    → 409 INSUFFICIENT_STOCK with per-dish detail
  ├─ 6. existing active order for that slot?                  → 409 ACTIVE_ORDER_EXISTS (+ orderId for the UI)
  ├─ 7. INSERT order + items, FLUSH                           → unique-index violations surface here
  ├─ 8. guarded UPDATE per menu row                           → 0 rows ⇒ 409 INSUFFICIENT_STOCK (rolled back)
  └─ 9. remember address, publish stock change AFTER COMMIT
```

### 5.2 Idempotency (the PRD's "only one order per submission")

Three independent layers, because each one alone has a hole:

| Layer | Catches | Hole it leaves |
|-------|---------|----------------|
| Client: one idempotency key per checkout attempt + button disabled while in flight | Accidental double clicks | Network retry, two tabs, a proxy replay |
| Server: `SELECT` by `(user_id, idempotency_key)` before doing any work | Ordinary retries | Two requests can pass the check simultaneously |
| DB: `uk_orders_user_idempotency` unique index | Genuine races | The losing transaction must still answer correctly |

The third layer is why `OrderService.place` is **not** `@Transactional` while `OrderPlacementService.place` is: when
two requests race, the loser's transaction is already marked rollback-only, so the recovery lookup has to run in a
fresh transaction. `OrderService` catches the `DataIntegrityViolationException`, re-reads by key and returns the
winner's order as `replayed: true`. The same catch distinguishes the other unique index (`uk_orders_active_slot`)
and re-throws it as a friendly `ACTIVE_ORDER_EXISTS`.

### 5.3 Never overselling

`OrderPlacementService.reserveStock` issues, once per menu row:

```sql
UPDATE daily_menu
   SET sold_quantity = sold_quantity + :qty, updated_at = :now
 WHERE id = :id AND sold_quantity + :qty <= total_quantity
```

The guard lives in the `WHERE` clause, so the check and the decrement are one atomic statement: concurrent
submissions serialise on the row, and a request that loses the race gets `0 rows updated` — which is translated
into `INSUFFICIENT_STOCK` naming the exact dishes and their real remaining counts. The step-5 pre-check exists
only to produce a friendlier message; step 8 is the authority. Both run in the same transaction as the insert, so
a failure leaves no half-created order.

Verified by `scripts/smoke-test.sh`: three employees order the last portion of a dish simultaneously → exactly one
`201`, two `409`s, final stock `0`, never negative.

### 5.4 One active order per slot

`orders.active_slot` holds `"{userId}:{date}:{period}"` while the order is `Pending`/`Confirmed` and is set to
`NULL` on cancel/complete. A single unique index on that nullable column expresses "at most one active order per
user per meal slot" — MySQL treats `NULL`s as distinct, so historical orders do not collide. The application
checks first (for a good error message with the existing order id) and the index is the backstop.

### 5.5 Cut-offs are decided by the server

`MealSlotService` owns "now" (an injected `Clock` bound to the canteen timezone) and implements the PRD example
literally: 10:30 lunch → today's dinner; 16:20 dinner → tomorrow's lunch; a date further out is preserved rather
than pulled forward. The browser never decides a cut-off — it asks `GET /api/orders/context` and renders the
answer, which keeps the rule in one place and makes it testable (`MealSlotServiceTest` pins 09:59:59 / 10:00:00 /
14:59 / 15:00:01).

### 5.6 Cancellation

Only `Pending` orders can be cancelled. The transaction flips the status, releases `active_slot` and calls
`releaseStock` for every item that has a `menu_id`, so the portions return to the exact menu row they came from.
Note the ordering detail: the stock statements use Hibernate's `clearAutomatically`, so `OrderService.cancel`
captures the item list *before* releasing stock and builds the response from those already-loaded entities.

---

## 6. Realtime stock (SSE)

`StockStreamService` keeps a date-keyed set of `SseEmitter`s. On subscribe, a client immediately receives a
`snapshot` event; afterwards every order, cancellation or Console menu edit publishes only the changed rows via
`publishAfterCommit` — a `TransactionSynchronization` `afterCommit` hook, so a rolled-back order can never
advertise stock that was never taken. A `@Scheduled` heartbeat keeps intermediaries from dropping idle streams
and prunes dead subscribers. `EventSource` cannot set headers, so the auth interceptor also accepts `?token=`.

---

## 7. AI recommendations

Two hard rules, applied before any model is involved:

1. **Safety filter**: candidates are restricted to dishes available today, not sold out, containing **none** of the
   employee's flagged allergens, and not ordered by them in the **last 7 days**.
2. **The model only ranks**; it never introduces a dish. Streamed output is parsed as `MENU_ID|reason` lines and any
   id outside the candidate set is dropped — a hallucinated dish cannot reach the UI.

Providers:

* `OpenAiCompatibleLlmClient` streams `/chat/completions` with `stream:true` over `java.net.http`, forwarding each
  content delta to the browser as a `delta` event. Any OpenAI-compatible endpoint works by configuration.
* **Fallback chain**: no key → deterministic ranker; key present but the call fails → an `error` event followed by
  the ranker, so the feature is never dead. Both paths emit the same `provider/candidate/delta/dish/done` sequence,
  and the UI states which one answered.

---

## 8. Security

| Concern | Handling |
|---------|----------|
| Password storage | BCrypt (cost 10); the plaintext never leaves the request object. |
| Password policy | ≥8 chars with letters **and** digits, ≤72 chars, enforced by Bean Validation. |
| Session | 256-bit random opaque token in `user_sessions` with TTL; logout deletes the row. |
| Authorisation | `AuthInterceptor` requires a valid session for every `/api/**` call (explicit public allow-list) and enforces `@RequireRole` per handler; the Console controllers are annotated `ADMIN`, so employees get `403`. |
| SQL injection | No SQL is built by string concatenation anywhere; JPQL/native queries use bound parameters, and LIKE wildcards in the search box are escaped so `%` is a literal. |
| XSS | The SPA escapes every dynamic value through `escapeHtml` before it reaches `innerHTML`; no `eval`, no inline event handlers. |
| Uploads | Content type + size validated (≤5 MB, JPEG/PNG/WebP), the stored filename is a UUID and the extension is derived from the validated type — never from the client's filename — and the resolved path is re-checked to stay inside the upload directory. |
| Input limits | `maxlength` on every field plus Bean Validation on every request DTO (email/address 200, search 50, AI prompt 300, dish name 120, description 500, …). |
| Error leakage | Unexpected exceptions are logged with a stack trace and returned as a generic English message with a code; validation failures return per-field messages only. |

---

## 9. Performance

* Menu reads: one indexed SQL page + one cache lookup for dish definitions; facets are a single `GROUP BY`.
* `@BatchSize` on option groups/options turns the catalogue load into 3 queries instead of 3×N.
* Order history: one page query plus **one** `IN` query for all its items (no N+1).
* Dashboard: aggregates run as `SUM`/`COUNT`/`GROUP BY` over indexed columns; the 7-day trend is 7 small
  counting queries (simpler and index-friendly than a date-truncating native query).
* The SPA renders only the current page, lazy-loads images with fixed aspect boxes, debounces search (300 ms) and
  guards repeat clicks (250 ms) on add/quantity buttons.
* HTTP compression is on for HTML/CSS/JS/JSON/SVG; the static assets are served by Spring Boot with
  `Cache-Control` defaults (fingerprinting is deliberately avoided so the source stays dependency-free and readable).

---

## 10. Trade-offs and what comes next

| Decision | Trade-off | If the project kept growing |
|----------|-----------|-----------------------------|
| In-process cache instead of Redis | Cache is per-instance; a second instance warms its own copy | Move to Redis with the same write-through eviction contract (the cache sits behind `CatalogService`, so the swap is local) |
| Guarded UPDATE instead of `SELECT … FOR UPDATE` | No read-modify-write window at all, but a failed reserve aborts the whole order | Keep as is; a "reserve then confirm" saga would only be needed if stock had to be held across a payment step |
| One active order per slot via a nullable unique column | Slightly unusual schema, entirely enforced by the DB | Add a maintenance job if `active_slot` ever needed historical variants |
| Unit tests + HTTP smoke test, no Testcontainers suite | `mvn test` runs anywhere with no infrastructure | Add Testcontainers-backed integration tests in CI where Docker is available |
| Vanilla SPA, no framework/bundler | Manual DOM wiring in exchange for zero toolchain | Only worth revisiting if the UI surface grew several times larger |
