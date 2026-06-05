import type { KpiBenchmark } from '@/types/dashboard';

type BenchmarkStatus = 'good' | 'watch' | 'bad' | 'neutral';

function buildBenchmark(
  direction: KpiBenchmark['direction'],
  good: number | null,
  watch: number | null,
  goodLabel: string,
  watchLabel: string,
  badLabel: string,
  neutralLabel?: string,
): KpiBenchmark {
  return {
    direction,
    good: good ?? undefined,
    watch: watch ?? undefined,
    goodLabel,
    watchLabel,
    badLabel,
    neutralLabel,
  };
}

export function benchmarkStatus(benchmark: KpiBenchmark | undefined, value: number | null, available: boolean): BenchmarkStatus {
  if (!benchmark || !available || value === null || !Number.isFinite(Number(value))) return 'neutral';
  if (benchmark.direction === 'neutral' || benchmark.good === undefined || benchmark.watch === undefined) return 'neutral';

  const v = Number(value);
  if (benchmark.direction === 'higher') {
    if (v >= benchmark.good) return 'good';
    if (v >= benchmark.watch) return 'watch';
    return 'bad';
  }

  if (benchmark.direction === 'lower') {
    if (v <= benchmark.good) return 'good';
    if (v <= benchmark.watch) return 'watch';
    return 'bad';
  }

  return 'neutral';
}

export function benchmarkEmoji(benchmark: KpiBenchmark | undefined, value: number | null, available: boolean): string {
  const status = benchmarkStatus(benchmark, value, available);
  if (status === 'good') return '🟢';
  if (status === 'watch') return '🟡';
  if (status === 'bad') return '🔴';
  return '⚪';
}

export function benchmarkLines(benchmark: KpiBenchmark | undefined): string[] {
  if (!benchmark) return [];
  if (benchmark.direction === 'neutral' || benchmark.good === undefined || benchmark.watch === undefined) {
    return [benchmark.neutralLabel ?? 'No fixed industry benchmark; compare against historical trend or chain average.'];
  }
  return [benchmark.goodLabel, benchmark.watchLabel, benchmark.badLabel];
}

export function joBenchmarkFor(id: string): KpiBenchmark {
  switch (id) {
    case 'kpi_01':
      return buildBenchmark('neutral', null, null, '', '', '', 'No fixed industry benchmark; compare against same-hotel history or chain average.');
    case 'kpi_02':
      return buildBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%');
    case 'kpi_03':
      return buildBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%');
    case 'kpi_04':
      return buildBenchmark('lower', 1, 2, 'Good <= 1%', 'Watch 1-2%', 'Bad > 2%');
    case 'kpi_05':
      return buildBenchmark('lower', 3, 5, 'Good <= 3%', 'Watch 3-5%', 'Bad > 5%');
    case 'kpi_06':
      return buildBenchmark('lower', 5, 10, 'Good <= 5%', 'Watch 5-10%', 'Bad > 10%');
    case 'kpi_07':
      return buildBenchmark('lower', 30, 60, 'Good <= 30 min', 'Watch 31-60 min', 'Bad > 60 min');
    case 'kpi_08':
      return buildBenchmark('lower', 60, 120, 'Good <= 60 min', 'Watch 61-120 min', 'Bad > 120 min');
    case 'kpi_09':
      return buildBenchmark('lower', 240, 480, 'Good <= 240 min', 'Watch 241-480 min', 'Bad > 480 min');
    case 'kpi_10':
      return buildBenchmark('neutral', null, null, '', '', '', 'Scale-dependent quantity; compare against the same hotel or prior periods.');
    default:
      return buildBenchmark('neutral', null, null, '', '', '', 'No fixed industry benchmark.');
  }
}

export function moBenchmarkFor(id: string): KpiBenchmark {
  switch (id) {
    case 'mo_total_orders':
      return buildBenchmark('neutral', null, null, '', '', '', 'Scale-dependent volume; compare against hotel history and staffing plan.');
    case 'mo_completion_rate':
      return buildBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%');
    case 'mo_open_rate':
      return buildBenchmark('lower', 5, 10, 'Good <= 5%', 'Watch 5-10%', 'Bad > 10%');
    case 'mo_cancelled_rate':
      return buildBenchmark('lower', 2, 5, 'Good <= 2%', 'Watch 2-5%', 'Bad > 5%');
    case 'mo_severity_index':
      return buildBenchmark('lower', 1.8, 2.4, 'Good <= 1.80 pts', 'Watch 1.81-2.40 pts', 'Bad > 2.40 pts');
    case 'mo_guest_related':
      return buildBenchmark('neutral', null, null, '', '', '', 'Absolute count; compare against guest-mix and period trend.');
    case 'mo_peak_category':
      return buildBenchmark('lower', 20, 30, 'Good <= 20%', 'Watch 20-30%', 'Bad > 30%');
    case 'mo_unique_categories':
      return buildBenchmark('neutral', null, null, '', '', '', 'Category breadth is scale-dependent; compare across like-for-like hotels.');
    case 'mo_unique_assets':
      return buildBenchmark('neutral', null, null, '', '', '', 'Touched assets are scale-dependent; compare against hotel portfolio mix.');
    case 'mo_pending_cases':
      return buildBenchmark('neutral', null, null, '', '', '', 'Open queue size should be interpreted against hotel size and trend.');
    case 'mo_category_span':
      return buildBenchmark('neutral', null, null, '', '', '', 'Category coverage is scale-dependent; compare against historical breadth.');
    case 'mo_daily_average':
      return buildBenchmark('neutral', null, null, '', '', '', 'Daily average is trend-based; compare against the historical baseline.');
    case 'cmo_kpi_01':
      return buildBenchmark('neutral', null, null, '', '', '', 'Scale-dependent volume; compare against chain plan and prior periods.');
    case 'cmo_kpi_02':
      return buildBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%');
    case 'cmo_kpi_03':
      return buildBenchmark('lower', 5, 10, 'Good <= 5%', 'Watch 5-10%', 'Bad > 10%');
    case 'cmo_kpi_04':
      return buildBenchmark('lower', 2, 5, 'Good <= 2%', 'Watch 2-5%', 'Bad > 5%');
    case 'cmo_kpi_05':
      return buildBenchmark('lower', 6, 10, 'Good <= 6%', 'Watch 6-10%', 'Bad > 10%');
    case 'cmo_kpi_06':
      return buildBenchmark('lower', 1.8, 2.4, 'Good <= 1.80 pts', 'Watch 1.81-2.40 pts', 'Bad > 2.40 pts');
    case 'cmo_kpi_07':
      return buildBenchmark('lower', 20, 30, 'Good <= 20%', 'Watch 20-30%', 'Bad > 30%');
    case 'cmo_kpi_08':
      return buildBenchmark('neutral', null, null, '', '', '', 'Active categories are scale-dependent; compare against peer hotels.');
    case 'cmo_kpi_09':
      return buildBenchmark('neutral', null, null, '', '', '', 'Touched assets are scale-dependent; compare against hotel portfolio mix.');
    case 'cmo_kpi_10':
      return buildBenchmark('neutral', null, null, '', '', '', 'Daily average is trend-based; compare against historical baseline.');
    case 'pm_total_orders':
      return buildBenchmark('neutral', null, null, '', '', '', 'Scale-dependent volume; compare against hotel history and PM plan.');
    case 'pm_completion_rate':
      return buildBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%');
    case 'pm_open_rate':
      return buildBenchmark('lower', 5, 10, 'Good <= 5%', 'Watch 5-10%', 'Bad > 10%');
    case 'pm_cancellation_rate':
      return buildBenchmark('lower', 2, 5, 'Good <= 2%', 'Watch 2-5%', 'Bad > 5%');
    case 'pm_severity_index':
      return buildBenchmark('lower', 1.8, 2.4, 'Good <= 1.80 pts', 'Watch 1.81-2.40 pts', 'Bad > 2.40 pts');
    default:
      return buildBenchmark('neutral', null, null, '', '', '', 'No fixed industry benchmark.');
  }
}
