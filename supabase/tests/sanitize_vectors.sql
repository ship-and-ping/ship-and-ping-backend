begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(39);

select is(private.mask(input), expected, 'mask ' || id)
from (values
  (1, E'v1sp' || E'_srv_demo', E'v1[가림]'),
  (2, E'xSP' || E'_PUB_demo', E'x[가림]'),
  (3, E'x_sb' || E'_secret_sample', E'x_[가림]'),
  (4, E'aSb' || E'_PuBlIsHaBlE_demo', E'a[가림]'),
  (5, E'(sk' || E'_abcdefghijklmnop)', E'([가림])'),
  (6, E'_PK' || E'_0123456789abcdef', E'_[가림]'),
  (7, E'rk' || E'_ABCDEFGHIJKLMNOP', E'[가림]'),
  (8, E'sk' || E'_abcdefghijklmno', E'sk' || E'_abcdefghijklmno'),
  (9, E'xsk' || E'_abcdefghijklmnop', E'xsk' || E'_abcdefghijklmnop'),
  (10, E'9pk' || E'_abcdefghijklmnop', E'9pk' || E'_abcdefghijklmnop'),
  (11, E'task' || E'_queue', E'task' || E'_queue'),
  (12, E'basic auth failed', E'basic auth failed'),
  (13, E'Basic abcdefghijklmno', E'Basic abcdefghijklmno'),
  (14, E'Basic YWJjZGVmZ2hpamts', E'[가림]'),
  (15, E'Basic YWJjZGVmZ2hpaw==', E'[가림]'),
  (16, E'ＳＰ＿ＳＲＶ＿demo', E'[가림]'),
  (17, E's\u200bp\u200c_\u200ds\u2060r\ufeffv_demo', E'[가림]'),
  (18, E'sp' || E'_\u202esrv_\u2066demo\u2069', E'[가림]'),
  (19, E'Cookie: sid=one\u2028safe\u2029next\u0085end', E'[가림]\nsafe\nnext\nend'),
  (20, E'a%40example.test 010-1234-5678', E'[가림] [가림]'),
  (21, E'Bearer: demo; token=test', E'[가림]; [가림]'),
  (22, E'한글sk' || E'_live___fixture__', E'한글[가림]'),
  (23, E'sk' || E'_test___fixture__', E'[가림]'),
  (24, E'(pk' || E'_live___fixture__)', E'([가림])'),
  (25, E'rk' || E'_live___fixture__', E'[가림]'),
  (26, E'sk' || E'_test___short___', E'sk' || E'_test___short___'),
  (27, E'desk' || E'_live___fixture__', E'desk' || E'_live___fixture__'),
  (28, E'/task' || E'_list', E'/task' || E'_list'),
  (29, E'/task' || E'_list_abcdefghijk', E'/task' || E'_list_abcdefghijk'),
  (30, E'épk' || E'_abcdefghijklmnop', E'é[가림]')
) as cases(id, input, expected);

select is(private.route(input), expected, 'route ' || id)
from (values
  (1, E'/notification-preferences/account_settings_panel', E'/notification-preferences/account_settings_panel'),
  (2, E'/notificationpreferences', E'/notificationpreferences'),
  (3, E'/a/abc123-def456_789', E'/a/:id'),
  (4, E'/a/deadbeefcafebabe', E'/a/:id'),
  (5, E'/a/QUJDREVGR0hJSktMTU4=', E'/a/:id'),
  (6, E'/a/aBcDeFGhiJKlm_NOP', E'/a/:id'),
  (7, E'/a/42;jsessionid=secret?q=x#frag', E'/a/:id'),
  (8, E'/a/v1sp' || E'_srv_demo', E'/a/:id'),
  (9, E'/a/１２３', E'/a/:id')
) as cases(id, input, expected);

select * from finish();
rollback;
