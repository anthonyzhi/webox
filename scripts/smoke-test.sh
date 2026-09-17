#!/usr/bin/env bash
# WeBox end-to-end smoke test.
# Drives the real HTTP API against a running instance and asserts the business rules that matter
# most: idempotent submission, the 5-serving cap, one active order per meal slot, guarded stock
# deduction (no overselling under concurrency), stock returned on cancellation, Console authorisation
# and the streaming endpoints.
#
# Usage:  ./scripts/smoke-test.sh [base-url]        (default http://localhost:8080)
set -uo pipefail

BASE="${1:-http://localhost:8080}"
API="$BASE/api"
RUN_ID=$(date +%s)
PASS=0
FAIL=0

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }

check() { # check <description> <actual> <expected>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1)); green "  PASS  $1"
  else
    FAIL=$((FAIL + 1)); red   "  FAIL  $1 (expected '$3', got '$2')"
  fi
}

json() { jq -r "$1" 2>/dev/null; }

post() { curl -s -o /tmp/webox-resp.json -w '%{http_code}' -X POST "$1" -H 'Content-Type: application/json' ${2:+-H "Authorization: Bearer $2"} ${3:+-H "Idempotency-Key: $3"} ${4:+-d "$4"}; }
get()  { curl -s -o /tmp/webox-resp.json -w '%{http_code}' "$1" ${2:+-H "Authorization: Bearer $2"}; }
body() { cat /tmp/webox-resp.json; }

info "WeBox smoke test against $BASE"

# ---------------------------------------------------------------- sign in
EMPLOYEE_TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"employee@webox.com","password":"Employee123"}' | json .token)
ADMIN_TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@webox.com","password":"Admin12345"}' | json .token)
[ -n "$EMPLOYEE_TOKEN" ] && [ "$EMPLOYEE_TOKEN" != "null" ] && check "employee can sign in" ok ok || check "employee can sign in" fail ok
[ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "null" ] && check "admin can sign in" ok ok || check "admin can sign in" fail ok

# ---------------------------------------------------------------- auth guards
post "$API/orders" "" "smoke-anon-0001" '{"deliveryDate":"2026-01-01","mealPeriod":"LUNCH","address":"x","items":[]}' > /dev/null
check "anonymous order is rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/orders" -H 'Content-Type: application/json' -d '{}')" "401"
get "$API/admin/dashboard" "$EMPLOYEE_TOKEN" > /dev/null
check "employee cannot reach the Console" "$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/dashboard" -H "Authorization: Bearer $EMPLOYEE_TOKEN")" "403"
get "$API/admin/dashboard" "$ADMIN_TOKEN" > /dev/null
check "admin can reach the Console" "$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/dashboard" -H "Authorization: Bearer $ADMIN_TOKEN")" "200"

# ---------------------------------------------------------------- menu reads
get "$API/menu?size=5" "$EMPLOYEE_TOKEN" > /dev/null
check "menu page returns dishes" "$(body | json '.items | length > 0')" "true"
MENU_DATE=$(body | json .date)
NEXT_DATE=$(body | json .rules.nextSlot.deliveryDate)
MEAL=$(body | json .rules.nextSlot.mealPeriod)
info "  ordering window: $MENU_DATE / next bookable slot $NEXT_DATE $MEAL"

check "search filters results" "$(curl -s "$API/menu?q=burger&size=50" -H "Authorization: Bearer $EMPLOYEE_TOKEN" | json '[.items[].name] | map(select(test("Burger"))) | length > 0')" "true"
check "unknown category is rejected" "$(curl -s -o /dev/null -w '%{http_code}' "$API/menu?categories=Martian" -H "Authorization: Bearer $EMPLOYEE_TOKEN")" "400"
check "category multi-select works" "$(curl -s "$API/menu?categories=Chinese,Japanese&size=50" -H "Authorization: Bearer $EMPLOYEE_TOKEN" | json '[.items[].category] | unique | sort | join(",")')" "Chinese,Japanese"

# ---------------------------------------------------------------- pick a dish on the bookable day
PLAIN_ITEM=$(curl -s "$API/menu?date=$NEXT_DATE&size=50" -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  | json '[.items[] | select(.optionGroups == [])][0] | "\(.menuId)|\(.name)|\(.remaining)|\(.priceCents)"')
PLAIN_MENU_ID=$(echo "$PLAIN_ITEM" | cut -d'|' -f1)
PLAIN_NAME=$(echo "$PLAIN_ITEM" | cut -d'|' -f2)
STOCK_BEFORE=$(echo "$PLAIN_ITEM" | cut -d'|' -f3)
info "  using menuId=$PLAIN_MENU_ID ($PLAIN_NAME) on $NEXT_DATE, stock=$STOCK_BEFORE"

# ---------------------------------------------------------------- idempotent submission
KEY="smoke-$(date +%s)-idem"
CODE=$(post "$API/orders" "$EMPLOYEE_TOKEN" "$KEY" "{\"deliveryDate\":\"$NEXT_DATE\",\"mealPeriod\":\"$MEAL\",\"address\":\"HQ Tower, Floor 12\",\"items\":[{\"menuId\":$PLAIN_MENU_ID,\"quantity\":2,\"optionIds\":[]}]}")
check "order is accepted (201)" "$CODE" "201"
ORDER_NO=$(body | json .order.orderNo)
TOTAL=$(body | json .order.totalCents)
check "server prices the order itself" "$TOTAL" "$(( $(echo "$PLAIN_ITEM" | cut -d'|' -f4) * 2 ))"

CODE=$(post "$API/orders" "$EMPLOYEE_TOKEN" "$KEY" "{\"deliveryDate\":\"$NEXT_DATE\",\"mealPeriod\":\"$MEAL\",\"address\":\"HQ Tower, Floor 12\",\"items\":[{\"menuId\":$PLAIN_MENU_ID,\"quantity\":2,\"optionIds\":[]}]}")
check "replayed submit returns 200" "$CODE" "200"
check "replay returns the same order" "$(body | json .order.orderNo)" "$ORDER_NO"
check "replay is flagged" "$(body | json .replayed)" "true"

CODE=$(post "$API/orders" "$EMPLOYEE_TOKEN" "smoke-$(date +%s)-other" "{\"deliveryDate\":\"$NEXT_DATE\",\"mealPeriod\":\"$MEAL\",\"address\":\"HQ Tower, Floor 12\",\"items\":[{\"menuId\":$PLAIN_MENU_ID,\"quantity\":1,\"optionIds\":[]}]}")
check "second order for the same slot is refused" "$CODE" "409"
check "  ... with ACTIVE_ORDER_EXISTS" "$(body | json .code)" "ACTIVE_ORDER_EXISTS"

STOCK_AFTER=$(curl -s "$API/menu/items/$PLAIN_MENU_ID" -H "Authorization: Bearer $EMPLOYEE_TOKEN" | json .item.remaining)
check "stock was deducted by 2" "$STOCK_AFTER" "$((STOCK_BEFORE - 2))"

CODE=$(post "$API/orders" "$EMPLOYEE_TOKEN" "smoke-$(date +%s)-cap" "{\"deliveryDate\":\"$NEXT_DATE\",\"mealPeriod\":\"DINNER\",\"address\":\"HQ Tower, Floor 12\",\"items\":[{\"menuId\":$PLAIN_MENU_ID,\"quantity\":3,\"optionIds\":[]},{\"menuId\":$PLAIN_MENU_ID,\"quantity\":3,\"optionIds\":[]}]}")
check "6 servings in one order is refused" "$CODE" "409"
check "  ... with MAX_QUANTITY_EXCEEDED" "$(body | json .code)" "MAX_QUANTITY_EXCEEDED"

# ---------------------------------------------------------------- cancellation returns stock
ORDER_ID=$(curl -s "$API/orders" -H "Authorization: Bearer $EMPLOYEE_TOKEN" | json '.items[0].id')
CODE=$(curl -s -o /tmp/webox-resp.json -w '%{http_code}' -X POST "$API/orders/$ORDER_ID/cancel" -H "Authorization: Bearer $EMPLOYEE_TOKEN")
check "pending order can be cancelled" "$CODE" "200"
check "  ... status becomes Cancelled" "$(body | json .status)" "Cancelled"
STOCK_RESTORED=$(curl -s "$API/menu/items/$PLAIN_MENU_ID" -H "Authorization: Bearer $EMPLOYEE_TOKEN" | json .item.remaining)
check "stock is returned to the menu" "$STOCK_RESTORED" "$STOCK_BEFORE"
CODE=$(curl -s -o /tmp/webox-resp.json -w '%{http_code}' -X POST "$API/orders/$ORDER_ID/cancel" -H "Authorization: Bearer $EMPLOYEE_TOKEN")
check "cancelling twice is refused" "$CODE" "409"

# ---------------------------------------------------------------- concurrency: no overselling
ORIGINAL_MENU=$(curl -s "$API/admin/daily-menu?date=$NEXT_DATE" -H "Authorization: Bearer $ADMIN_TOKEN")
LOW_MENU_ID=$(echo "$ORIGINAL_MENU" | json ".items[] | select(.dishName == \"$PLAIN_NAME\") | .menuId")

# Restores the day's quantities from the snapshot taken before the race test, never leaving a dish
# with fewer portions than it has already sold.
restore_menu() {
  echo "$ORIGINAL_MENU" | jq -c --argjson keep "$LOW_MENU_ID" \
    '{date: .date, items: [.items[] | {dishId: .dishId,
      totalQuantity: (if .menuId == $keep then ([.totalQuantity, .soldQuantity] | max) else ([.totalQuantity, .soldQuantity] | max) end)}]}' \
    > /tmp/webox-menu.json
  curl -s -o /dev/null -X PUT "$API/admin/daily-menu" -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'Content-Type: application/json' -d @/tmp/webox-menu.json
}
restore_menu

# Exactly one portion left *relative to what has already sold*, so the race is meaningful no matter
# how often this script has been run before.
echo "$ORIGINAL_MENU" | jq -c --argjson keep "$LOW_MENU_ID" \
  '{date: .date, items: [.items[] | {dishId: .dishId,
    totalQuantity: (if .menuId == $keep then (.soldQuantity + 1) else .totalQuantity end)}]}' \
  > /tmp/webox-menu-low.json
curl -s -o /dev/null -X PUT "$API/admin/daily-menu" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d @/tmp/webox-menu-low.json

for i in 2 3 4; do
  T=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
      -d "{\"email\":\"employee$i@webox.com\",\"password\":\"Employee${i}pass1\"}" | json .token)
  echo "$T" > "/tmp/webox-token-$i"
done

for i in 2 3 4; do
  ( T=$(cat "/tmp/webox-token-$i")
    curl -s -o "/tmp/webox-race-$i.json" -w '%{http_code}' -X POST "$API/orders" \
      -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
      -H "Idempotency-Key: smoke-race-$i-$(date +%s)" \
      -d "{\"deliveryDate\":\"$NEXT_DATE\",\"mealPeriod\":\"DINNER\",\"address\":\"HQ Tower\",\"items\":[{\"menuId\":$LOW_MENU_ID,\"quantity\":1,\"optionIds\":[]}]}" \
      > "/tmp/webox-racecode-$i" ) &
done
wait
WINS=0; REJECTS=0; WINNER=""
for i in 2 3 4; do
  code=$(cat "/tmp/webox-racecode-$i")
  if [ "$code" = "201" ]; then WINS=$((WINS + 1)); WINNER=$i; else REJECTS=$((REJECTS + 1)); fi
done
check "only one concurrent order wins the last portion" "$WINS" "1"
check "the other two are rejected" "$REJECTS" "2"
REMAINING=$(curl -s "$API/menu/items/$LOW_MENU_ID" -H "Authorization: Bearer $EMPLOYEE_TOKEN" | json .item.remaining)
check "stock never goes negative" "$REMAINING" "0"

# Release the winning order so the script can be run again without leaving state behind.
if [ -n "$WINNER" ]; then
  WINNER_TOKEN=$(cat "/tmp/webox-token-$WINNER")
  WINNER_ORDER=$(json '.order.id' < "/tmp/webox-race-$WINNER.json")
  curl -s -o /dev/null -X POST "$API/orders/$WINNER_ORDER/cancel" -H "Authorization: Bearer $WINNER_TOKEN"
fi
restore_menu

# ---------------------------------------------------------------- Console: dish lifecycle
# Unique per run so the script is repeatable against a live database.
DISH_NAME="Smoke Test Bowl $RUN_ID"
NEW_DISH=$(printf '{"name":"%s","description":"Created by the smoke test","priceCents":1234,"category":"Light Meal","protein":"Tofu","allergens":["Soy"],"spiceLevel":"Mild","imageUrl":"/assets/images/dish-20.jpg","active":true,"optionGroups":[{"name":"Base","required":true,"multiSelect":false,"options":[{"name":"Quinoa","extraPriceCents":0},{"name":"Rice","extraPriceCents":100}]}]}' "$DISH_NAME")
CODE=$(post "$API/admin/dishes" "$ADMIN_TOKEN" "" "$NEW_DISH")
check "admin can create a dish (201)" "$CODE" "201"
NEW_ID=$(body | json .id)
CODE=$(post "$API/admin/dishes" "$ADMIN_TOKEN" "" "$NEW_DISH")
check "duplicate dish name is refused" "$CODE" "409"

curl -s -o /dev/null -X PATCH "$API/admin/dishes/$NEW_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"active":false}'
check "off-shelf dish disappears from the employee menu" \
  "$(curl -s "$API/menu?q=Smoke%20Test%20Bowl&size=50" -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
     | json "[.items[] | select(.name == \"$DISH_NAME\")] | length")" "0"

# ---------------------------------------------------------------- Console: dashboard & daily menu
get "$API/admin/dashboard" "$ADMIN_TOKEN" > /dev/null
check "dashboard reports orders" "$(body | json '.today.orderCount >= 1')" "true"
check "dashboard trend covers 7 days" "$(body | json '.trend | length')" "7"
check "dashboard ranks dishes" "$(body | json '.topDishes | length > 0')" "true"
check "dashboard lists low stock" "$(body | json '.lowStock | length >= 1')" "true"
check "daily menu can be read" "$(curl -s "$API/admin/daily-menu" -H "Authorization: Bearer $ADMIN_TOKEN" | json '.items | length > 0')" "true"

# ---------------------------------------------------------------- streaming
check "stock stream sends a snapshot" \
  "$(curl -s --max-time 3 -N "$API/stream/stock?token=$EMPLOYEE_TOKEN" | head -3 | grep -c 'event:snapshot')" "1"
AI_OUT=$(curl -s --max-time 20 -N "$API/ai/recommend?prompt=something%20light%20and%20high%20protein&token=$EMPLOYEE_TOKEN")
check "AI stream announces its provider" "$(echo "$AI_OUT" | grep -c 'event:provider')" "1"
check "AI stream returns dish cards" "$(echo "$AI_OUT" | grep -c 'event:dish')" "4"
check "AI stream terminates" "$(echo "$AI_OUT" | grep -c 'event:done')" "1"

# ---------------------------------------------------------------- registration rules
CODE=$(post "$API/auth/register" "" "" '{"email":"bad-email","password":"short","displayName":""}')
check "invalid registration is rejected" "$CODE" "400"
check "  ... with per-field messages" "$(body | json '.fieldErrors | keys | length >= 2')" "true"
NEW_MAIL="new-$(date +%s)@webox.com"
CODE=$(post "$API/auth/register" "" "" "{\"email\":\"$NEW_MAIL\",\"password\":\"Passw0rd123\",\"displayName\":\"New Hire\"}")
check "valid registration succeeds (201)" "$CODE" "201"
CODE=$(post "$API/auth/register" "" "" "{\"email\":\"$NEW_MAIL\",\"password\":\"Passw0rd123\",\"displayName\":\"New Hire\"}")
check "duplicate email is refused" "$CODE" "409"

echo
info "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
