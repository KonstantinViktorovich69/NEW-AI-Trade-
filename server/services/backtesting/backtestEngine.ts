import type { Candle } from '../patternScannerService.ts';
import { calculateRSI, calculateParabolicSAR, calculateBollingerBands } from '../patternScannerService.ts';
import { calculateExecutionPriceWithSlippage, DEFAULT_FEE_CONFIG } from '../../slippageFeeSimulator.ts';
import { HistoricalDataLoader } from './historicalDataLoader.ts';
import type {
  BacktestConfig,
  BacktestReport,
  BacktestTrade,
  BacktestEquityPoint,
  BacktestSummary
} from './types.ts';

export class BacktestEngine {
  /**
   * Default production-tested configuration.
   */
  public static getDefaultConfig(symbol: string = 'BTC/USDT:USDT'): BacktestConfig {
    return {
      symbol,
      timeframe: '15m',
      limitCandles: 1000,
      initialBalance: 1000,
      leverage: 5,
      marginPerTradePct: 5,
      allowedDirections: 'BOTH',
      strategyParams: {
        rsiPeriod: 14,
        rsiOverbought: 68,
        rsiOversold: 32,
        sarStep: 0.02,
        sarMax: 0.2,
        wickThresholdPct: 45,
        volumeMultiplierThreshold: 1.4,
        liquiditySweepRequired: true,
        stopLossAtrMultiplier: 1.8,
        takeProfit1Pct: 1.0,
        takeProfit2Pct: 2.0,
        takeProfit3Pct: 3.5,
        takeProfit4Pct: 5.5,
        breakevenTriggerPct: 1.5,
        timeoutStagnationCandles: 35,
        minConfidenceScore: 0.70
      }
    };
  }

  /**
   * Runs the full backtest bar-by-bar without lookahead bias.
   */
  public static async run(
    config: BacktestConfig,
    customCandles?: Candle[]
  ): Promise<BacktestReport> {
    const candles = customCandles && customCandles.length > 50
      ? customCandles
      : await HistoricalDataLoader.loadCandles(config.symbol, config.timeframe, config.limitCandles);

    if (candles.length < 35) {
      throw new Error(`Insufficient candles for backtest: received ${candles.length}, minimum required 35`);
    }

    let cashBalance = config.initialBalance;
    let peakEquity = config.initialBalance;
    const trades: BacktestTrade[] = [];
    const equityCurve: BacktestEquityPoint[] = [];

    // Active position state
    let openPosition: {
      id: string;
      side: 'LONG' | 'SHORT';
      entryCandleIndex: number;
      entryTime: number;
      entryPrice: number;
      nominalAmount: number;
      remainingAmount: number;
      margin: number;
      leverage: number;
      stopLoss: number;
      breakevenActive: boolean;
      tpStages: { pct: number; ratio: number; executed: boolean }[];
      maxFavorablePrice: number;
      maxAdversePrice: number;
      entryPattern: string;
      entryFee: number;
      slippagePct: number;
      holdingCandles: number;
    } | null = null;

    // Pending limit order state (to test if limit price gets filled on next candle)
    let pendingLimitOrder: {
      side: 'LONG' | 'SHORT';
      limitPrice: number;
      stopLoss: number;
      entryPattern: string;
      candleIndex: number;
    } | null = null;

    const startIdx = 30; // warm-up for indicators

    for (let i = startIdx; i < candles.length; i++) {
      const currentCandle = candles[i];
      const previousCandles = candles.slice(0, i + 1);
      const closes = previousCandles.map(c => c.close);

      // --- 1. EVALUATE PENDING LIMIT ORDER FILL ---
      if (pendingLimitOrder && !openPosition) {
        let isFilled = false;
        if (pendingLimitOrder.side === 'SHORT') {
          // Sell Limit fills if high touches or exceeds limit price
          if (currentCandle.high >= pendingLimitOrder.limitPrice) {
            isFilled = true;
          }
        } else {
          // Buy Limit fills if low touches or goes below limit price
          if (currentCandle.low <= pendingLimitOrder.limitPrice) {
            isFilled = true;
          }
        }

        if (isFilled) {
          const nominalPrice = pendingLimitOrder.limitPrice;
          const { executedPrice, slippagePct } = calculateExecutionPriceWithSlippage(
            nominalPrice,
            pendingLimitOrder.side,
            true, // isEntry
            false // limit order (maker)
          );

          const allocatedMargin = cashBalance * (config.marginPerTradePct / 100);
          const positionSizeUsd = allocatedMargin * config.leverage;
          const nominalAmount = positionSizeUsd / executedPrice;
          const entryFee = positionSizeUsd * DEFAULT_FEE_CONFIG.makerFeeRate;

          cashBalance -= entryFee;

          openPosition = {
            id: `BT-${i}-${pendingLimitOrder.side}`,
            side: pendingLimitOrder.side,
            entryCandleIndex: i,
            entryTime: currentCandle.time,
            entryPrice: executedPrice,
            nominalAmount,
            remainingAmount: nominalAmount,
            margin: allocatedMargin,
            leverage: config.leverage,
            stopLoss: pendingLimitOrder.stopLoss,
            breakevenActive: false,
            tpStages: [
              { pct: config.strategyParams.takeProfit1Pct, ratio: 0.30, executed: false },
              { pct: config.strategyParams.takeProfit2Pct, ratio: 0.30, executed: false },
              { pct: config.strategyParams.takeProfit3Pct, ratio: 0.25, executed: false },
              { pct: config.strategyParams.takeProfit4Pct, ratio: 0.15, executed: false }
            ],
            maxFavorablePrice: executedPrice,
            maxAdversePrice: executedPrice,
            entryPattern: pendingLimitOrder.entryPattern,
            entryFee,
            slippagePct,
            holdingCandles: 0
          };

          pendingLimitOrder = null;
        } else if (i - pendingLimitOrder.candleIndex > 3) {
          // Cancel unfulfilled limit order after 3 candles
          pendingLimitOrder = null;
        }
      }

      // --- 2. EVALUATE ACTIVE POSITION EXITS (SL / TP / BREAKEVEN / TIMEOUT) ---
      if (openPosition) {
        openPosition.holdingCandles++;

        // Update MFE / MAE
        if (openPosition.side === 'LONG') {
          openPosition.maxFavorablePrice = Math.max(openPosition.maxFavorablePrice, currentCandle.high);
          openPosition.maxAdversePrice = Math.min(openPosition.maxAdversePrice, currentCandle.low);
        } else {
          openPosition.maxFavorablePrice = Math.min(openPosition.maxFavorablePrice, currentCandle.low);
          openPosition.maxAdversePrice = Math.max(openPosition.maxAdversePrice, currentCandle.high);
        }

        let isClosed = false;
        let closePrice = currentCandle.close;
        let closeReason: BacktestTrade['closeReason'] = 'END_OF_DATA';

        // A. Check Stop Loss
        const slHit = openPosition.side === 'LONG'
          ? currentCandle.low <= openPosition.stopLoss
          : currentCandle.high >= openPosition.stopLoss;

        if (slHit) {
          isClosed = true;
          closePrice = openPosition.stopLoss;
          closeReason = openPosition.breakevenActive ? 'BREAKEVEN' : 'STOP_LOSS';
        }

        // B. Check Take Profit Stages & Breakeven
        if (!isClosed) {
          const currentProfitPct = openPosition.side === 'LONG'
            ? ((currentCandle.high - openPosition.entryPrice) / openPosition.entryPrice) * 100
            : ((openPosition.entryPrice - currentCandle.low) / openPosition.entryPrice) * 100;

          // Check Breakeven activation (только после фиксации TP1 или достижения безопасного профита с запасом на комиссии +0.25%)
          const hasExecutedAnyTp = openPosition.tpStages.some(tp => tp.executed);
          if (!openPosition.breakevenActive && (hasExecutedAnyTp || currentProfitPct >= Math.max(config.strategyParams.takeProfit1Pct, config.strategyParams.breakevenTriggerPct))) {
            openPosition.breakevenActive = true;
            openPosition.stopLoss = openPosition.side === 'LONG'
              ? openPosition.entryPrice * 1.0025
              : openPosition.entryPrice * 0.9975;
          }

          // Check partial take profits
          for (const tp of openPosition.tpStages) {
            if (!tp.executed && currentProfitPct >= tp.pct) {
              tp.executed = true;
              const targetPrice = openPosition.side === 'LONG'
                ? openPosition.entryPrice * (1 + tp.pct / 100)
                : openPosition.entryPrice * (1 - tp.pct / 100);

              const partialQty = openPosition.nominalAmount * tp.ratio;
              openPosition.remainingAmount = Math.max(0, openPosition.remainingAmount - partialQty);

              const partialPnl = openPosition.side === 'LONG'
                ? (targetPrice - openPosition.entryPrice) * partialQty
                : (openPosition.entryPrice - targetPrice) * partialQty;

              const partialFee = (partialQty * targetPrice) * DEFAULT_FEE_CONFIG.makerFeeRate;
              cashBalance += (partialPnl - partialFee);
            }
          }

          // If remaining amount is negligible, finalize position
          if (openPosition.remainingAmount <= openPosition.nominalAmount * 0.05) {
            isClosed = true;
            closeReason = 'TP_FULL';
            closePrice = openPosition.side === 'LONG'
              ? openPosition.entryPrice * (1 + config.strategyParams.takeProfit4Pct / 100)
              : openPosition.entryPrice * (1 - config.strategyParams.takeProfit4Pct / 100);
          }
        }

        // C. Check Timeout Stagnation
        if (!isClosed && openPosition.holdingCandles >= config.strategyParams.timeoutStagnationCandles) {
          isClosed = true;
          closePrice = currentCandle.close;
          closeReason = 'TIMEOUT_STAGNATION';
        }

        // If closed, finalize trade record
        if (isClosed) {
          const { executedPrice: finalExitPrice, slippagePct: exitSlippage } = calculateExecutionPriceWithSlippage(
            closePrice,
            openPosition.side,
            false, // isEntry
            closeReason === 'STOP_LOSS' // market order on emergency stop
          );

          const exitFee = (openPosition.remainingAmount * finalExitPrice) * DEFAULT_FEE_CONFIG.takerFeeRate;
          const remainingPnl = openPosition.side === 'LONG'
            ? (finalExitPrice - openPosition.entryPrice) * openPosition.remainingAmount
            : (openPosition.entryPrice - finalExitPrice) * openPosition.remainingAmount;

          const totalTradePnl = remainingPnl; // already accumulated partials into cashBalance
          cashBalance += (totalTradePnl - exitFee);

          const totalFee = openPosition.entryFee + exitFee;
          const pnlPct = (totalTradePnl / openPosition.margin) * 100;

          const mfePct = openPosition.side === 'LONG'
            ? ((openPosition.maxFavorablePrice - openPosition.entryPrice) / openPosition.entryPrice) * 100
            : ((openPosition.entryPrice - openPosition.maxFavorablePrice) / openPosition.entryPrice) * 100;

          const maePct = openPosition.side === 'LONG'
            ? ((openPosition.entryPrice - openPosition.maxAdversePrice) / openPosition.entryPrice) * 100
            : ((openPosition.maxAdversePrice - openPosition.entryPrice) / openPosition.entryPrice) * 100;

          const executedStages = openPosition.tpStages.filter(s => s.executed).length;

          trades.push({
            id: openPosition.id,
            symbol: config.symbol,
            side: openPosition.side,
            entryCandleIndex: openPosition.entryCandleIndex,
            entryTime: openPosition.entryTime,
            entryPrice: openPosition.entryPrice,
            exitCandleIndex: i,
            exitTime: currentCandle.time,
            exitPrice: finalExitPrice,
            amount: openPosition.nominalAmount,
            margin: openPosition.margin,
            leverage: openPosition.leverage,
            closeReason,
            pnl: totalTradePnl - totalFee,
            pnlPercent: pnlPct,
            feePaid: totalFee,
            slippagePct: openPosition.slippagePct + exitSlippage,
            holdingCandles: openPosition.holdingCandles,
            entryPattern: openPosition.entryPattern,
            maxFavorableExcursionPct: +mfePct.toFixed(2),
            maxAdverseExcursionPct: +maePct.toFixed(2),
            tpStagesExecuted: executedStages
          });

          openPosition = null;
        }
      }

      // --- 3. SIGNAL GENERATION ON CURRENT CANDLE (IF NO ACTIVE POSITION & NO PENDING ORDER) ---
      if (!openPosition && !pendingLimitOrder) {
        const prevCandle = candles[i - 1];
        const candleRange = Math.max(0.0001, currentCandle.high - currentCandle.low);
        const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
        const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
        const upperWickPct = (upperWick / candleRange) * 100;
        const lowerWickPct = (lowerWick / candleRange) * 100;

        // Volume surge check against last 20 candles average
        const recentVolumes = candles.slice(Math.max(0, i - 20), i).map(c => c.volume);
        const avgVolume = recentVolumes.length > 0
          ? recentVolumes.reduce((acc, v) => acc + v, 0) / recentVolumes.length
          : currentCandle.volume;
        const volumeSurgeRatio = currentCandle.volume / Math.max(1, avgVolume);

        // Technical indicators
        const rsi = calculateRSI(closes, config.strategyParams.rsiPeriod);
        const sarResult = calculateParabolicSAR(
          candles.slice(Math.max(0, i - 15), i + 1),
          config.strategyParams.sarStep,
          config.strategyParams.sarMax
        );

        // Simplified ATR
        const trSlice = candles.slice(Math.max(0, i - 14), i + 1);
        const atr = trSlice.reduce((sum, c, idx) => {
          if (idx === 0) return c.high - c.low;
          const tr = Math.max(c.high - c.low, Math.abs(c.high - trSlice[idx - 1].close), Math.abs(c.low - trSlice[idx - 1].close));
          return sum + tr;
        }, 0) / Math.max(1, trSlice.length);

        const allowShort = config.allowedDirections === 'BOTH' || config.allowedDirections === 'SHORT';
        const allowLong = config.allowedDirections === 'BOTH' || config.allowedDirections === 'LONG';

        // Check Pattern 1: SHORT (1m Spire Climax / Upper Wick Liquidity Sweep / Exhaustion)
        const isShortSetup = allowShort &&
          upperWickPct >= config.strategyParams.wickThresholdPct &&
          volumeSurgeRatio >= config.strategyParams.volumeMultiplierThreshold &&
          rsi >= config.strategyParams.rsiOverbought;

        // Check Pattern 2: LONG (Oversold Dip / Bottom Wick Rejection / Liquidity Sweep Low)
        const isLongSetup = allowLong &&
          lowerWickPct >= config.strategyParams.wickThresholdPct &&
          volumeSurgeRatio >= config.strategyParams.volumeMultiplierThreshold &&
          rsi <= config.strategyParams.rsiOversold;

        if (isShortSetup) {
          // Limit entry at top 40% of wick
          const limitPrice = +(currentCandle.high - (upperWick * 0.4)).toFixed(4);
          const stopLoss = +(currentCandle.high + (atr * config.strategyParams.stopLossAtrMultiplier)).toFixed(4);

          pendingLimitOrder = {
            side: 'SHORT',
            limitPrice,
            stopLoss,
            entryPattern: '⚡ 1m Spire Climax / Liquidity Sweep (SHORT)',
            candleIndex: i
          };
        } else if (isLongSetup) {
          // Limit entry at bottom 40% of wick
          const limitPrice = +(currentCandle.low + (lowerWick * 0.4)).toFixed(4);
          const stopLoss = +(currentCandle.low - (atr * config.strategyParams.stopLossAtrMultiplier)).toFixed(4);

          pendingLimitOrder = {
            side: 'LONG',
            limitPrice,
            stopLoss,
            entryPattern: '⚡ Oversold Dip Reversal (LONG)',
            candleIndex: i
          };
        }
      }

      // --- 4. RECORD EQUITY & DRAWDOWN POINT ---
      let unrealizedPnl = 0;
      if (openPosition) {
        unrealizedPnl = openPosition.side === 'LONG'
          ? (currentCandle.close - openPosition.entryPrice) * openPosition.remainingAmount
          : (openPosition.entryPrice - currentCandle.close) * openPosition.remainingAmount;
      }

      const totalEquity = cashBalance + unrealizedPnl;
      peakEquity = Math.max(peakEquity, totalEquity);
      const drawdownPct = peakEquity > 0 ? ((peakEquity - totalEquity) / peakEquity) * 100 : 0;

      equityCurve.push({
        timestamp: currentCandle.time,
        candleIndex: i,
        balance: +cashBalance.toFixed(2),
        equity: +totalEquity.toFixed(2),
        drawdownPct: +drawdownPct.toFixed(2),
        activePositions: openPosition ? 1 : 0,
        closePrice: currentCandle.close
      });
    }

    // Force close any remaining position at end of data
    if (openPosition) {
      const lastCandle = candles[candles.length - 1];
      const finalExitPrice = lastCandle.close;
      const finalPnl = openPosition.side === 'LONG'
        ? (finalExitPrice - openPosition.entryPrice) * openPosition.remainingAmount
        : (openPosition.entryPrice - finalExitPrice) * openPosition.remainingAmount;

      cashBalance += finalPnl;

      trades.push({
        id: openPosition.id,
        symbol: config.symbol,
        side: openPosition.side,
        entryCandleIndex: openPosition.entryCandleIndex,
        entryTime: openPosition.entryTime,
        entryPrice: openPosition.entryPrice,
        exitCandleIndex: candles.length - 1,
        exitTime: lastCandle.time,
        exitPrice: finalExitPrice,
        amount: openPosition.nominalAmount,
        margin: openPosition.margin,
        leverage: openPosition.leverage,
        closeReason: 'END_OF_DATA',
        pnl: finalPnl,
        pnlPercent: (finalPnl / openPosition.margin) * 100,
        feePaid: openPosition.entryFee,
        slippagePct: openPosition.slippagePct,
        holdingCandles: openPosition.holdingCandles,
        entryPattern: openPosition.entryPattern,
        maxFavorableExcursionPct: 0,
        maxAdverseExcursionPct: 0,
        tpStagesExecuted: 0
      });
    }

    const summary = this.calculateSummary(config, cashBalance, trades, equityCurve, candles);

    return {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now(),
      config,
      summary,
      trades,
      equityCurve
    };
  }

  /**
   * Computes institutional performance metrics.
   */
  private static calculateSummary(
    config: BacktestConfig,
    finalBalance: number,
    trades: BacktestTrade[],
    equityCurve: BacktestEquityPoint[],
    candles: Candle[]
  ): BacktestSummary {
    const netProfit = finalBalance - config.initialBalance;
    const netProfitPct = (netProfit / config.initialBalance) * 100;

    const firstPrice = candles[0].close;
    const lastPrice = candles[candles.length - 1].close;
    const buyAndHoldProfitPct = ((lastPrice - firstPrice) / firstPrice) * 100;
    const alphaAgainstBuyAndHold = netProfitPct - buyAndHoldProfitPct;

    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.pnl > 0.001).length;
    const losingTrades = trades.filter(t => t.pnl < -0.001).length;
    const breakevenTrades = totalTrades - winningTrades - losingTrades;
    const winRatePct = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 99.0 : 0;

    // Max Drawdown calculation
    let maxDrawdownPct = 0;
    let maxDrawdownUsd = 0;
    for (const pt of equityCurve) {
      if (pt.drawdownPct > maxDrawdownPct) maxDrawdownPct = pt.drawdownPct;
    }
    maxDrawdownUsd = (config.initialBalance * maxDrawdownPct) / 100;

    // Sharpe and Sortino ratios
    const returns: number[] = [];
    for (let k = 1; k < equityCurve.length; k++) {
      const prev = equityCurve[k - 1].equity;
      const curr = equityCurve[k].equity;
      returns.push(prev > 0 ? (curr - prev) / prev : 0);
    }

    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 0 ? returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length : 0;
    const stdDev = Math.sqrt(variance);

    const downsideVariance = returns.length > 0
      ? returns.filter(r => r < 0).reduce((a, b) => a + Math.pow(b, 2), 0) / returns.length
      : 0;
    const downsideStdDev = Math.sqrt(downsideVariance);

    // Annualization factor (assuming 15m candles: 4 * 24 * 365 = 35040)
    const annualFactor = Math.sqrt(35040);
    const sharpeRatio = stdDev > 0 ? +((meanReturn / stdDev) * annualFactor).toFixed(2) : 0;
    const sortinoRatio = downsideStdDev > 0 ? +((meanReturn / downsideStdDev) * annualFactor).toFixed(2) : 0;
    const calmarRatio = maxDrawdownPct > 0 ? +(netProfitPct / maxDrawdownPct).toFixed(2) : 0;
    const recoveryFactor = maxDrawdownUsd > 0 ? +(netProfit / maxDrawdownUsd).toFixed(2) : 0;

    const avgTradePnl = totalTrades > 0 ? netProfit / totalTrades : 0;
    const avgTradePnlPct = totalTrades > 0 ? trades.reduce((s, t) => s + t.pnlPercent, 0) / totalTrades : 0;

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    const avgWinPnlPct = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length : 0;
    const avgLossPnlPct = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlPercent, 0) / losses.length) : 0;
    const riskRewardRatio = avgLossPnlPct > 0 ? +(avgWinPnlPct / avgLossPnlPct).toFixed(2) : 0;

    const avgHoldingCandles = totalTrades > 0
      ? Math.round(trades.reduce((s, t) => s + t.holdingCandles, 0) / totalTrades)
      : 0;

    const longTrades = trades.filter(t => t.side === 'LONG');
    const shortTrades = trades.filter(t => t.side === 'SHORT');

    const totalFeesPaid = trades.reduce((s, t) => s + t.feePaid, 0);
    const totalSlippagePaid = trades.reduce((s, t) => s + (t.slippagePct / 100) * t.margin, 0);

    return {
      initialBalance: config.initialBalance,
      finalBalance: +finalBalance.toFixed(2),
      netProfit: +netProfit.toFixed(2),
      netProfitPct: +netProfitPct.toFixed(2),
      buyAndHoldProfitPct: +buyAndHoldProfitPct.toFixed(2),
      alphaAgainstBuyAndHold: +alphaAgainstBuyAndHold.toFixed(2),
      totalTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRatePct: +winRatePct.toFixed(2),
      profitFactor,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      maxDrawdownPct: +maxDrawdownPct.toFixed(2),
      maxDrawdownUsd: +maxDrawdownUsd.toFixed(2),
      recoveryFactor,
      avgTradePnl: +avgTradePnl.toFixed(2),
      avgTradePnlPct: +avgTradePnlPct.toFixed(2),
      avgWinPnlPct: +avgWinPnlPct.toFixed(2),
      avgLossPnlPct: +avgLossPnlPct.toFixed(2),
      riskRewardRatio,
      avgHoldingCandles,
      longTradesCount: longTrades.length,
      longWinRatePct: longTrades.length > 0 ? +(longTrades.filter(t => t.pnl > 0).length / longTrades.length * 100).toFixed(2) : 0,
      longNetProfit: +longTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      shortTradesCount: shortTrades.length,
      shortWinRatePct: shortTrades.length > 0 ? +(shortTrades.filter(t => t.pnl > 0).length / shortTrades.length * 100).toFixed(2) : 0,
      shortNetProfit: +shortTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      totalFeesPaid: +totalFeesPaid.toFixed(2),
      totalSlippagePaid: +totalSlippagePaid.toFixed(2)
    };
  }
}
