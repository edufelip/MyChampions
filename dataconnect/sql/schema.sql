-- Firebase Data Connect Schema for MyChampions
-- Defines the database schema for starter templates, plans, and related entities

-- ─── Starter Templates Table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS starter_templates (
  id STRING NOT NULL PRIMARY KEY,
  plan_type STRING NOT NULL, -- 'nutrition' or 'training'
  name STRING NOT NULL,
  description STRING,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  
  -- Constraints
  CONSTRAINT chk_plan_type CHECK (plan_type IN ('nutrition', 'training'))
);

-- Index for efficient filtering by plan_type
CREATE INDEX idx_starter_templates_plan_type ON starter_templates(plan_type);

-- ─── Nutrition Plans Table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nutrition_plans (
  id STRING NOT NULL PRIMARY KEY,
  professional_id STRING NOT NULL,
  student_id STRING, -- NULL if not assigned
  source_template_id STRING, -- References starter_templates.id if cloned from starter
  name STRING NOT NULL,
  is_draft BOOLEAN NOT NULL DEFAULT TRUE,
  calories_target INT,
  carbs_target INT,
  proteins_target INT,
  fats_target INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  
  -- Foreign Key
  CONSTRAINT fk_source_template FOREIGN KEY (source_template_id) REFERENCES starter_templates(id) ON DELETE SET NULL
);

-- Indexes for efficient querying
CREATE INDEX idx_nutrition_plans_professional_id ON nutrition_plans(professional_id);
CREATE INDEX idx_nutrition_plans_student_id ON nutrition_plans(student_id);
CREATE INDEX idx_nutrition_plans_source_template_id ON nutrition_plans(source_template_id);

-- ─── Training Plans Table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS training_plans (
  id STRING NOT NULL PRIMARY KEY,
  professional_id STRING NOT NULL,
  student_id STRING, -- NULL if not assigned
  source_template_id STRING, -- References starter_templates.id if cloned from starter
  name STRING NOT NULL,
  is_draft BOOLEAN NOT NULL DEFAULT TRUE,
  focus_area STRING, -- e.g., 'full_body', 'upper', 'lower', 'hiit'
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  
  -- Foreign Key
  CONSTRAINT fk_source_template FOREIGN KEY (source_template_id) REFERENCES starter_templates(id) ON DELETE SET NULL
);

-- Indexes for efficient querying
CREATE INDEX idx_training_plans_professional_id ON training_plans(professional_id);
CREATE INDEX idx_training_plans_student_id ON training_plans(student_id);
CREATE INDEX idx_training_plans_source_template_id ON training_plans(source_template_id);

-- ─── Template Usage Statistics Table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS template_usage_stats (
  template_id STRING NOT NULL PRIMARY KEY,
  clone_count INT NOT NULL DEFAULT 0,
  assignment_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  
  -- Foreign Key
  CONSTRAINT fk_template_id FOREIGN KEY (template_id) REFERENCES starter_templates(id) ON DELETE CASCADE
);

-- ─── Nutrition Plan Meal Items Table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nutrition_plan_meals (
  id STRING NOT NULL PRIMARY KEY,
  nutrition_plan_id STRING NOT NULL,
  food_name STRING NOT NULL,
  calories INT,
  carbs INT,
  proteins INT,
  fats INT,
  portions FLOAT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  
  -- Foreign Key
  CONSTRAINT fk_nutrition_plan_id FOREIGN KEY (nutrition_plan_id) REFERENCES nutrition_plans(id) ON DELETE CASCADE
);

-- Index for efficient queries
CREATE INDEX idx_nutrition_plan_meals_plan_id ON nutrition_plan_meals(nutrition_plan_id);

-- ─── Training Plan Sessions Table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS training_plan_sessions (
  id STRING NOT NULL PRIMARY KEY,
  training_plan_id STRING NOT NULL,
  session_name STRING NOT NULL,
  day_of_week INT, -- 0-6 (Sunday-Saturday)
  duration_minutes INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  
  -- Foreign Key
  CONSTRAINT fk_training_plan_id FOREIGN KEY (training_plan_id) REFERENCES training_plans(id) ON DELETE CASCADE
);

-- Index for efficient queries
CREATE INDEX idx_training_plan_sessions_plan_id ON training_plan_sessions(training_plan_id);

-- ─── Training Session Items Table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS training_session_items (
  id STRING NOT NULL PRIMARY KEY,
  session_id STRING NOT NULL,
  exercise_name STRING NOT NULL,
  sets INT,
  reps INT,
  weight FLOAT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  
  -- Foreign Key
  CONSTRAINT fk_session_id FOREIGN KEY (session_id) REFERENCES training_plan_sessions(id) ON DELETE CASCADE
);

-- Index for efficient queries
CREATE INDEX idx_training_session_items_session_id ON training_session_items(session_id);
