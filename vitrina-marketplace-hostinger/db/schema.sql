-- VITRINA / MySQL 8+ / MariaDB 10.6+, compatível com hospedagem Hostinger.
-- Execute com usuário MySQL que possua permissões CREATE/ALTER/INDEX; depois limite privilégios.
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(220) NOT NULL,
  role ENUM('user','seller','admin') NOT NULL DEFAULT 'user',
  account_status ENUM('active','suspended','banned') NOT NULL DEFAULT 'active',
  can_post TINYINT(1) NOT NULL DEFAULT 1,
  age TINYINT UNSIGNED NOT NULL,
  region VARCHAR(25) NOT NULL,
  state CHAR(2) NOT NULL,
  city VARCHAR(90) NOT NULL,
  whatsapp VARCHAR(220) NOT NULL,
  avatar VARCHAR(120) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ix_users_status_role (account_status, role),
  INDEX ix_users_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX ix_sessions_user (user_id),
  INDEX ix_sessions_expiry (expires_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listings (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(110) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  price_cents BIGINT NOT NULL,
  image VARCHAR(120) DEFAULT NULL,
  region VARCHAR(25) NOT NULL,
  state CHAR(2) NOT NULL,
  city VARCHAR(90) NOT NULL,
  status ENUM('draft','active','hidden','removed') NOT NULL DEFAULT 'draft',
  paid_order_id VARCHAR(90) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ix_listing_search (status,region,state,city,category,created_at),
  INDEX ix_listing_user (user_id,created_at),
  CONSTRAINT fk_listing_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_orders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  listing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mp_order_id VARCHAR(90) NOT NULL UNIQUE,
  checkout_url TEXT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'created',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ix_payments_listing (listing_id,created_at),
  CONSTRAINT fk_payment_listing FOREIGN KEY (listing_id) REFERENCES listings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  listing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  buyer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  seller_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_conversation_buyer (listing_id,buyer_id),
  INDEX ix_convo_buyer (buyer_id),
  INDEX ix_convo_seller (seller_id),
  CONSTRAINT fk_convo_listing FOREIGN KEY (listing_id) REFERENCES listings(id),
  CONSTRAINT fk_convo_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT fk_convo_seller FOREIGN KEY (seller_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  text VARCHAR(1000) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ix_messages_conversation (conversation_id,created_at,id),
  CONSTRAINT fk_message_convo FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  CONSTRAINT fk_message_sender FOREIGN KEY (sender_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  listing_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reporter_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(600) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_reporter_listing (listing_id,reporter_id),
  INDEX ix_reports_date (created_at),
  CONSTRAINT fk_report_listing FOREIGN KEY (listing_id) REFERENCES listings(id),
  CONSTRAINT fk_report_user FOREIGN KEY (reporter_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promotions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  body VARCHAR(500) NOT NULL,
  image VARCHAR(120) DEFAULT NULL,
  button_label VARCHAR(35) DEFAULT NULL,
  target_url VARCHAR(700) DEFAULT NULL,
  status ENUM('active','paused') NOT NULL DEFAULT 'active',
  priority TINYINT UNSIGNED NOT NULL DEFAULT 3,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX ix_promo_public (status,priority,created_at),
  CONSTRAINT fk_promo_admin FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action VARCHAR(90) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id VARCHAR(90) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ix_audit_recent (created_at),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
