-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "is_first_login" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "model_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "api_base_url" TEXT NOT NULL,
    "api_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "model_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "model_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "context_window" INTEGER NOT NULL DEFAULT 4096,
    "max_output_tokens" INTEGER,
    "supports_streaming" BOOLEAN NOT NULL DEFAULT true,
    "input_price" REAL,
    "output_price" REAL,
    "local_or_cloud" TEXT NOT NULL DEFAULT 'local',
    "is_default_for" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "model_configs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "async_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input_data" TEXT,
    "result_data" TEXT,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "async_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "token_usage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "model_config_id" TEXT,
    "module" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_estimate" REAL,
    "reference_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "token_usage_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "model_configs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
