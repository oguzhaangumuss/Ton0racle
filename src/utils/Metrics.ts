import { MetricsCollector } from '@/types';

export class SimpleMetricsCollector implements MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();

  increment(metric: string, tags?: Record<string, string>): void {
    const key = this.createKey(metric, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + 1);
  }

  gauge(metric: string, value: number, tags?: Record<string, string>): void {
    const key = this.createKey(metric, tags);
    this.gauges.set(key, value);
  }

  timing(metric: string, duration: number, tags?: Record<string, string>): void {
    this.histogram(metric, duration, tags);
  }

  histogram(metric: string, value: number, tags?: Record<string, string>): void {
    const key = this.createKey(metric, tags);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
  }

  private createKey(metric: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return metric;
    }

    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    
    return `${metric}{${tagString}}`;
  }

  getMetrics(): { counters: Map<string, number>; gauges: Map<string, number>; histograms: Map<string, number[]> } {
    return {
      counters: new Map(this.counters),
      gauges: new Map(this.gauges),
      histograms: new Map(this.histograms)
    };
  }

  getCounterValue(metric: string, tags?: Record<string, string>): number {
    const key = this.createKey(metric, tags);
    return this.counters.get(key) || 0;
  }

  getGaugeValue(metric: string, tags?: Record<string, string>): number | undefined {
    const key = this.createKey(metric, tags);
    return this.gauges.get(key);
  }

  getHistogramValues(metric: string, tags?: Record<string, string>): number[] {
    const key = this.createKey(metric, tags);
    return this.histograms.get(key) || [];
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  // Helper methods for common statistics
  getHistogramStats(metric: string, tags?: Record<string, string>): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const values = this.getHistogramValues(metric, tags);
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);

    return {
      count: values.length,
      sum,
      avg: sum / values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99)
    };
  }

  private percentile(sortedValues: number[], p: number): number {
    const index = Math.ceil(sortedValues.length * p) - 1;
    return sortedValues[Math.max(0, index)];
  }
}