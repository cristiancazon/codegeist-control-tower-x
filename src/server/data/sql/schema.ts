export type SqlMigration = readonly [name: string, statement: string];

// A migration name and its DDL are immutable after deployment. Append changes.
export const modelMigrations: readonly SqlMigration[] = [
  ['v001_01_create_ctx_project', `
    CREATE TABLE IF NOT EXISTS ctx_project (
      id CHAR(36) PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL, jira_project_id VARCHAR(80) NOT NULL UNIQUE,
      jira_project_key VARCHAR(40) NOT NULL, jsm_service_desk_id VARCHAR(80),
      confluence_space_id VARCHAR(80), assets_workspace_id VARCHAR(80),
      time_zone VARCHAR(80) NOT NULL, currency CHAR(3) NOT NULL,
      target_date DATE, budget_cents BIGINT, data_mode VARCHAR(16) NOT NULL,
      status VARCHAR(20) NOT NULL, version INT NOT NULL,
      updated_at DATETIME(3) NOT NULL
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_02_create_ctx_project_role', `
    CREATE TABLE IF NOT EXISTS ctx_project_role (
      project_id CHAR(36) NOT NULL, account_id VARCHAR(128) NOT NULL,
      role_code VARCHAR(24) NOT NULL, granted_by VARCHAR(128) NOT NULL,
      granted_at DATETIME(3) NOT NULL, revoked_at DATETIME(3),
      PRIMARY KEY (project_id, account_id, role_code),
      KEY idx_role_actor (account_id, project_id, revoked_at)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_03_create_ctx_phase', `
    CREATE TABLE IF NOT EXISTS ctx_phase (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      code VARCHAR(24) NOT NULL, name VARCHAR(160) NOT NULL,
      ordinal INT NOT NULL, planned_start DATE, planned_end DATE,
      UNIQUE KEY uq_phase_code (project_id, code),
      UNIQUE KEY uq_phase_order (project_id, ordinal)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_04_create_ctx_facility', `
    CREATE TABLE IF NOT EXISTS ctx_facility (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      code VARCHAR(32) NOT NULL, facility_type VARCHAR(32) NOT NULL,
      name VARCHAR(160) NOT NULL, status VARCHAR(24) NOT NULL,
      map_x DECIMAL(8,4), map_y DECIMAL(8,4), version INT NOT NULL,
      UNIQUE KEY uq_facility_code (project_id, code),
      KEY idx_facility_status (project_id, status, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_05_create_ctx_contractor', `
    CREATE TABLE IF NOT EXISTS ctx_contractor (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      code VARCHAR(32) NOT NULL, name VARCHAR(160) NOT NULL,
      trade VARCHAR(80) NOT NULL, status VARCHAR(24) NOT NULL,
      workspace_id VARCHAR(80), assets_object_id VARCHAR(80),
      source_updated_at DATETIME(3), version INT NOT NULL,
      UNIQUE KEY uq_contractor_code (project_id, code),
      UNIQUE KEY uq_contractor_source (project_id, workspace_id, assets_object_id),
      KEY idx_contractor_status (project_id, status, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_06_create_ctx_work_package', `
    CREATE TABLE IF NOT EXISTS ctx_work_package (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      phase_id CHAR(36) NOT NULL, facility_id CHAR(36), contractor_id CHAR(36),
      code VARCHAR(32) NOT NULL, jira_issue_id VARCHAR(80), jira_issue_key VARCHAR(40),
      title VARCHAR(240) NOT NULL, status VARCHAR(32) NOT NULL,
      planned_start DATE, planned_finish DATE, actual_start DATE, actual_finish DATE,
      duration_a DECIMAL(9,3), duration_m DECIMAL(9,3), duration_b DECIMAL(9,3),
      earliest_start DATE, remaining_days DECIMAL(9,3),
      milestone TINYINT NOT NULL, priority_rank INT NOT NULL,
      source_updated_at DATETIME(3), tombstoned_at DATETIME(3), version INT NOT NULL,
      UNIQUE KEY uq_work_code (project_id, code),
      UNIQUE KEY uq_work_jira_id (jira_issue_id),
      KEY idx_work_phase (project_id, phase_id, status, id),
      KEY idx_work_finish (project_id, planned_finish, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_07_create_ctx_dependency', `
    CREATE TABLE IF NOT EXISTS ctx_dependency (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      predecessor_id CHAR(36) NOT NULL, successor_id CHAR(36) NOT NULL,
      relation_type VARCHAR(8) NOT NULL, lag_days INT NOT NULL,
      source_link_id VARCHAR(80), tombstoned_at DATETIME(3), version INT NOT NULL,
      UNIQUE KEY uq_dep_edge (project_id, predecessor_id, successor_id, relation_type),
      KEY idx_dep_successor (project_id, successor_id, predecessor_id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_08_create_ctx_asset', `
    CREATE TABLE IF NOT EXISTS ctx_asset (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      code VARCHAR(32) NOT NULL, name VARCHAR(160) NOT NULL,
      asset_type VARCHAR(40) NOT NULL, status VARCHAR(24) NOT NULL,
      facility_id CHAR(36), contractor_id CHAR(36), workspace_id VARCHAR(80),
      assets_object_id VARCHAR(80), next_available_date DATE,
      source_updated_at DATETIME(3), tombstoned_at DATETIME(3), version INT NOT NULL,
      UNIQUE KEY uq_asset_code (project_id, code),
      UNIQUE KEY uq_asset_source (project_id, workspace_id, assets_object_id),
      KEY idx_asset_available (project_id, status, next_available_date, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_09_create_ctx_shipment', `
    CREATE TABLE IF NOT EXISTS ctx_shipment (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      gate_work_package_id CHAR(36) NOT NULL, contractor_id CHAR(36) NOT NULL,
      asset_id CHAR(36), code VARCHAR(32) NOT NULL, status VARCHAR(24) NOT NULL,
      baseline_eta DATE NOT NULL, latest_eta DATE, arrived_date DATE,
      shipment_qty DECIMAL(15,3) NOT NULL, shipment_unit VARCHAR(16) NOT NULL,
      updated_at DATETIME(3) NOT NULL, version INT NOT NULL,
      UNIQUE KEY uq_shipment_code (project_id, code),
      KEY idx_shipment_eta (project_id, status, latest_eta, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_10_create_ctx_crew_pool', `
    CREATE TABLE IF NOT EXISTS ctx_crew_pool (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      contractor_id CHAR(36), code VARCHAR(32) NOT NULL,
      skill VARCHAR(60) NOT NULL, default_capacity SMALLINT NOT NULL,
      version INT NOT NULL,
      UNIQUE KEY uq_crew_code (project_id, code)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_11_create_ctx_work_resource', `
    CREATE TABLE IF NOT EXISTS ctx_work_resource (
      project_id CHAR(36) NOT NULL, work_package_id CHAR(36) NOT NULL,
      resource_kind VARCHAR(16) NOT NULL, resource_id CHAR(36) NOT NULL,
      quantity SMALLINT NOT NULL,
      PRIMARY KEY (project_id, work_package_id, resource_kind, resource_id),
      KEY idx_work_resource (project_id, resource_kind, resource_id, work_package_id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_12_create_ctx_resource_window', `
    CREATE TABLE IF NOT EXISTS ctx_resource_window (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      resource_kind VARCHAR(16) NOT NULL, resource_id CHAR(36) NOT NULL,
      window_start DATE NOT NULL, window_end DATE NOT NULL,
      capacity SMALLINT NOT NULL, reason_code VARCHAR(40) NOT NULL,
      source_ref_jcs TEXT NOT NULL,
      UNIQUE KEY uq_resource_from (project_id, resource_kind, resource_id, window_start),
      KEY idx_resource_window (project_id, resource_kind, resource_id, window_end)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_13_create_ctx_incident', `
    CREATE TABLE IF NOT EXISTS ctx_incident (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      facility_id CHAR(36), work_package_id CHAR(36), jira_issue_id VARCHAR(80),
      jira_issue_key VARCHAR(40), jsm_request_type_id VARCHAR(80),
      category VARCHAR(40) NOT NULL, severity VARCHAR(16) NOT NULL,
      status VARCHAR(24) NOT NULL, access_class VARCHAR(24) NOT NULL,
      occurred_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_incident_issue (jira_issue_id),
      KEY idx_incident_severity (project_id, severity, status, occurred_at, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_14_create_ctx_cost_record', `
    CREATE TABLE IF NOT EXISTS ctx_cost_record (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      work_package_id CHAR(36), contractor_id CHAR(36), asset_id CHAR(36),
      record_code VARCHAR(48) NOT NULL, kind VARCHAR(24) NOT NULL,
      cost_bucket VARCHAR(32) NOT NULL, amount_cents BIGINT NOT NULL,
      currency CHAR(3) NOT NULL, unit_code VARCHAR(24) NOT NULL,
      effective_date DATE NOT NULL, valid_until DATE,
      actuality VARCHAR(16) NOT NULL, source_ref_jcs TEXT NOT NULL,
      UNIQUE KEY uq_cost_code (project_id, record_code),
      KEY idx_cost_series (project_id, kind, effective_date, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_15_create_ctx_historical_metric', `
    CREATE TABLE IF NOT EXISTS ctx_historical_metric (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      metric_code VARCHAR(40) NOT NULL, dimension_kind VARCHAR(20) NOT NULL,
      dimension_id CHAR(36) NOT NULL, unit_code VARCHAR(16) NOT NULL,
      period_start DATE NOT NULL, period_end DATE NOT NULL,
      metric_value DECIMAL(20,6) NOT NULL,
      quality_code VARCHAR(24) NOT NULL, source_ref_jcs TEXT NOT NULL,
      UNIQUE KEY uq_history_period (project_id, metric_code, dimension_kind, dimension_id, period_start),
      KEY idx_history_recent (project_id, metric_code, period_start, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_16_create_ctx_knowledge_ref', `
    CREATE TABLE IF NOT EXISTS ctx_knowledge_ref (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      confluence_space_id VARCHAR(80) NOT NULL, page_id VARCHAR(80) NOT NULL,
      source_version VARCHAR(64) NOT NULL, subject_code VARCHAR(40) NOT NULL,
      checked_at DATETIME(3) NOT NULL, tombstoned_at DATETIME(3),
      UNIQUE KEY uq_knowledge_page (project_id, page_id),
      KEY idx_knowledge_subject (project_id, subject_code, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_17_create_ctx_sync_state', `
    CREATE TABLE IF NOT EXISTS ctx_sync_state (
      project_id CHAR(36) NOT NULL, source_system VARCHAR(24) NOT NULL,
      scope_id VARCHAR(100) NOT NULL, watermark_at DATETIME(3),
      cursor_value TEXT, last_success_at DATETIME(3), state VARCHAR(24) NOT NULL,
      source_schema_version INT NOT NULL, last_error_code VARCHAR(48),
      lease_until DATETIME(3), fence BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, source_system, scope_id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_18_create_ctx_source_mapping', `
    CREATE TABLE IF NOT EXISTS ctx_source_mapping (
      project_id CHAR(36) NOT NULL, source_system VARCHAR(24) NOT NULL,
      source_scope VARCHAR(100) NOT NULL, source_id VARCHAR(128) NOT NULL,
      entity_kind VARCHAR(32) NOT NULL, entity_id CHAR(36) NOT NULL,
      fixture_key VARCHAR(64), version VARCHAR(80),
      last_seen_at DATETIME(3) NOT NULL, tombstoned_at DATETIME(3),
      PRIMARY KEY (project_id, source_system, source_scope, source_id),
      UNIQUE KEY uq_source_fixture (project_id, source_system, fixture_key),
      KEY idx_source_local (project_id, entity_kind, entity_id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_19_create_ctx_data_snapshot', `
    CREATE TABLE IF NOT EXISTS ctx_data_snapshot (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      state VARCHAR(16) NOT NULL, schema_version INT NOT NULL,
      as_of_date DATE NOT NULL, collected_at DATETIME(3) NOT NULL,
      sealed_at DATETIME(3), expires_at DATETIME(3) NOT NULL,
      created_by VARCHAR(128) NOT NULL, access_class VARCHAR(24) NOT NULL,
      chunk_count INT NOT NULL, content_hash CHAR(64) NOT NULL,
      source_manifest_jcs MEDIUMTEXT NOT NULL, quality_jcs TEXT NOT NULL,
      UNIQUE KEY uq_snapshot_hash (project_id, content_hash),
      KEY idx_snapshot_recent (project_id, state, collected_at, id),
      KEY idx_snapshot_expiry (expires_at, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_20_create_ctx_snapshot_chunk', `
    CREATE TABLE IF NOT EXISTS ctx_snapshot_chunk (
      snapshot_id CHAR(36) NOT NULL, chunk_index INT NOT NULL,
      chunk_hash CHAR(64) NOT NULL, payload_jcs MEDIUMTEXT NOT NULL,
      PRIMARY KEY (snapshot_id, chunk_index)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_21_create_ctx_scenario', `
    CREATE TABLE IF NOT EXISTS ctx_scenario (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      snapshot_id CHAR(36) NOT NULL, root_id CHAR(36) NOT NULL,
      baseline_id CHAR(36), previous_id CHAR(36), revision INT NOT NULL,
      name VARCHAR(120) NOT NULL, schema_version INT NOT NULL,
      state VARCHAR(16) NOT NULL, content_hash CHAR(64) NOT NULL,
      request_hash CHAR(64) NOT NULL, idempotency_key VARCHAR(80) NOT NULL,
      created_by VARCHAR(128) NOT NULL, created_at DATETIME(3) NOT NULL,
      published_at DATETIME(3),
      UNIQUE KEY uq_scenario_revision (project_id, root_id, revision),
      UNIQUE KEY uq_scenario_request (project_id, created_by, idempotency_key),
      KEY idx_scenario_snapshot (project_id, snapshot_id, state, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_22_create_ctx_scenario_variable', `
    CREATE TABLE IF NOT EXISTS ctx_scenario_variable (
      scenario_id CHAR(36) NOT NULL, ordinal SMALLINT NOT NULL,
      variable_code VARCHAR(32) NOT NULL, target_kind VARCHAR(24) NOT NULL,
      target_id CHAR(36) NOT NULL, unit_code VARCHAR(24) NOT NULL,
      value_jcs TEXT NOT NULL, evidence_jcs TEXT NOT NULL, reason VARCHAR(500) NOT NULL,
      PRIMARY KEY (scenario_id, ordinal),
      UNIQUE KEY uq_variable_target (scenario_id, variable_code, target_kind, target_id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_23_create_ctx_simulation_run', `
    CREATE TABLE IF NOT EXISTS ctx_simulation_run (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      scenario_id CHAR(36) NOT NULL, snapshot_id CHAR(36) NOT NULL,
      retry_of_id CHAR(36), requested_by VARCHAR(128) NOT NULL,
      idempotency_key VARCHAR(80) NOT NULL, request_hash CHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL, seed_hex CHAR(32) NOT NULL,
      sample_count INT NOT NULL, materialized_count INT NOT NULL DEFAULT 0,
      model_version VARCHAR(32) NOT NULL, engine_build VARCHAR(80) NOT NULL,
      rng_version VARCHAR(32) NOT NULL, input_hash CHAR(64) NOT NULL,
      fence BIGINT NOT NULL DEFAULT 0, lease_owner CHAR(36), lease_until DATETIME(3),
      dispatch_count INT NOT NULL DEFAULT 0, next_dispatch_at DATETIME(3),
      created_at DATETIME(3) NOT NULL, started_at DATETIME(3), deadline_at DATETIME(3) NOT NULL,
      finished_at DATETIME(3), result_generation BIGINT, result_hash CHAR(64),
      result_manifest_jcs MEDIUMTEXT, error_code VARCHAR(48),
      UNIQUE KEY uq_run_request (project_id, requested_by, idempotency_key),
      KEY idx_run_recovery (status, next_dispatch_at, lease_until, id),
      KEY idx_run_project (project_id, scenario_id, created_at, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_24_create_ctx_run_batch', `
    CREATE TABLE IF NOT EXISTS ctx_run_batch (
      run_id CHAR(36) NOT NULL, batch_index INT NOT NULL,
      first_sample INT NOT NULL, sample_count INT NOT NULL,
      batch_hash CHAR(64) NOT NULL, samples_jcs MEDIUMTEXT NOT NULL,
      created_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL,
      PRIMARY KEY (run_id, batch_index),
      KEY idx_batch_expiry (expires_at, run_id, batch_index)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_25_create_ctx_prediction', `
    CREATE TABLE IF NOT EXISTS ctx_prediction (
      run_id CHAR(36) NOT NULL, result_generation BIGINT NOT NULL,
      metric_code VARCHAR(40) NOT NULL, subject_id CHAR(36) NOT NULL,
      project_id CHAR(36) NOT NULL, unit_code VARCHAR(20) NOT NULL,
      sample_count INT NOT NULL, horizon_days INT,
      summary_jcs MEDIUMTEXT NOT NULL, evidence_jcs TEXT NOT NULL,
      PRIMARY KEY (run_id, result_generation, metric_code, subject_id),
      KEY idx_prediction_lookup (project_id, run_id, result_generation)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_26_create_ctx_recommendation', `
    CREATE TABLE IF NOT EXISTS ctx_recommendation (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      run_id CHAR(36) NOT NULL, result_generation BIGINT NOT NULL,
      rule_code VARCHAR(40) NOT NULL, recommendation_hash CHAR(64) NOT NULL,
      origin VARCHAR(24) NOT NULL, status VARCHAR(24) NOT NULL,
      comparison_jcs TEXT NOT NULL, evidence_jcs TEXT NOT NULL,
      proposed_action_jcs TEXT, created_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_recommendation (run_id, result_generation, recommendation_hash),
      KEY idx_recommendation_project (project_id, status, created_at, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_27_create_ctx_decision', `
    CREATE TABLE IF NOT EXISTS ctx_decision (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL,
      recommendation_id CHAR(36), supersedes_id CHAR(36), revision INT NOT NULL,
      status VARCHAR(32) NOT NULL, proposed_by VARCHAR(128) NOT NULL,
      approved_by VARCHAR(128), executor_id VARCHAR(128),
      reviewed_by VARCHAR(128), proposed_at DATETIME(3) NOT NULL,
      reviewed_at DATETIME(3), approved_at DATETIME(3), expires_at DATETIME(3),
      action_code VARCHAR(48) NOT NULL, payload_jcs MEDIUMTEXT NOT NULL,
      payload_hash CHAR(64) NOT NULL, approved_revision INT, approved_payload_hash CHAR(64),
      correlation_key VARCHAR(64) NOT NULL UNIQUE, execution_token CHAR(36),
      attempt_count INT NOT NULL DEFAULT 0, execution_started_at DATETIME(3),
      applied_at DATETIME(3), external_issue_id VARCHAR(80), external_issue_key VARCHAR(40),
      last_error_code VARCHAR(48), failure_class VARCHAR(32),
      idempotency_key VARCHAR(80) NOT NULL, request_hash CHAR(64) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_decision_request (project_id, proposed_by, idempotency_key),
      UNIQUE KEY uq_decision_issue (external_issue_id),
      KEY idx_decision_state (project_id, status, updated_at, id),
      KEY idx_decision_recovery (status, execution_started_at, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
  ['v001_28_create_ctx_audit_log', `
    CREATE TABLE IF NOT EXISTS ctx_audit_log (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36),
      actor_kind VARCHAR(16) NOT NULL, actor_account_id VARCHAR(128),
      origin VARCHAR(24) NOT NULL, access_class VARCHAR(24) NOT NULL,
      event_type VARCHAR(60) NOT NULL, entity_kind VARCHAR(40) NOT NULL,
      entity_id CHAR(36), entity_version VARCHAR(40),
      occurred_at DATETIME(3) NOT NULL, correlation_id VARCHAR(80) NOT NULL,
      outcome VARCHAR(24) NOT NULL, error_code VARCHAR(48),
      before_hash CHAR(64), after_hash CHAR(64), metadata_jcs TEXT NOT NULL,
      KEY idx_audit_project (project_id, occurred_at, id),
      KEY idx_audit_subject (project_id, entity_kind, entity_id, occurred_at, id),
      KEY idx_audit_correlation (correlation_id, occurred_at, id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
  `],
];
