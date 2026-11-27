// Fixed KST snapshot. Only the reported five-minute failure count comes from the brief.
const snapshotEnd = Date.parse("2026-11-27T18:00:00+09:00");
const hour = 3600000;
const day = hour * 24;
const featureNames = { other: "기타", search: "검색", pay: "결제" };
const records = [];
function record(feature, offset, minute, success, fail, seconds) {
  records.push({feature, at: snapshotEnd - day + offset * hour + minute * 60000, success, fail, seconds});
}
record("other", 2, 10, 2, 0, 0.5);
record("other", 15, 5, 4, 0, 0.75);
record("other", 16, 20, 11, 0, 5);
record("other", 17, 5, 3, 0, 1);
record("other", 20, 10, 20, 0, 0.5);
record("other", 20, 15, 0, 30, null);
record("other", 21, 30, 2, 0, 0.75);
record("pay", 12, 15, 1, 0, 1);
record("pay", 19, 25, 2, 0, 0.75);
for (const [index, count] of [3,2,4,2,1,1,2,1,1,2,4,5,8,7,8,10,9,12,8,6,8,6,5,4].entries()) {
  record("search", index, 10, count, 0, 0.5);
}
for (let back = 1; back < 7; back++) record("other", 15 - back * 24, 5, 3 + back, 0, 0.75);

function aggregate(rows) {
  const success = rows.reduce((sum, r) => sum + r.success, 0);
  const fail = rows.reduce((sum, r) => sum + r.fail, 0);
  const timed = rows.filter(r => r.seconds !== null).sort((a,b) => a.seconds - b.seconds);
  let target = Math.ceil(timed.reduce((sum,r) => sum + r.success, 0) / 2);
  const median = timed.find(r => (target -= r.success) <= 0)?.seconds ?? null;
  return {success, fail, total: success + fail, median};
}
function series(feature, days = 1) {
  const count = days === 1 ? 24 : 7;
  const step = days * day / count;
  const start = snapshotEnd - days * day;
  return Array.from({length:count}, (_, i) => {
    const from = start + i * step;
    return {from, until:from+step, ...aggregate(records.filter(r => r.feature === feature && r.at >= from && r.at < from+step))};
  });
}
globalThis.dashboardFixture = {records, snapshotEnd, featureNames, series, aggregate, hour, day};
