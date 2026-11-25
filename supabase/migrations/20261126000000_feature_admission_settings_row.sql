-- PostgREST loads safeupdate. Touch only the quota row when serializing admission.
create or replace function private.feature_admitted(app uuid, feature uuid, cutoff timestamptz)
returns boolean language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.features where id=feature and last_record_at>=cutoff) then
    return true;
  end if;
  if not private.beta_has_room(app,cutoff) then return false; end if;
  update private.settings set active_feature_limit=active_feature_limit where singleton;
  return true;
end $$;
