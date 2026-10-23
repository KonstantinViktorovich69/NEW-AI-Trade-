import type { Candle } from '../patternScannerService.ts';
import { HistoricalDataLoader } from './historicalDataLoader.ts';
import { BacktestEngine } from './backtestEngine.ts';
import type {
  BacktestConfig,
  OptimizationResult,
  OptimizationRankingItem
} from './types.ts';

export class StrategyOptimizer {
  /**
   * Runs grid-search parameter optimization and Walk-Forward Analysis (WFO).
   */
  public static async optimize(
    baseConfig: BacktestConfig,
    customCandles?: Candle[]
  ): Promise<OptimizationResult> {
    const candles = customCandles && customCandles.length > 100
      ? customCandles
      : await HistoricalDataLoader.loadCandles(baseConfig.symbol, baseConfig.timeframe, baseConfig.limitCandles);

    if (candles.length < 80) {
      throw new Error(`Insufficient candle count for optimization: ${candles.length}. Need at least 80.`);
    }

    // --- 1. WALK-FORWARD SPLIT: IN-SAMPLE (70%) vs OUT-OF-SAMPLE (30%) ---
    const splitIndex = Math.floor(candles.length * 0.70);
    const inSampleCandles = candles.slice(0, splitIndex);
    const outOfSampleCandles = candles.slice(splitIndex);

    // Hyperparameter grid for evolution
    const parameterVariations: Array<Partial<BacktestConfig['strategyParams']>> = [
      // Baseline
      { ...baseConfig.strategyParams },
      // Conservative tighter risk
      { wickThresholdPct: 55, volumeMultiplierThreshold: 1.8, stopLossAtrMultiplier: 1.4, takeProfit1Pct: 0.8 },
      // Aggressive wider swings
      { wickThresholdPct: 40, volumeMultiplierThreshold: 1.3, stopLossAtrMultiplier: 2.2, takeProfit1Pct: 1.4 },
      // High volume breakout/exhaustion
      { volumeMultiplierThreshold: 2.2, wickThresholdPct: 50, rsiOverbought: 72, rsiOversold: 28 },
      // Deep oversold hunter
      { rsiOverbought: 75, rsiOversold: 25, stopLossAtrMultiplier: 2.0, takeProfit1Pct: 1.2 },
      // Fast scalper (low wick filter, tight targets)
      { wickThresholdPct: 35, stopLossAtrMultiplier: 1.3, takeProfit1Pct: 0.7, takeProfit2Pct: 1.5 },
      // Dynamic volatility adapted
      { stopLossAtrMultiplier: 2.5, takeProfit1Pct: 1.5, takeProfit2Pct: 2.8, breakevenTriggerPct: 2.0 },
      // Micro-exhaustion reversal
      { wickThresholdPct: 60, volumeMultiplierThreshold: 1.6, stopLossAtrMultiplier: 1.5 }
    ];

    const testedResults: Array<{
      config: BacktestConfig;
      params: Partial<BacktestConfig['strategyParams']>;
      inSampleReport: any;
      fitnessScore: number;
    }> = [];

    for (const variation of parameterVariations) {
      const candidateConfig: BacktestConfig = {
        ...baseConfig,
        strategyParams: {
          ...baseConfig.strategyParams,
          ...variation
        }
      };

      try {
        const rep = await BacktestEngine.run(candidateConfig, inSampleCandles);
        const { winRatePct, profitFactor, sharpeRatio, maxDrawdownPct, netProfitPct } = rep.summary;

        // Composite Fitness Score: balances return, risk, and stability
        const fitnessScore =
          (netProfitPct * 1.5) +
          (winRatePct * 0.4) +
          (profitFactor * 10) +
          (sharpeRatio * 12) -
          (maxDrawdownPct * 2.0);

        testedResults.push({
          config: candidateConfig,
          params: variation,
          inSampleReport: rep,
          fitnessScore
        });
      } catch (err) {
        console.warn(`[OPTIMIZER] Skipped failed candidate:`, err);
      }
    }

    // Sort by fitness score
    testedResults.sort((a, b) => b.fitnessScore - a.fitnessScore);

    const bestCandidate = testedResults[0] || {
      config: baseConfig,
      params: baseConfig.strategyParams,
      inSampleReport: await BacktestEngine.run(baseConfig, inSampleCandles)
    };

    // Run best candidate on Out-Of-Sample data to test robustness
    const outOfSampleReport = await BacktestEngine.run(bestCandidate.config, outOfSampleCandles);

    // Full run report with best config
    const fullBestReport = await BacktestEngine.run(bestCandidate.config, candles);

    // Calculate Walk-Forward Robustness Score
    const inSampleNet = bestCandidate.inSampleReport.summary.netProfitPct;
    const outSampleNet = outOfSampleReport.summary.netProfitPct;

    let robustnessScore = 75; // baseline
    if (inSampleNet > 0) {
      const ratio = outSampleNet / (inSampleNet * 0.43); // proportional 30/70 window
      robustnessScore = Math.min(100, Math.max(10, Math.round(ratio * 70)));
    }

    let recommendation: 'STRONG_PASS' | 'MODERATE_PASS' | 'OVERFITTED' = 'MODERATE_PASS';
    if (outOfSampleReport.summary.winRatePct >= 50 && outSampleNet > 0 && robustnessScore >= 65) {
      recommendation = 'STRONG_PASS';
    } else if (outSampleNet < -5 || robustnessScore < 35) {
      recommendation = 'OVERFITTED';
    }

    // Map best parameters into model weight adaptations (beta0..beta11)
    const suggestedWeights = this.synthesizeModelWeights(bestCandidate.config);

    const rankings: OptimizationRankingItem[] = testedResults.map((item, index) => ({
      rank: index + 1,
      params: item.params,
      netProfitPct: item.inSampleReport.summary.netProfitPct,
      winRatePct: item.inSampleReport.summary.winRatePct,
      profitFactor: item.inSampleReport.summary.profitFactor,
      maxDrawdownPct: item.inSampleReport.summary.maxDrawdownPct,
      sharpeRatio: item.inSampleReport.summary.sharpeRatio,
      totalTrades: item.inSampleReport.summary.totalTrades
    }));

    return {
      testedConfigurations: testedResults.length,
      bestConfig: bestCandidate.config,
      bestSummary: fullBestReport.summary,
      rankings,
      walkForwardAnalysis: {
        inSamplePeriod: {
          candleCount: inSampleCandles.length,
          netProfitPct: bestCandidate.inSampleReport.summary.netProfitPct,
          winRatePct: bestCandidate.inSampleReport.summary.winRatePct,
          sharpeRatio: bestCandidate.inSampleReport.summary.sharpeRatio,
          maxDrawdownPct: bestCandidate.inSampleReport.summary.maxDrawdownPct
        },
        outOfSamplePeriod: {
          candleCount: outOfSampleCandles.length,
          netProfitPct: outOfSampleReport.summary.netProfitPct,
          winRatePct: outOfSampleReport.summary.winRatePct,
          sharpeRatio: outOfSampleReport.summary.sharpeRatio,
          maxDrawdownPct: outOfSampleReport.summary.maxDrawdownPct
        },
        robustnessScore,
        recommendation,
        suggestedModelWeights: suggestedWeights
      }
    };
  }

  /**
   * Maps optimized strategy hyperparameters into model weights for quant model adaptation.
   */
  private static synthesizeModelWeights(config: BacktestConfig): Record<string, number> {
    const p = config.strategyParams;
    return {
      beta0: -0.89, // intercept
      beta1: +(0.25 + (p.wickThresholdPct / 100) * 0.1).toFixed(4), // wick strength
      beta2: -0.10,
      beta3: +(0.50 + (p.volumeMultiplierThreshold / 2.0) * 0.08).toFixed(4), // volume spike weight
      beta4: 0.60, // SAR confirmation
      beta5: +(0.20 + (p.takeProfit1Pct / 2.0) * 0.08).toFixed(4), // TP confidence
      beta6: -0.31,
      beta7: -0.13,
      beta8: +(0.58 + (p.stopLossAtrMultiplier / 3.0) * 0.05).toFixed(4), // ATR SL reliability
      beta9: 0.53,
      beta10: 1.00,
      beta11: 1.28
    };
  }
}
