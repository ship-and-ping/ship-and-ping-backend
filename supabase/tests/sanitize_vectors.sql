begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
create temporary table vectors as select $vectors${
  "omittedMessages": [
    "v1sp\u005fsrv_demo",
    "xSP\u005fPUB_demo",
    "x_sb\u005fsecret_sample",
    "aSb\u005fPuBlIsHaBlE_demo",
    "(sk\u005fabcdefghijklmnop)",
    "_PK\u005f0123456789abcdef",
    "rk\u005fABCDEFGHIJKLMNOP",
    "sk\u005fabcdefghijklmno",
    "xsk\u005fabcdefghijklmnop",
    "9pk\u005fabcdefghijklmnop",
    "task\u005fqueue",
    "basic auth failed",
    "Basic abcdefghijklmno",
    "Basic YWJjZGVmZ2hpamts",
    "Basic YWJjZGVmZ2hpaw==",
    "ＳＰ＿ＳＲＶ＿demo",
    "s​p‌_‍s⁠r﻿v_demo",
    "sp\u005f‮srv_⁦demo⁩",
    "Cookie: sid=one safe nextend",
    "a%40example.test 010-1234-5678",
    "Bearer: demo; token=test",
    "한글sk\u005flive___fixture__",
    "sk\u005ftest___fixture__",
    "(pk\u005flive___fixture__)",
    "rk\u005flive___fixture__",
    "sk\u005ftest___short___",
    "desk\u005flive___fixture__",
    "/task\u005flist",
    "/task\u005flist_abcdefghijk",
    "épk\u005fabcdefghijklmnop",
    "010-1234-5678로 전송 실패",
    "번호01012345678",
    "0101234567890123",
    "메일a@example.test로 전송",
    "오류Bearer: demo; 값token=demo",
    "헤더Cookie: sid=one",
    "인증Basic YWJjZGVmZ2hpamts",
    "인증eyJdemo",
    "refresh_token=abc",
    "id_token=one&api_key=two",
    "my_api_key=one; apikey=two",
    "client_secret=one",
    "X-Api-Key: two",
    "db-PASSWD : one Pwd=two password=three",
    "monkey=banana",
    "tokenizer=one secret_hint: two",
    "token: Bearer abc; next",
    "{\"api_key\":\"abc\",\"id\":1}",
    "\"password\": \"x\"",
    "'secret':'y'",
    "{\"MY-ACCESS_TOKEN\":\"Bearer abc def\",\"db_passwd\":\"a\\\"b\",\"pwd\":\"x,y\"}",
    "\"secret_hint\":\"ok\"",
    "1764120000 1764120000123",
    "0111234567 010-123-4567",
    "02-1234-5678 0311234567",
    "+82 10 1234 5678",
    "(02) 123-4567, 070.1234.5678",
    "1764120000123 01012345678",
    "+1 415 555 0100",
    "+44 20 7946 0958",
    "82-10-1234-5678",
    "010 - 1234 - 5678",
    "900101-1234567",
    "110-123-456789",
    "4111 1111 1111 1111",
    "4111111111111111",
    "123456789",
    "123456789012345",
    "0999999999",
    "2147483648",
    "2147483648000",
    "12345678",
    "1764120000",
    "1764120000123",
    "1000000000",
    "2147483647",
    "1000000000000",
    "2147483647999",
    "{\\\"api_key\\\":\\\"abc\\\"}",
    "\"pin_password\": 1234",
    "'secret' => 'x'",
    "\"token\":\"abc",
    "\"Bearer test\"&next#end",
    "'Basic YWJjZGVmZ2hpamts'#next",
    "token: Bearer demo&next#end",
    "{\"sp\u005fsrv_demo_token\":\"Basic YWJjZGVmZ2hpamts\"}",
    "token=\"Bearer abc\"",
    "password='Basic YWJjZGVmZ2hpamts'",
    "sp\u005fsrv_demo_token=value",
    "token=abc}def",
    "\"token\": [가림]",
    "token=\\opaque",
    "010/1234/5678",
    "010_1234_5678",
    "010\t1234\t5678",
    "010–1234–5678",
    "010‐1234‐5678",
    "010‒1234‒5678",
    "010—1234—5678",
    "010‑1234‑5678",
    "010―1234―5678",
    "010−1234−5678",
    "1501013234567",
    "1801013234567",
    "2002294234567",
    "2125550100",
    "1234567890",
    "1002123456789",
    "1577836799",
    "2082758400",
    "1577836799999",
    "2082758400000",
    "0101234 5678@x.co",
    "Authorization: Token abc",
    "1902293234567",
    "1801015234567",
    "1577836800",
    "2082758399",
    "1577836800000",
    "2082758399999",
    "keyboard=abc",
    "tokens=abc",
    "api_keys=abc",
    "secrets=abc",
    "password_confirmation=abc",
    "token_value=abc",
    "token%3Dabc",
    "api_key%3Dabc",
    "{\\\\\\\"token\\\\\\\":\\\\\\\"abc\\\\\\\"}",
    "\"token\": [\"abc\",\"def\"], ok",
    "\"token\": [[\"a]\"], \"b\"]",
    "5555 5555 5555 4444",
    "378282246310005",
    "1764120000120",
    "accessTokenValue=example",
    "010֊1234֊5678",
    "sp\u005fsrv_demo@example.test",
    "token=\"\"",
    "\"tokens\": [\"a\",\n[\"b\"",
    "privateKey=x",
    "accessKey=x",
    "clientKey=x",
    "apiKey=x",
    "ApiKey=x",
    "secretToken=x",
    "refreshToken=x",
    "dbPassword=x",
    "userPwd=x",
    "key=x",
    "_key=x",
    "-key=x",
    "prefix-key=x",
    "pin2key=x",
    "xKEY=x",
    "PrivateKey=x",
    "hockey=x",
    "turkey=x",
    "\"credentials\": { \"key\": \"x\" }",
    "\"token\" : \"abc\"",
    "\"credentials\"\n : {\n \"items\": [{\"value\":\"}\"}],\n \"other\": 1\n}, \"ok\": 2",
    "aUtHoRiZaTiOn: abc123 extra,tail\nok",
    "aUtHoRiZaTiOn: ApiKey xxx extra,tail\nok",
    "aUtHoRiZaTiOn: Token xxx extra,tail\nok",
    "aUtHoRiZaTiOn: Basic xxx extra,tail\nok",
    "aUtHoRiZaTiOn: Bearer xxx extra,tail\nok",
    "1801016234567",
    "1801017234567",
    "1801018234567",
    "2025550100",
    "2085550100",
    "-keyring=x",
    "Cookie: a=1; sid=abc; token=x",
    "Set-Cookie: sid=abc; Path=/; HttpOnly",
    "whiskey=x donkey=y",
    "Cookie=a=1; sid=abc\nok",
    "cookie=sid=abc;token=x",
    "GET https://example.test/a/42/550e8400-e29b-41d4-a716-446655440000/abcdefghijklmnop?q=one&b=two failed",
    "failed /users/1234567890123?unlisted=raw",
    "name=Jane Doe",
    "배송 라벨",
    "GET https://node2.example2/42?sort=a'b&next=c failed",
    "token=Cookie=a; sid=x\nok",
    "이름=홍길동",
    "a=1; b=2",
    "statusCode=503 STATUS-CODE=404 method=GET",
    "path=/a/42?q=x",
    "version=2026.11.26.1530",
    "stack={\"nickname\":\"sample\",\"line\":42}",
    "'이 름':'홍길동'",
    "first_name=Jane Doe status=503",
    "credentials://hidden",
    "{\"rock'n'roll\":\"private\",\"statusCode\":404}",
    "version={\"line\":1234567890}",
    "status=500 status_code=408 code=E1 error=timeout errorCode=E2 type=network kind=io",
    "reason=busy method=GET route=/items/42?q=secret line=12 column=4 file=a.rs function=run stack=failed",
    "duration=3 duration-ms=4 timeout=5 retry=1 attempt=2 step=load version=v1 platform=web feature=배송"
  ],
  "matrix": {
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
      "api_key",
      "user_id",
      "userId",
      "uid",
      "account_id",
      "accountId",
      "member_id",
      "memberId",
      "customer_id",
      "customerId",
      "session_id",
      "sessionId",
      "name",
      "full_name",
      "fullName",
      "username",
      "email",
      "phone",
      "mobile",
      "tel",
      "address",
      "addr",
      "birth",
      "birthday",
      "first_name",
      "nickname",
      "dob",
      "이름",
      "JSESSIONID",
      "member_no",
      "login_id",
      "🧪"
    ],
    "forms": [
      "log {N} : Bearer demo extra\nok",
      "{N}=Bearer demo",
      "log {N} : Basic demo extra\nok",
      "{N}=Basic demo",
      "log {N} : Token demo extra\nok",
      "{N}=Token demo",
      "log {N} : ApiKey demo extra\nok",
      "{N}=ApiKey demo",
      "log {N} : Digest username=\"value\", nonce=\"other\" extra\nok",
      "{N}=Digest username=\"value\", nonce=\"other\"",
      "log {N} : demo extra\nok",
      "{N}=demo",
      "{N}: one two",
      "?{N}=opaque,tail&next=y",
      "?{N}=opaque,tail; next=y",
      "?{N}=opaque,tail next=y",
      "?{N}=opaque,tail",
      "{\"{N}\":\"one, two\"}",
      "{\"{N}\" : \"one, two\"}",
      "{'{N}':'one, two'}",
      "{'{N}' : 'one, two'}",
      "{\\\"{N}\\\":\\\"one, two\\\"}",
      "{\\\"{N}\\\" : \\\"one, two\\\"}",
      "{\\\\\\\"{N}\\\\\\\":\\\\\\\"one, two\\\\\\\"}",
      "{\\\\\\\"{N}\\\\\\\" : \\\\\\\"one, two\\\\\\\"}",
      "{\"{N}\":[\"one\",{\"x\":\"]\"}],\"ok\":1}",
      "{\"{N}\":{\"x\":[\"a}\",\"b\"]},\"ok\":1}",
      "{\"{N}\":123,\"ok\":1}",
      "log {N} => one, two\nok",
      "log {N} -> one, two\nok",
      "log {N}, one, two\nok",
      "{N}%3Dopaque%20value&next=y",
      "{N}%3dopaque%20value&next=y",
      "{N}%3Aopaque%20value&next=y",
      "{N}%3aopaque%20value&next=y",
      "{N}%3Aa=1; sid=abc; token=x&ok=y",
      "{N}=Token demo,tail; ok=y",
      "{\\\"{N}\\\":[\\\"a]b\\\",\\\"hidden\\\"],\\\"ok\\\":1}",
      "{\\\\\\\"{N}\\\\\\\":[\\\\\\\"a]b\\\\\\\",\\\\\\\"hidden\\\\\\\"],\\\\\\\"ok\\\\\\\":1}",
      "{'{N}':['a]b','hidden'],'ok':1}"
    ]
  },
  "diagnostics": [
    {
      "input": "TypeError: secret",
      "message": "TypeError",
      "kind": null,
      "step": null
    },
    {
      "input": "java.lang.NullPointerException secret",
      "message": "java.lang.NullPointerException",
      "kind": null,
      "step": null
    },
    {
      "input": "StorageFault",
      "message": "StorageFault",
      "kind": "StorageFault",
      "step": "StorageFault"
    },
    {
      "input": "nickname:Jane",
      "message": null,
      "kind": null,
      "step": null
    },
    {
      "input": "E404",
      "message": null,
      "kind": "E404",
      "step": null
    },
    {
      "input": "http_500",
      "message": null,
      "kind": "http_500",
      "step": null
    },
    {
      "input": "E4040",
      "message": null,
      "kind": null,
      "step": null
    },
    {
      "input": "배송 저장",
      "message": null,
      "kind": null,
      "step": "배송 저장"
    },
    {
      "input": "배송 123",
      "message": null,
      "kind": null,
      "step": null
    },
    {
      "input": "token=abc",
      "message": null,
      "kind": null,
      "step": null
    },
    {
      "input": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaError",
      "message": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaError",
      "kind": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaError",
      "step": null
    },
    {
      "input": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaError",
      "message": null,
      "kind": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaError",
      "step": null
    },
    {
      "input": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "message": null,
      "kind": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "step": null
    },
    {
      "input": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "message": null,
      "kind": null,
      "step": null
    },
    {
      "input": "가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가",
      "message": null,
      "kind": null,
      "step": "가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가"
    },
    {
      "input": "가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가",
      "message": null,
      "kind": null,
      "step": null
    }
  ],
  "route": [
    {
      "input": "/notification-preferences/account_settings_panel",
      "expected": "/notification-preferences/account_settings_panel"
    },
    {
      "input": "/notificationpreferences",
      "expected": "/:id"
    },
    {
      "input": "/a/abc123-def456_789",
      "expected": "/a/:id"
    },
    {
      "input": "/a/deadbeefcafebabe",
      "expected": "/a/:id"
    },
    {
      "input": "/a/QUJDREVGR0hJSktMTU4=",
      "expected": "/a/:id"
    },
    {
      "input": "/a/aBcDeFGhiJKlm_NOP",
      "expected": "/a/:id"
    },
    {
      "input": "/a/42;jsessionid=secret?q=x#frag",
      "expected": "/a/:id"
    },
    {
      "input": "/a/v1sp\u005fsrv_demo",
      "expected": "/a/:id"
    },
    {
      "input": "/a/１２３",
      "expected": "/a/:id"
    },
    {
      "input": "/a/my_api_key=one",
      "expected": "/a/:id"
    },
    {
      "input": "/short/123456789abcdef",
      "expected": "/short/:id"
    },
    {
      "input": "/a/'secret':'y'",
      "expected": "/a/:id"
    },
    {
      "input": "/a/api_key%3Dabc",
      "expected": "/a/:id"
    },
    {
      "input": "/a/2025550100/1764120000123",
      "expected": "/a/:id/:id"
    },
    {
      "input": "/a/privateKey=x",
      "expected": "/a/:id"
    }
  ],
  "version": [
    {
      "input": "2026.11.26.1530",
      "expected": "2026.11.26.1530"
    },
    {
      "input": "v20261126-1530",
      "expected": "v20261126-1530"
    },
    {
      "input": "2026.02.1530.0001",
      "expected": "2026.02.1530.0001"
    },
    {
      "input": "2025550100",
      "expected": "2025550100"
    }
  ]
}$vectors$::jsonb as v;
select is(private.error_name(input), null, 'omitted message ' || idx) from vectors,
  jsonb_array_elements_text(v->'omittedMessages') with ordinality inputs(input,idx);
select is(private.error_name(replace(form,'{N}',name)), null, 'omitted ' || name || ' form ' || idx)
from vectors, jsonb_array_elements_text(v#>'{matrix,names}') names(name),
  jsonb_array_elements_text(v#>'{matrix,forms}') with ordinality forms(form,idx);
select is(private.error_name(d->>'input'),d->>'message','message '||idx),
       is(private.error_kind(d->>'input'),d->>'kind','kind '||idx),
       is(private.step_name(d->>'input'),d->>'step','step '||idx)
from vectors, jsonb_array_elements(v->'diagnostics') with ordinality cases(d,idx);
select is(private.route(d->>'input'),d->>'expected','route '||idx)
from vectors, jsonb_array_elements(v->'route') with ordinality cases(d,idx);
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
select is(pg_temp.stored_version(d->>'input'),d->>'expected','version '||idx)
from vectors, jsonb_array_elements(v->'version') with ordinality cases(d,idx);
select * from finish();
rollback;
