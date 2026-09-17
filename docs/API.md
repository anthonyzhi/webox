# WeBox API Contract (v1)

Base URL: `http://localhost:8080/api` — the SPA is served by the same Spring Boot process from `/`.

Conventions

- **Money is always an integer count of cents** in JSON (`priceCents: 2200` = ¥22.00). The UI formats it as `¥22.00`. No floats cross the wire.
- **Dates** are `YYYY-MM-DD` strings, times `YYYY-MM-DDTHH:mm:ss` (server timezone, default `Asia/Shanghai`).
- **Auth**: `Authorization: Bearer <token>` on every request except `/api/auth/register`, `/api/auth/login` and static assets.
- **Errors** always use: `{ "code": "STRING_CODE", "message": "English human message", "fieldErrors": {"email":"..."}, "details": {...} }`
  with HTTP 400 (validation), 401 (unauthenticated), 403 (wrong role), 404 (missing), 409 (business conflict).
- All user-facing strings (messages, dish data, reasons) are **English**.

## Enums

| Enum | Values |
|------|--------|
| role | `EMPLOYEE`, `ADMIN` |
| category | `Chinese`, `Western`, `Japanese`, `Light Meal`, `Korean`, `Southeast Asian` |
| spiceLevel | `None`, `Mild`, `Medium`, `Hot` |
| allergen | `Peanuts`, `Dairy`, `Egg`, `Gluten`, `Soy`, `Fish`, `Shellfish` |
| taste | `Light`, `Balanced`, `Rich` |
| mealPeriod | `LUNCH`, `DINNER` |
| orderStatus | `Pending`, `Confirmed`, `Completed`, `Cancelled` |

`GET /api/meta/enums` → `{categories, spiceLevels, allergens, tastes, mealPeriods, orderStatuses, currencySymbol:"¥"}` (auth required).

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{email,password,displayName}` | 201 `{token,expiresAt,user}` |
| POST | `/api/auth/login` | `{email,password}` | 200 `{token,expiresAt,user}` |
| POST | `/api/auth/logout` | – | 204 |
| GET | `/api/auth/me` | – | `{user, preferences}` |

`user = {id,email,displayName,role}`.
Validation: `email` ≤200 chars + RFC-ish format, `password` 8–72 chars containing a letter and a digit,
`displayName` 1–100 chars. Errors: `VALIDATION_ERROR` (400, `fieldErrors`), `EMAIL_TAKEN` (409),
`INVALID_CREDENTIALS` (401, `"Incorrect email or password."`), `UNAUTHENTICATED` (401).

## Menu (employee)

`GET /api/menu?date=YYYY-MM-DD&categories=Chinese,Japanese&q=&page=0&size=12&sort=default|price_asc|price_desc|name&personalized=true`

```json
{
  "date": "2026-09-17",
  "page": 0, "size": 12, "totalElements": 12, "totalPages": 1,
  "categories": [{"value":"Chinese","count":3}],
  "items": [{
    "menuId": 1, "dishId": 1,
    "name": "Kung Pao Chicken",
    "description": "Classic Sichuan dish, chicken stir-fried with peanuts and dried chili",
    "priceCents": 2200, "category": "Chinese", "protein": "Chicken",
    "allergens": ["Peanuts"], "spiceLevel": "Medium",
    "imageUrl": "/assets/images/dish-01.jpg",
    "remaining": 12, "lowStock": false, "soldOut": false,
    "optionGroups": [{"id": 3, "name": "Bun", "required": true, "multiSelect": false,
                      "options": [{"id": 9, "name": "Plain", "extraPriceCents": 0},
                                  {"id": 10, "name": "Whole Wheat", "extraPriceCents": 0}]}],
    "preferenceMatch": {"preferredCuisine": true, "spiceMatch": true, "withinBudget": true},
    "recommended": false
  }],
  "rules": {"maxQuantityPerOrder": 5,
            "nextSlot": {"deliveryDate":"2026-09-17","mealPeriod":"DINNER","label":"Today Dinner","cutoffAt":"2026-09-17T15:00:00","autoSwitched":false}}
}
```

- `q` ≤50 chars, matched case-insensitively against name + description (server-side prepared statement, no string concatenation).
- `categories` is a comma-separated **multi-select**; omitted = all.
- `categories[]` facet counts respect `date` + `q` but ignore the category filter.
- Sold-out and inactive dishes are never returned; `date` defaults to today.
- `personalized=true` sorts preferred cuisines first and marks `recommended` for the best matches; default keeps catalog order.
- Cached (Caffeine): dish catalog 300 s, daily menu composition 20 s, both explicitly evicted on admin writes and stock changes.

`GET /api/menu/items/{menuId}` → one item in the same shape as `items[]` plus `"rules"`. `MENU_ITEM_NOT_FOUND` (404).

## Preferences / addresses (employee)

| Method | Path | Body / Response |
|---|---|---|
| GET | `/api/me/preferences` | `{allergens:[],cuisinePreferences:[],spiceLevel:null,taste:null,budgetMinCents:null,budgetMaxCents:null,recommendEnabled:false}` |
| PUT | `/api/me/preferences` | same body (all fields optional) → updated object |
| GET | `/api/me/addresses` | `[{id,address,lastUsedAt}]` (≤10, most recent first) |

Validation: `allergens`/`cuisinePreferences` ⊆ enums, `spiceLevel`/`taste` ∈ enums or null,
`budgetMinCents` ≤ `budgetMaxCents`, each 0–100000.

## Orders

| Method | Path | Notes |
|---|---|---|
| GET | `/api/orders/context?deliveryDate=&mealPeriod=` | `{nextSlot:{...},requestedSlotBookable,autoSwitched,existingActiveOrder:{id,orderNo,status}\|null,rules:{maxQuantityPerOrder,lunchCutoff:"10:00",dinnerCutoff:"15:00"}}` |
| POST | `/api/orders` | header `Idempotency-Key` (required, ≤80, `[A-Za-z0-9_-]+`) |
| GET | `/api/orders?page=0&size=10` | paged list, newest first |
| GET | `/api/orders/{id}` | detail with item options |
| POST | `/api/orders/{id}/cancel` | only `Pending` → `Cancelled`, restores stock |

`POST /api/orders` body:

```json
{"deliveryDate":"2026-09-17","mealPeriod":"LUNCH","address":"Building A, Floor 3",
 "items":[{"menuId":1,"quantity":2,"optionIds":[9,12]}]}
```

- **Idempotency**: replaying the same `Idempotency-Key` returns the original order with `"replayed": true` (HTTP 200); a fresh key returns 201. Concurrent duplicates are caught by the `uk_orders_user_idempotency` unique index.
- **Cut-off auto-switch**: lunch orders must be placed before 10:00, dinner before 15:00. If the requested slot has passed, the server books the nearest bookable slot (today's dinner if before 15:00, otherwise tomorrow's lunch) and sets `autoSwitched: true` plus `slotAdjustedFrom`.
- **One active order per slot**: `ACTIVE_ORDER_EXISTS` (409) with `details:{orderId,orderNo}` when the user already has a `Pending`/`Confirmed` order for that date+meal. Enforced by the `uk_orders_active_slot` unique index.
- **Stock**: deducted with guarded `UPDATE ... WHERE sold_quantity + n <= total_quantity` in the same transaction; never oversells under concurrency. On shortfall → `INSUFFICIENT_STOCK` (409) with `details.items:[{menuId,dishName,requested,remaining}]`.
- Other errors: `MAX_QUANTITY_EXCEEDED` (409, total servings > 5), `MENU_ITEM_NOT_FOUND` (404), `MENU_CLOSED` (409, dish not on that day's menu), `INVALID_OPTIONS` (400, `details:{menuId,groupName,message}` for unknown option, missing required group, or two options from a single-select group), `VALIDATION_ERROR` (400, address 1–200 chars, quantity 1–5, items 1–10 lines).
- Order detail item shape: `{dishName,imageUrl,quantity,basePriceCents,optionsPriceCents,unitPriceCents,subtotalCents,options:[{groupName,optionName,extraPriceCents}]}`.
- List item shape: `{id,orderNo,status,deliveryDate,mealPeriod,address,totalCents,totalQuantity,createdAt,itemSummary}`.
- Cancel: `ORDER_NOT_CANCELLABLE` (409) unless status is `Pending`; stock is returned to `daily_menu`.

## Console (role `ADMIN` only — employees get 403 `FORBIDDEN`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/dishes?q=&category=&active=&page=&size=` | paged dish table incl. `optionGroups` |
| POST | `/api/admin/dishes` | create, 201 |
| PUT | `/api/admin/dishes/{id}` | full update incl. option groups |
| PATCH | `/api/admin/dishes/{id}/status` | `{active:true\|false}` — inactive dishes disappear from the employee menu |
| POST | `/api/admin/uploads` | multipart `file` (jpeg/png/webp ≤5 MB) → `{url:"/uploads/xxx.jpg"}` |
| GET | `/api/admin/daily-menu?date=YYYY-MM-DD` | `{date,items:[{menuId,dishId,dishName,category,imageUrl,priceCents,totalQuantity,soldQuantity,remaining,active}]}` |
| PUT | `/api/admin/daily-menu` | `{date,items:[{dishId,totalQuantity}]}` replaces the day's menu; `MENU_HAS_SALES` (409) when dropping a dish with sales |
| GET | `/api/admin/dashboard?date=YYYY-MM-DD` | see below |

```json
{"date":"2026-09-17",
 "today":{"orderCount":8,"totalRevenueCents":21450,"completed":3,"pending":4,"confirmed":1,"cancelled":2},
 "topDishes":[{"dishName":"Kung Pao Chicken","quantity":12,"revenueCents":26400}],
 "mealPeriod":[{"mealPeriod":"LUNCH","orderCount":6,"revenueCents":16000},{"mealPeriod":"DINNER","orderCount":2,"revenueCents":5450}],
 "trend":[{"date":"2026-09-11","orderCount":5,"revenueCents":12300}],
 "lowStock":[{"menuId":4,"dishName":"Tom Yum Soup","remaining":2}]}
```

Dish write body: `{name(1-120),description(1-500),priceCents(0-100000),category,protein(≤120),allergens[],spiceLevel,imageUrl(≤300),active,optionGroups:[{name(1-60),required,multiSelect,sortOrder,options:[{name(1-60),extraPriceCents(0-100000)}]}]}`.
`DISH_NAME_TAKEN` (409) on duplicate name; `DUPLICATE_OPTION_NAME` (400) inside a group.

## Realtime stock (SSE)

`GET /api/stream/stock?date=YYYY-MM-DD` → `text/event-stream`

```
event: snapshot      data: {"date":"2026-09-17","items":[{"menuId":1,"remaining":12,"lowStock":false,"soldOut":false}]}
event: stock         data: {"date":"2026-09-17","at":"2026-09-17T10:02:11","items":[{"menuId":1,"remaining":11,"lowStock":false,"soldOut":false}]}
: keep-alive
```

Only changed rows are pushed; a comment heartbeat every 20 s keeps proxies happy. `EventSource` cannot set headers,
so this endpoint also accepts `?token=<token>` as a query parameter.

## AI recommendation (SSE)

`GET /api/ai/recommend?prompt=I%20want%20something%20light&date=YYYY-MM-DD` → `text/event-stream`
(`prompt` required, 1–300 chars; auth required; `token` query param also accepted)

```
event: provider  data: {"provider":"openai","model":"gpt-4o-mini"}     // or {"provider":"rule-based"}
event: candidate data: {"count":9}
event: delta     data: {"text":"## "}                                  // raw streamed text (may be empty for rule-based)
event: dish      data: {"menuId":4,"reason":"Grilled chicken with quinoa fits a light, high-protein goal."}
event: done      data: {"recommendations":[{"menuId":4,"reason":"..."}]}
event: error     data: {"message":"LLM request failed, falling back to on-device matching."}
```

Candidate filtering (always applied before any LLM call): dish available today, not sold out, contains **no** allergen
the employee flagged, and excludes dishes ordered by that employee in the **last 7 days**.
With no `LLM_API_KEY` configured the server automatically uses the deterministic rule-based ranker and streams
`dish` events the same way, so the UI path is identical.
