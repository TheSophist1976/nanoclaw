#!/usr/bin/env node
/**
 * Summarize a Health Auto Export JSON into compact daily metrics.
 * Reads from stdin, writes summary JSON to stdout.
 *
 * Usage:
 *   node summarize-health.mjs < HealthAutoExport-2026-04-10.json
 *   cat export.json | node summarize-health.mjs
 */

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function findMetric(metrics, name) {
  return metrics.find((m) => m.name === name);
}

function sumQty(metric) {
  if (!metric?.data?.length) return null;
  return metric.data.reduce((acc, d) => acc + (d.qty || 0), 0);
}

function round(val, decimals = 0) {
  if (val == null) return null;
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

async function main() {
  const raw = await readStdin();
  const parsed = JSON.parse(raw);
  const metrics = parsed?.data?.metrics || [];

  // Resting heart rate — single daily value
  const rhr = findMetric(metrics, 'resting_heart_rate');

  // HRV — a few readings per day, each is meaningful
  const hrv = findMetric(metrics, 'heart_rate_variability');
  const hrvReadings = hrv?.data?.map((d) => round(d.qty)) || [];

  // Steps — sum all entries
  const steps = round(sumQty(findMetric(metrics, 'step_count')));

  // Active energy — sum
  const activeCal = round(sumQty(findMetric(metrics, 'active_energy')));

  // Basal energy — sum (for total daily burn)
  const basalCal = round(sumQty(findMetric(metrics, 'basal_energy_burned')));

  // Exercise minutes — sum
  const exerciseMin = round(sumQty(findMetric(metrics, 'apple_exercise_time')));

  // Water — sum (from Waterllama)
  const waterOz = round(sumQty(findMetric(metrics, 'dietary_water')), 1);

  // Caffeine — sum
  const caffeineMg = round(sumQty(findMetric(metrics, 'caffeine')));

  // Cycling distance — sum
  const cyclingMi = round(sumQty(findMetric(metrics, 'cycling_distance')), 2);

  // Walking/running distance — sum
  const walkRunMi = round(sumQty(findMetric(metrics, 'walking_running_distance')), 2);

  // Flights climbed — sum
  const flights = round(sumQty(findMetric(metrics, 'flights_climbed')));

  // Blood oxygen — take most recent reading
  const spo2 = findMetric(metrics, 'blood_oxygen_saturation');
  const bloodOxygen = spo2?.data?.length
    ? spo2.data[spo2.data.length - 1].qty
    : null;

  // Stand hours — count entries (each entry = 1 stand hour credited)
  const standHours = findMetric(metrics, 'apple_stand_hour');
  const standCount = standHours?.data?.length || 0;

  // Sleep estimate: count consecutive basal_energy entries from midnight
  // (basal energy runs ~1.15 kcal/min during sleep with no active energy)
  // Find the gap between last nighttime entry and first morning activity
  const basal = findMetric(metrics, 'basal_energy_burned');
  let sleepMinutes = null;
  if (basal?.data?.length) {
    // Count entries before first significant active energy
    const active = findMetric(metrics, 'active_energy');
    const firstActiveTime = active?.data?.[0]?.date;
    if (firstActiveTime) {
      const firstActive = new Date(firstActiveTime.replace(' -', '-'));
      const sleepEntries = basal.data.filter((d) => {
        const t = new Date(d.date.replace(' -', '-'));
        return t < firstActive;
      });
      sleepMinutes = sleepEntries.length; // each entry ≈ 1 minute
    }
  }
  const sleepHours = sleepMinutes != null ? round(sleepMinutes / 60, 1) : null;

  const summary = {
    resting_heart_rate_bpm: rhr?.data?.[0]?.qty || null,
    hrv_ms: hrvReadings,
    hrv_avg_ms: hrvReadings.length
      ? round(hrvReadings.reduce((a, b) => a + b, 0) / hrvReadings.length)
      : null,
    sleep_hours_estimate: sleepHours,
    steps,
    active_calories: activeCal,
    basal_calories: basalCal,
    total_calories: activeCal != null && basalCal != null ? activeCal + basalCal : null,
    exercise_minutes: exerciseMin,
    water_fl_oz: waterOz,
    caffeine_mg: caffeineMg,
    cycling_miles: cyclingMi,
    walking_running_miles: walkRunMi,
    flights_climbed: flights,
    blood_oxygen_pct: bloodOxygen,
    stand_hours: standCount,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
