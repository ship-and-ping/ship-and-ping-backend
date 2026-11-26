begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(1313);

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
  (21, E'Bearer: demo; token=test', E'[가림]; token=[가림]'),
  (22, E'한글sk' || E'_live___fixture__', E'한글[가림]'),
  (23, E'sk' || E'_test___fixture__', E'[가림]'),
  (24, E'(pk' || E'_live___fixture__)', E'([가림])'),
  (25, E'rk' || E'_live___fixture__', E'[가림]'),
  (26, E'sk' || E'_test___short___', E'sk' || E'_test___short___'),
  (27, E'desk' || E'_live___fixture__', E'desk' || E'_live___fixture__'),
  (28, E'/task' || E'_list', E'/task' || E'_list'),
  (29, E'/task' || E'_list_abcdefghijk', E'/task' || E'_list_abcdefghijk'),
  (30, E'épk' || E'_abcdefghijklmnop', E'é[가림]'),
  (31, E'010-1234-5678로 전송 실패', E'[가림]로 전송 실패'),
  (32, E'번호01012345678', E'번호[가림]'),
  (33, E'0101234567890123', E'[가림]'),
  (34, E'메일a@example.test로 전송', E'메일[가림]로 전송'),
  (35, E'오류Bearer: demo; 값token=demo', E'오류[가림]; 값token=[가림]'),
  (36, E'헤더Cookie: sid=one', E'헤더[가림]'),
  (37, E'인증Basic YWJjZGVmZ2hpamts', E'인증[가림]'),
  (38, E'인증eyJdemo', E'인증[가림]'),
  (39, E'refresh_token=abc', E'refresh_token=[가림]'),
  (40, E'id_token=one&api_key=two', E'id_token=[가림]&api_key=[가림]'),
  (41, E'my_api_key=one; apikey=two', E'my_api_key=[가림]; apikey=[가림]'),
  (42, E'client_secret=one', E'client_secret=[가림]'),
  (43, E'X-Api-Key: two', E'[가림]'),
  (44, E'db-PASSWD : one Pwd=two password=three', E'[가림]'),
  (45, E'monkey=banana', E'monkey=banana'),
  (46, E'tokenizer=one secret_hint: two', E'tokenizer=[가림] [가림]'),
  (47, E'token: Bearer abc; next', E'[가림]'),
  (48, E'{\"api_key\":\"abc\",\"id\":1}', E'{\"api_key\":\"[가림]\",\"id\":1}'),
  (49, E'\"password\": \"x\"', E'\"password\": \"[가림]\"'),
  (50, E'\u0027secret\u0027:\u0027y\u0027', E'\u0027secret\u0027:\u0027[가림]\u0027'),
  (51, E'{\"MY-ACCESS_TOKEN\":\"Bearer abc def\",\"db_passwd\":\"a\\\"b\",\"pwd\":\"x,y\"}', E'{\"MY-ACCESS_TOKEN\":\"[가림]\",\"db_passwd\":\"[가림]\",\"pwd\":\"[가림]\"}'),
  (52, E'\"secret_hint\":\"ok\"', E'\"secret_hint\":\"[가림]\"'),
  (53, E'1764120000 1764120000123', E'[가림]'),
  (54, E'0111234567 010-123-4567', E'[가림]'),
  (55, E'02-1234-5678 0311234567', E'[가림]'),
  (56, E'+82 10 1234 5678', E'[가림]'),
  (57, E'(02) 123-4567,\u0020070.1234.5678', E'[가림],\u0020[가림]'),
  (58, E'1764120000123 01012345678', E'[가림]'),
  (59, E'+1 415 555 0100', E'[가림]'),
  (60, E'+44 20 7946 0958', E'[가림]'),
  (61, E'82-10-1234-5678', E'[가림]'),
  (62, E'010 - 1234 - 5678', E'[가림]'),
  (63, E'900101-1234567', E'[가림]'),
  (64, E'110-123-456789', E'[가림]'),
  (65, E'4111 1111 1111 1111', E'[가림]'),
  (66, E'4111111111111111', E'[가림]'),
  (67, E'123456789', E'[가림]'),
  (68, E'123456789012345', E'[가림]'),
  (69, E'0999999999', E'[가림]'),
  (70, E'2147483648', E'[가림]'),
  (71, E'2147483648000', E'[가림]'),
  (72, E'12345678', E'12345678'),
  (73, E'1764120000', E'[가림]'),
  (74, E'1764120000123', E'1764120000123'),
  (75, E'1000000000', E'[가림]'),
  (76, E'2147483647', E'[가림]'),
  (77, E'1000000000000', E'[가림]'),
  (78, E'2147483647999', E'[가림]'),
  (79, E'{\\\"api_key\\\":\\\"abc\\\"}', E'{\\\"api_key\\\":\\\"[가림]\\\"}'),
  (80, E'\"pin_password\": 1234', E'\"pin_password\": [가림]'),
  (81, E'\u0027secret\u0027 => \u0027x\u0027', E'\u0027secret\u0027 => \u0027[가림]\u0027'),
  (82, E'\"token\":\"abc', E'\"token\":\"[가림]'),
  (83, E'\"Bearer test\"&next#end', E'\"[가림]\"&next#end'),
  (84, E'\u0027Basic YWJjZGVmZ2hpamts\u0027#next', E'\u0027[가림]\u0027#next'),
  (85, E'token: Bearer demo&next#end', E'[가림]'),
  (86, E'{\"sp' || E'_srv_demo_token\":\"Basic YWJjZGVmZ2hpamts\"}', E'{\"[가림]\":\"[가림]\"}'),
  (87, E'token=\"Bearer abc\"', E'token=\"[가림]\"'),
  (88, E'password=\u0027Basic YWJjZGVmZ2hpamts\u0027', E'password=\u0027[가림]\u0027'),
  (89, E'sp' || E'_srv_demo_token=value', E'[가림]'),
  (90, E'token=abc}def', E'token=[가림]'),
  (91, E'\"token\": [가림]', E'\"token\": [가림]'),
  (92, E'token=\\opaque', E'token=[가림]'),
  (93, E'010/1234/5678', E'[가림]'),
  (94, E'010_1234_5678', E'[가림]'),
  (95, E'010\t1234\t5678', E'[가림]'),
  (96, E'010–1234–5678', E'[가림]'),
  (97, E'010‐1234‐5678', E'[가림]'),
  (98, E'010‒1234‒5678', E'[가림]'),
  (99, E'010—1234—5678', E'[가림]'),
  (100, E'010‑1234‑5678', E'[가림]'),
  (101, E'010―1234―5678', E'[가림]'),
  (102, E'010−1234−5678', E'[가림]'),
  (103, E'1501013234567', E'[가림]'),
  (104, E'1801013234567', E'[가림]'),
  (105, E'2002294234567', E'[가림]'),
  (106, E'2125550100', E'[가림]'),
  (107, E'1234567890', E'[가림]'),
  (108, E'1002123456789', E'[가림]'),
  (109, E'1577836799', E'[가림]'),
  (110, E'2082758400', E'[가림]'),
  (111, E'1577836799999', E'[가림]'),
  (112, E'2082758400000', E'[가림]'),
  (113, E'0101234 5678@x.co', E'[가림]'),
  (114, E'Authorization: Token abc', E'[가림]'),
  (115, E'1902293234567', E'1902293234567'),
  (116, E'1801015234567', E'[가림]'),
  (117, E'1577836800', E'[가림]'),
  (118, E'2082758399', E'[가림]'),
  (119, E'1577836800000', E'1577836800000'),
  (120, E'2082758399999', E'2082758399999'),
  (121, E'keyboard=abc', E'keyboard=abc'),
  (122, E'tokens=abc', E'tokens=[가림]'),
  (123, E'api_keys=abc', E'api_keys=[가림]'),
  (124, E'secrets=abc', E'secrets=[가림]'),
  (125, E'password_confirmation=abc', E'password_confirmation=[가림]'),
  (126, E'token_value=abc', E'token_value=[가림]'),
  (127, E'token%3Dabc', E'token%3D[가림]'),
  (128, E'api_key%3Dabc', E'api_key%3D[가림]'),
  (129, E'{\\\\\\\"token\\\\\\\":\\\\\\\"abc\\\\\\\"}', E'{\\\\\\\"token\\\\\\\":\\\\\\\"[가림]\\\\\\\"}'),
  (130, E'\"token\": [\"abc\",\"def\"],\u0020ok', E'\"token\": [가림],\u0020ok'),
  (131, E'\"token\": [[\"a]\"],\u0020\"b\"]', E'\"token\": [가림]'),
  (132, E'5555 5555 5555 4444', E'[가림]'),
  (133, E'378282246310005', E'[가림]'),
  (134, E'1764120000120', E'[가림]'),
  (135, E'accessTokenValue=example', E'accessTokenValue=[가림]'),
  (136, E'010֊1234֊5678', E'[가림]'),
  (137, E'sp' || E'_srv_demo@example.test', E'[가림]'),
  (138, E'token=\"\"', E'token=\"\"'),
  (139, E'\"tokens\": [\"a\",\n[\"b\"', E'\"tokens\": [가림]'),
  (140, E'privateKey=x', E'privateKey=[가림]'),
  (141, E'accessKey=x', E'accessKey=[가림]'),
  (142, E'clientKey=x', E'clientKey=[가림]'),
  (143, E'apiKey=x', E'apiKey=[가림]'),
  (144, E'ApiKey=x', E'ApiKey=[가림]'),
  (145, E'secretToken=x', E'secretToken=[가림]'),
  (146, E'refreshToken=x', E'refreshToken=[가림]'),
  (147, E'dbPassword=x', E'dbPassword=[가림]'),
  (148, E'userPwd=x', E'userPwd=[가림]'),
  (149, E'key=x', E'key=[가림]'),
  (150, E'_key=x', E'_key=[가림]'),
  (151, E'-key=x', E'-key=[가림]'),
  (152, E'prefix-key=x', E'prefix-key=[가림]'),
  (153, E'pin2key=x', E'pin2key=[가림]'),
  (154, E'xKEY=x', E'xKEY=[가림]'),
  (155, E'PrivateKey=x', E'PrivateKey=[가림]'),
  (156, E'hockey=x', E'hockey=x'),
  (157, E'turkey=x', E'turkey=x'),
  (158, E'\"credentials\": { \"key\": \"x\" }', E'\"credentials\": [가림]'),
  (159, E'\"token\" : \"abc\"', E'\"token\" : \"[가림]\"'),
  (160, E'\"credentials\"\n : {\n \"items\": [{\"value\":\"}\"}],\n \"other\": 1\n}, \"ok\": 2', E'\"credentials\"\n : [가림], \"ok\": 2'),
  (161, E'aUtHoRiZaTiOn: abc123 extra,tail\nok', E'[가림]\nok'),
  (162, E'aUtHoRiZaTiOn: ApiKey xxx extra,tail\nok', E'[가림]\nok'),
  (163, E'aUtHoRiZaTiOn: Token xxx extra,tail\nok', E'[가림]\nok'),
  (164, E'aUtHoRiZaTiOn: Basic xxx extra,tail\nok', E'[가림]\nok'),
  (165, E'aUtHoRiZaTiOn: Bearer xxx extra,tail\nok', E'[가림]\nok'),
  (166, E'1801016234567', E'[가림]'),
  (167, E'1801017234567', E'[가림]'),
  (168, E'1801018234567', E'[가림]'),
  (169, E'2025550100', E'[가림]'),
  (170, E'2085550100', E'[가림]'),
  (171, E'-keyring=x', E'-keyring=[가림]'),
  (172, E'Cookie: a=1; sid=abc; token=x', E'[가림]'),
  (173, E'Set-Cookie: sid=abc; Path=/; HttpOnly', E'[가림]'),
  (174, E'whiskey=x donkey=y', E'whiskey=x donkey=y')
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
  (9, E'/a/１２３', E'/a/:id'),
  (10, E'/a/my_api_key=one', E'/a/:id'),
  (11, E'/short/123456789abcdef', E'/short/:id'),
  (12, E'/a/\u0027secret\u0027:\u0027y\u0027', E'/a/:id'),
  (13, E'/a/api_key%3Dabc', E'/a/:id'),
  (14, E'/a/2025550100/1764120000123', E'/a/:id/:id'),
  (15, E'/a/privateKey=x', E'/a/:id')
) as cases(id, input, expected);

-- The database receives Worker-sanitized versions through the aggregate RPC.
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000024');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000024',true);
insert into public.apps(name) values ('version fixture');
set local role authenticated;
select set_config('test.version_hash',
  encode(sha256(convert_to(public.issue_key((select id from public.apps),'pub'),'UTF8')),'hex'),true);
reset role;

create function pg_temp.stored_version(input text) returns text
language plpgsql as $$
begin
  perform public.ingest_batch(current_setting('test.version_hash'),
    jsonb_build_object('app_version',input,'batch_id',gen_random_uuid(),'stats','[]'::jsonb));
  return (select v.version from public.app_versions v join public.app_keys k using(app_id)
    where k.key_hash=current_setting('test.version_hash') and v.version=input);
end $$;
select is(pg_temp.stored_version(input), expected, 'version ' || id)
from (values
  (1, E'2026.11.26.1530', E'2026.11.26.1530'),
  (2, E'v20261126-1530', E'v20261126-1530'),
  (3, E'2026.02.1530.0001', E'2026.02.1530.0001'),
  (4, E'2025550100', E'2025550100')
) as cases(id, input, expected);

with matrix as (select $matrix${
  "names": [
    "Authorization",
    "Proxy-Authorization",
    "Cookie",
    "Set-Cookie",
    "X-Api-Key",
    "Api-Key",
    "X-Auth-Token",
    "X-Access-Token",
    "X-CSRF-Token",
    "pRoXy-AuThOrIzAtIoN",
    "sEt-CoOkIe",
    "privatekey",
    "accesskey",
    "secretkey",
    "apikey",
    "clientkey",
    "authkey",
    "sessionkey",
    "signingkey",
    "encryptionkey",
    "masterkey",
    "token",
    "dbPassword",
    "secret_hint",
    "DB-PASSWD",
    "userPwd",
    "PrivateKey",
    "api_key"
  ],
  "forms": [
    {
      "input": "log {N} : Bearer demo extra\nok",
      "expected": "log [가림]\nok"
    },
    {
      "input": "{N}=Bearer demo",
      "expected": "{N}=[가림]"
    },
    {
      "input": "log {N} : Basic demo extra\nok",
      "expected": "log [가림]\nok"
    },
    {
      "input": "{N}=Basic demo",
      "expected": "{N}=[가림]"
    },
    {
      "input": "log {N} : Token demo extra\nok",
      "expected": "log [가림]\nok"
    },
    {
      "input": "{N}=Token demo",
      "expected": "{N}=[가림]"
    },
    {
      "input": "log {N} : ApiKey demo extra\nok",
      "expected": "log [가림]\nok"
    },
    {
      "input": "{N}=ApiKey demo",
      "expected": "{N}=[가림]"
    },
    {
      "input": "log {N} : Digest username=\"value\", nonce=\"other\" extra\nok",
      "expected": "log [가림]\nok"
    },
    {
      "input": "{N}=Digest username=\"value\", nonce=\"other\"",
      "expected": "{N}=[가림]"
    },
    {
      "input": "log {N} : demo extra\nok",
      "expected": "log [가림]\nok"
    },
    {
      "input": "{N}=demo",
      "expected": "{N}=[가림]"
    },
    {
      "input": "{N}: one two",
      "expected": "[가림]"
    },
    {
      "input": "?{N}=opaque,tail&next=y",
      "expected": "?{N}=[가림]&next=y"
    },
    {
      "input": "?{N}=opaque,tail; next=y",
      "expected": "?{N}=[가림]; next=y"
    },
    {
      "input": "?{N}=opaque,tail next=y",
      "expected": "?{N}=[가림] next=y"
    },
    {
      "input": "?{N}=opaque,tail",
      "expected": "?{N}=[가림]"
    },
    {
      "input": "{\"{N}\":\"one, two\"}",
      "expected": "{\"{N}\":\"[가림]\"}"
    },
    {
      "input": "{\"{N}\" : \"one, two\"}",
      "expected": "{\"{N}\" : \"[가림]\"}"
    },
    {
      "input": "{'{N}':'one, two'}",
      "expected": "{'{N}':'[가림]'}"
    },
    {
      "input": "{'{N}' : 'one, two'}",
      "expected": "{'{N}' : '[가림]'}"
    },
    {
      "input": "{\\\"{N}\\\":\\\"one, two\\\"}",
      "expected": "{\\\"{N}\\\":\\\"[가림]\\\"}"
    },
    {
      "input": "{\\\"{N}\\\" : \\\"one, two\\\"}",
      "expected": "{\\\"{N}\\\" : \\\"[가림]\\\"}"
    },
    {
      "input": "{\\\\\\\"{N}\\\\\\\":\\\\\\\"one, two\\\\\\\"}",
      "expected": "{\\\\\\\"{N}\\\\\\\":\\\\\\\"[가림]\\\\\\\"}"
    },
    {
      "input": "{\\\\\\\"{N}\\\\\\\" : \\\\\\\"one, two\\\\\\\"}",
      "expected": "{\\\\\\\"{N}\\\\\\\" : \\\\\\\"[가림]\\\\\\\"}"
    },
    {
      "input": "{\"{N}\":[\"one\",{\"x\":\"]\"}],\"ok\":1}",
      "expected": "{\"{N}\":[가림],\"ok\":1}"
    },
    {
      "input": "{\"{N}\":{\"x\":[\"a}\",\"b\"]},\"ok\":1}",
      "expected": "{\"{N}\":[가림],\"ok\":1}"
    },
    {
      "input": "{\"{N}\":123,\"ok\":1}",
      "expected": "{\"{N}\":[가림],\"ok\":1}"
    },
    {
      "input": "log {N} => one, two\nok",
      "expected": "log {N} => [가림]\nok"
    },
    {
      "input": "log {N} -> one, two\nok",
      "expected": "log {N} -> [가림]\nok"
    },
    {
      "input": "log {N}, one, two\nok",
      "expected": "log {N}, [가림]\nok"
    },
    {
      "input": "{N}%3Dopaque%20value&next=y",
      "expected": "{N}%3D[가림]&next=y"
    },
    {
      "input": "{N}%3dopaque%20value&next=y",
      "expected": "{N}%3d[가림]&next=y"
    },
    {
      "input": "{N}%3Aopaque%20value&next=y",
      "expected": "{N}%3A[가림]&next=y"
    },
    {
      "input": "{N}%3aopaque%20value&next=y",
      "expected": "{N}%3a[가림]&next=y"
    },
    {
      "input": "{N}%3Aa=1; sid=abc; token=x&ok=y",
      "expected": "{N}%3A[가림]&ok=y"
    },
    {
      "input": "{N}=Token demo,tail; ok=y",
      "expected": "{N}=[가림]; ok=y"
    },
    {
      "input": "{\\\"{N}\\\":[\\\"a]b\\\",\\\"hidden\\\"],\\\"ok\\\":1}",
      "expected": "{\\\"{N}\\\":[가림],\\\"ok\\\":1}"
    },
    {
      "input": "{\\\\\\\"{N}\\\\\\\":[\\\\\\\"a]b\\\\\\\",\\\\\\\"hidden\\\\\\\"],\\\\\\\"ok\\\\\\\":1}",
      "expected": "{\\\\\\\"{N}\\\\\\\":[가림],\\\\\\\"ok\\\\\\\":1}"
    },
    {
      "input": "{'{N}':['a]b','hidden'],'ok':1}",
      "expected": "{'{N}':[가림],'ok':1}"
    }
  ]
}$matrix$::jsonb as spec)
select is(private.mask(replace(form->>'input','{N}',name)),
          replace(form->>'expected','{N}',name), name || ' form ' || idx)
from matrix, jsonb_array_elements_text(spec->'names') names(name),
  jsonb_array_elements(spec->'forms') with ordinality forms(form,idx);

select * from finish();
rollback;
