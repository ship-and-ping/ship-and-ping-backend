begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(2);
select is((select private.sum_hist(h) from (values (array_fill(1,array[16])), (array_fill(2,array[16]))) hist(h)),
          array_fill(3,array[16]), 'sum all sixteen histogram buckets');
select ok((select p.oid = 'private.add_hist(integer[],integer[])'::regprocedure
                  and 'search_path=""' = any(p.proconfig)
           from pg_aggregate a join pg_proc p on p.oid = a.aggtransfn
           where a.aggfnoid = 'private.sum_hist(integer[])'::regprocedure),
          'histogram transition function has empty search_path');
select * from finish();
rollback;
