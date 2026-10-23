import { describe, it, expect } from 'vitest';
import { BacktestEngine } from './backtestEngine.ts';
import { HistoricalDataLoader } from './historicalDataLoader.ts';
import { StrategyOptimizer } from './strategyOptimizer.ts';

describe('BacktestEngine and Strategy Evolution', () => {
  it('generates realistic market candles with correct structure and volume', () => {
    const candles = HistoricalDataLoader.generateRealisticMarketCandles('BTC/USDT:USDT', '15m', 150);
    expect(candles).toBeDefined();
    expect(candles.length).toBe(150);

    const first = candles[0];
    expect(first.open).toBeGreaterThan(0);
    expect(first.high).toBeGreaterThanOrEqual(first.low);
    expect(first.volume).toBeGreaterThan(0);
  });

  it('runs backtest and correctly calculates PnL, fees, and metrics', async () => {
    const config = BacktestEngine.getDefaultConfig('ETH/USDT:USDT');
    config.limitCandles = 200;

    const report = await BacktestEngine.run(config);
    expect(report).toBeDefined();
    expect(report.id).toContain('rep_');
    expect(report.summary).toBeDefined();
    expect(report.summary.initialBalance).toBe(config.initialBalance);

    // Mathematical integrity check: finalBalance == initialBalance + netProfit
    const expectedFinal = +(config.initialBalance + report.summary.netProfit).toFixed(2);
    expect(Math.abs(report.summary.finalBalance - expectedFinal)).toBeLessThanOrEqual(0.05);

    expect(Array.isArray(report.trades)).toBe(true);
    expect(Array.isArray(report.equityCurve)).toBe(true);
    expect(report.equityCurve.length).toBeGreaterThan(0);

    // If any trades occurred, check structure
    if (report.trades.length > 0) {
      const trade = report.trades[0];
      expect(trade.id).toBeDefined();
      expect(['LONG', 'SHORT']).toContain(trade.side);
      expect(trade.entryPrice).toBeGreaterThan(0);
      expect(trade.exitPrice).toBeGreaterThan(0);
      expect(trade.feePaid).toBeGreaterThanOrEqual(0);
    }
  });

  it('respects allowedDirections setting (SHORT only)', async () => {
    const config = BacktestEngine.getDefaultConfig('SOL/USDT:USDT');
    config.limitCandles = 200;
    config.allowedDirections = 'SHORT';

    const report = await BacktestEngine.run(config);
    expect(report.summary.longTradesCount).toBe(0);
    for (const trade of report.trades) {
      expect(trade.side).toBe('SHORT');
    }
  });

  it('runs StrategyOptimizer and produces Walk-Forward Analysis rankings', async () => {
    const config = BacktestEngine.getDefaultConfig('BTC/USDT:USDT');
    config.limitCandles = 150;

    const optResult = await StrategyOptimizer.optimize(config);
    expect(optResult).toBeDefined();
    expect(optResult.testedConfigurations).toBeGreaterThan(1);
    expect(optResult.rankings.length).toBeGreaterThan(1);
    expect(optResult.bestConfig).toBeDefined();

    expect(optResult.walkForwardAnalysis).toBeDefined();
    expect(optResult.walkForwardAnalysis?.inSamplePeriod).toBeDefined();
    expect(optResult.walkForwardAnalysis?.outOfSamplePeriod).toBeDefined();
    expect(optResult.walkForwardAnalysis?.suggestedModelWeights).toBeDefined();
    expect(optResult.walkForwardAnalysis?.suggestedModelWeights.beta0).toBeDefined();
  });
});
