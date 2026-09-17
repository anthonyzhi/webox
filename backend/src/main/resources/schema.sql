-- WeBox schema (MySQL 8+). Applied idempotently on every startup by spring.sql.init.
-- Money is DECIMAL(10,2) end-to-end; the API exchanges integer cents to avoid float drift.

CREATE TABLE IF NOT EXISTS users (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  email           VARCHAR(200) NOT NULL,
  password_hash   VARCHAR(100) NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'EMPLOYEE',
  created_at      DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id             BIGINT       NOT NULL,
  allergens           VARCHAR(255) NOT NULL DEFAULT '',
  cuisine_preferences VARCHAR(255) NOT NULL DEFAULT '',
  spice_level         VARCHAR(20)  NULL,
  taste               VARCHAR(20)  NULL,
  budget_min          DECIMAL(10,2) NULL,
  budget_max          DECIMAL(10,2) NULL,
  recommend_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_addresses (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  user_id      BIGINT       NOT NULL,
  address      VARCHAR(200) NOT NULL,
  last_used_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_addr_user_address (user_id, address),
  CONSTRAINT fk_addr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_sessions (
  token      VARCHAR(64) NOT NULL,
  user_id    BIGINT      NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (token),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dishes (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  price       DECIMAL(10,2) NOT NULL,
  category    VARCHAR(40)  NOT NULL,
  protein     VARCHAR(120) NOT NULL DEFAULT '',
  allergens   VARCHAR(255) NOT NULL DEFAULT '',
  spice_level VARCHAR(20)  NOT NULL DEFAULT 'None',
  image_url   VARCHAR(300) NULL,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_dishes_active_category (active, category),
  KEY idx_dishes_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dish_option_groups (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  dish_id     BIGINT       NOT NULL,
  name        VARCHAR(60)  NOT NULL,
  required    TINYINT(1)   NOT NULL DEFAULT 0,
  multi_select TINYINT(1)  NOT NULL DEFAULT 0,
  sort_order  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_group_dish (dish_id),
  CONSTRAINT fk_group_dish FOREIGN KEY (dish_id) REFERENCES dishes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dish_options (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  group_id     BIGINT        NOT NULL,
  name         VARCHAR(60)   NOT NULL,
  extra_price  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  sort_order   INT           NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_option_group (group_id),
  CONSTRAINT fk_option_group FOREIGN KEY (group_id) REFERENCES dish_option_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-day dish availability and stock. sold_quantity is only ever moved by guarded UPDATEs,
-- which is what makes concurrent ordering oversell-safe (see OrderService.reserveStock).
CREATE TABLE IF NOT EXISTS daily_menu (
  id             BIGINT      NOT NULL AUTO_INCREMENT,
  menu_date      DATE        NOT NULL,
  dish_id        BIGINT      NOT NULL,
  total_quantity INT         NOT NULL,
  sold_quantity  INT         NOT NULL DEFAULT 0,
  updated_at     DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_menu_date_dish (menu_date, dish_id),
  KEY idx_menu_date (menu_date),
  CONSTRAINT fk_menu_dish FOREIGN KEY (dish_id) REFERENCES dishes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  order_no        VARCHAR(32)   NOT NULL,
  user_id         BIGINT        NOT NULL,
  idempotency_key VARCHAR(80)   NOT NULL,
  status          VARCHAR(20)   NOT NULL,
  delivery_date   DATE          NOT NULL,
  meal_period     VARCHAR(10)   NOT NULL,
  address         VARCHAR(200)  NOT NULL,
  total_quantity  INT           NOT NULL,
  total_amount    DECIMAL(10,2) NOT NULL,
  -- Set while the order is Pending/Confirmed, NULL once Cancelled/Completed.
  -- The unique index is the database-level guarantee of "one active order per user per meal slot".
  active_slot     VARCHAR(80)   NULL,
  created_at      DATETIME(3)   NOT NULL,
  updated_at      DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_no (order_no),
  UNIQUE KEY uk_orders_user_idempotency (user_id, idempotency_key),
  UNIQUE KEY uk_orders_active_slot (active_slot),
  KEY idx_orders_user_created (user_id, created_at),
  KEY idx_orders_delivery (delivery_date, meal_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  order_id      BIGINT        NOT NULL,
  dish_id       BIGINT        NOT NULL,
  menu_id       BIGINT        NULL,
  dish_name     VARCHAR(120)  NOT NULL,
  image_url     VARCHAR(300)  NULL,
  quantity      INT           NOT NULL,
  base_price    DECIMAL(10,2) NOT NULL,
  options_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  unit_price    DECIMAL(10,2) NOT NULL,
  subtotal      DECIMAL(10,2) NOT NULL,
  options_json  VARCHAR(1000) NOT NULL DEFAULT '[]',
  PRIMARY KEY (id),
  KEY idx_items_order (order_id),
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
