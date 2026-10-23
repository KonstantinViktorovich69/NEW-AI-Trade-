/**
 * Types and interfaces for the Backtesting and Strategy Evolution Engine.
 */

export interface BacktestConfig {
  symbol: string; // e.g., 'BTC/USDT:USDT' or 'ETH/USDT:USDT' or 'SOL/USDT:USDT'
  timeframe: '1m' | '5m' | '15m' | '1h';
  startDate?: string | number;
  endDate?: string | number;
  limitCandles: number; // default 500-2000
  initialBalance: number; // default 1000 USDT
  leverage: number; // default 5x
  marginPerTradePct: number; // default 5%
  allowedDirections: 'BOTH' | 'SHORT' | 'LONG';
  
  // Strategy hyperparameters to test/optimize
  strategyParams: {
    rsiPeriod: number; // default 14
    rsiOverbought: number; // default 70
    rsiOversold: number; // default 30
    sarStep: number; // default 0.02
    sarMax: number; // default 0.2
    wickThresholdPct: number; // default 50%
    volumeMultiplierThreshold: number; // default 1.5x
    liquiditySweepRequired: boolean; // default true
    
    // Risk & Exit Policy
    stopLossAtrMultiplier: number; // default 1.5
    takeProfit1Pct: number; // default 1.0% (close 30%)
    takeProfit2Pct: number; // default 2.0% (close 30%)
    takeProfit3Pct: number; // default 3.5% (close 25%)
    takeProfit4Pct: number; // default 6.0% (close remaining 15%)
    breakevenTriggerPct: number; // default 1.5% profit -> SL to BE +0.3%
    timeoutStagnationCandles: number; // default 40 candles
    
    // Model weights bonus
    minConfidenceScore: number; // default 0.70
  };
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryCandleIndex: number;
  entryTime: number;
  entryPrice: number;
  exitCandleIndex: number;
  exitTime: number;
  exitPrice: number;
  amount: number;
  margin: number;
  leverage: number;
  closeReason: 'TP1' | 'TP2' | 'TP3' | 'TP_FULL' | 'STOP_LOSS' | 'BREAKEVEN' | 'TIMEOUT_STAGNATION' | 'END_OF_DATA';
  pnl: number;
  pnlPercent: number;
  feePaid: number;
  slippagePct: number;
  holdingCandles: number;
  entryPattern: string;
  maxFavorableExcursionPct: number; // MFE (Max potential profit in trade)
  maxAdverseExcursionPct: number; // MAE (Max potential drawdown in trade)
  tpStagesExecuted: number;
}

export interface BacktestEquityPoint {
  timestamp: number;
  candleIndex: number;
  balance: number;
  equity: number;
  drawdownPct: number;
  activePositions: number;
  closePrice: number;
}

export interface BacktestSummary {
  initialBalance: number;
  finalBalance: number;
  netProfit: number;
  netProfitPct: number;
  buyAndHoldProfitPct: number;
  alphaAgainstBuyAndHold: number;
  
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRatePct: number;
  
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdownPct: number;
  maxDrawdownUsd: number;
  recoveryFactor: number;
  
  avgTradePnl: number;
  avgTradePnlPct: number;
  avgWinPnlPct: number;
  avgLossPnlPct: number;
  riskRewardRatio: number;
  avgHoldingCandles: number;
  
  longTradesCount: number;
  longWinRatePct: number;
  longNetProfit: number;
  
  shortTradesCount: number;
  shortWinRatePct: number;
  shortNetProfit: number;
  
  totalFeesPaid: number;
  totalSlippagePaid: number;
}

export interface BacktestReport {
  id: string;
  createdAt: number;
  config: BacktestConfig;
  summary: BacktestSummary;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
}

export interface OptimizationRankingItem {
  rank: number;
  params: Partial<BacktestConfig['strategyParams']>;
  netProfitPct: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalTrades: number;
}

export interface OptimizationResult {
  testedConfigurations: number;
  bestConfig: BacktestConfig;
  bestSummary: BacktestSummary;
  rankings: OptimizationRankingItem[];
  walkForwardAnalysis?: {
    inSamplePeriod: {
      candleCount: number;
      netProfitPct: number;
      winRatePct: number;
      sharpeRatio: number;
      maxDrawdownPct: number;
    };
    outOfSamplePeriod: {
      candleCount: number;
      netProfitPct: number;
      winRatePct: number;
      sharpeRatio: number;
      maxDrawdownPct: number;
    };
    robustnessScore: number; // 0-100%
    recommendation: 'STRONG_PASS' | 'MODERATE_PASS' | 'OVERFITTED';
    suggestedModelWeights: Record<string, number>;
  };
}
