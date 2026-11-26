-- Historical proposals have been normalized and pruned in the committed backfill.
alter table public.feature_map_suggestions add constraint feature_map_stored_lengths
  check (length(method) between 1 and 32 and length(route) between 1 and 200 and length(name) between 1 and 40);
