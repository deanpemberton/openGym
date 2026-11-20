import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCsvCell } from '../scripts/strava-csv.js';

test('CSV quoting always preserves delimiters and embedded quote characters',()=>{
  assert.equal(safeCsvCell('bench, "press"'),'"bench, ""press"""');
  assert.equal(safeCsvCell('ordinary exercise'),'"ordinary exercise"');
  assert.equal(safeCsvCell(null),'""');
});
test('CSV export neutralizes Excel, Sheets and LibreOffice formulas',()=>{
  for (const value of ['=SUM(1,2)','+cmd','-1+2','@SUM(A1:A2)',
    '  =HYPERLINK("https://example.invalid","x")','\t=2+2','\r@SUM(1,2)',
    '\n=1+1','\uFEFF=SUM(1,2)','\u200B=SUM(1,2)']) {
    const csv=safeCsvCell(value);
    assert(csv.startsWith('"\''),'unsafe spreadsheet cell '+JSON.stringify(value));
    assert(csv.endsWith('"'));
  }
  assert.equal(safeCsvCell('Barbell Bench Press'),'"Barbell Bench Press"');
});
