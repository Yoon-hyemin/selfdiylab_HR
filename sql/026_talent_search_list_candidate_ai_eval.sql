ALTER TABLE talent_search_list_candidates
  ADD COLUMN ai_verdict text,
  ADD COLUMN ai_reasoning text,
  ADD COLUMN ai_evaluated_at timestamptz;
