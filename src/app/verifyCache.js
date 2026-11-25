// In-memory cache for the whole-corpus verification report. Kept outside the
// store so a rerender does not re-run a 2–4 s check.

let report = null;

export function getVerifyReport() {
  return report;
}

export function setVerifyReport(r) {
  report = r;
}

export function clearVerifyReport() {
  report = null;
}
