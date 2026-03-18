# Weekly Preflight Metrics

- period:
- environment A:
- environment B:
- telemetry files:

## 1) Blocked Count
- total validations:
- blocked validations:
- blocked rate:

## 2) Top Blocked Rules
- rule 1:
- rule 2:
- rule 3:

## 3) False Positive Rate
- reviewed blocked sample size:
- false positives:
- false positive rate:
- review method:
- automation:
  - run `npm run preflight:fp-label`
  - review `.preflight/fp-review.csv` (`human_label` column)
  - use `.preflight/fp-summary.json` as pre-review estimate only

## 4) Overhead Per Command
- avg ms:
- p95 ms:
- measurement method:

## 5) Reproducibility
- environment A result summary:
- environment B result summary:
- delta notes:

## 6) Incident Case Studies
1. incident:
   - what would have broken:
   - what got blocked:
   - rule:
   - outcome:
2. incident:
   - what would have broken:
   - what got blocked:
   - rule:
   - outcome:
3. incident:
   - what would have broken:
   - what got blocked:
   - rule:
   - outcome:
