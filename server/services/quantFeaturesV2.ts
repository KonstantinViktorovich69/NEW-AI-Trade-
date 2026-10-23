import { cleanSymbol, normalizeSymbol, findTickerInMap } from '../utils/symbolUtils.ts';

export interface ComputeQuantFeaturesV2Params {
  symbol: string;
  price: number;
  volume: number;
  side?: 'LONG' | 'SHORT';
  trueOhlcv?: Record<string, any>;
  tickers?: Record<string, any>;
  orderBookImbalance?: Record<string, any>;
}

export interface ComputeQuantFeaturesV2Result {
  features: number[];
  hadIndicators: boolean;
  keyUsed?: string;
  ageSec?: number;
}

/**
 * Computes 11 quant features for Quant Model v2 using clean input data.
 * Pure function: takes direct arguments rather than global contexts.
 *
 * Directional Symmetry Enhancement:
 * Supports side: 'LONG' | 'SHORT'. When side is 'LONG', features (RSI distance,
 * wicks, VWAP displacement, SAR) are symmetrically evaluated for oversold/bounce setups.
 * When side is 'SHORT' or undefined, maintains 100% backward-compatible legacy behavior.
 */
export function computeQuantFeaturesV2(params: ComputeQuantFeaturesV2Params): ComputeQuantFeaturesV2Result {
  const { symbol, price, volume, side, trueOhlcv, tickers, orderBookImbalance } = params;

  if (!symbol) {
    return { features: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hadIndicators: false };
  }

  // 1. Resolve indicators from trueOhlcv using candidate keys
  const candidateKeys = [
    symbol,
    cleanSymbol(symbol),
    normalizeSymbol(symbol)
  ];

  let indicators: any = null;
  let keyUsed: string | undefined = undefined;

  if (trueOhlcv) {
    for (const key of candidateKeys) {
      if (key && trueOhlcv[key]) {
        indicators = trueOhlcv[key];
        keyUsed = key;
        break;
      }
    }
  }

  // If no indicators found, return all zeros with hadIndicators: false
  if (!indicators) {
    return {
      features: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hadIndicators: false
    };
  }

  // Indicator age if timestamp exists
  let ageSec: number | undefined = undefined;
  if (typeof indicators.timestamp === 'number' && indicators.timestamp > 0) {
    ageSec = Math.max(0, Math.round((Date.now() - indicators.timestamp) / 1000));
  } else if (typeof indicators.lastUpdated === 'number' && indicators.lastUpdated > 0) {
    ageSec = Math.max(0, Math.round((Date.now() - indicators.lastUpdated) / 1000));
  }

  const currentPrice = price > 0 ? price : (indicators.close || indicators.price || 1);
  const isLong = side === 'LONG';

  // x1: 48h breakout / breakdown
  const x1 = isLong ? (indicators.is48hBreakdown || indicators.is48hBreakout || 0) : (indicators.is48hBreakout || 0);

  // x2: 1h RSI centered at 0: for SHORT: (rsi - 50); for LONG: (50 - rsi)
  const rawRsi = (indicators.rsi1h !== undefined ? indicators.rsi1h : (indicators.rsi !== undefined ? indicators.rsi : 50));
  const x2 = isLong ? (50 - rawRsi) : (rawRsi - 50);

  // x3: MACD histogram relative to price (%)
  const rawMacd = ((indicators.macdHistogram || 0) / (currentPrice || 1)) * 100;
  const x3 = isLong ? -rawMacd : rawMacd;

  // x4: Distance from EMA50 (%)
  const rawEma50Dist = indicators.ema50 ? ((currentPrice - indicators.ema50) / indicators.ema50) * 100 : 0;
  const x4 = isLong ? -rawEma50Dist : rawEma50Dist;

  // x5: Distance from EMA200 (%)
  const rawEma200Dist = indicators.ema200 ? ((currentPrice - indicators.ema200) / indicators.ema200) * 100 : 0;
  const x5 = isLong ? -rawEma200Dist : rawEma200Dist;

  // x6: Volume spike from real OHLCV candles (volumeSpike >= 1.5 ? 1 : 0)
  const x6 = (indicators.volumeSpike !== undefined && indicators.volumeSpike >= 1.5) ? 1 : 0;

  // x7: Order book imbalance normalized (-1 to 1)
  let ob: any = null;
  if (orderBookImbalance) {
    for (const key of candidateKeys) {
      if (key && orderBookImbalance[key]) {
        ob = orderBookImbalance[key];
        break;
      }
    }
  }
  const rawImbalance = (ob?.imbalance !== undefined ? ob.imbalance : 0) / 100;
  const x7 = isLong ? -rawImbalance : rawImbalance;

  // x8: Wick percentage: for SHORT: top wick (rejection above); for LONG: bottom wick (rejection below)
  const x8 = isLong
    ? (indicators.wicks?.bottomPct ?? indicators.wicks?.lowerPct ?? indicators.wicks?.tailPct ?? indicators.wicks?.topPct ?? 0)
    : (indicators.wicks?.topPct || 0);

  // x9: Liquidity sweep flag
  const x9 = isLong
    ? (indicators.isLiquiditySweepLow || indicators.isLiquiditySweepLow1h || indicators.isLiquiditySweep || indicators.isLiquiditySweep1h || indicators.isLiquiditySweep5m ? 1 : 0)
    : (indicators.isLiquiditySweep || indicators.isLiquiditySweep1h || indicators.isLiquiditySweep5m ? 1 : 0);

  // x10: Distance from VWAP (%): for SHORT: (price - vwap); for LONG: (vwap - price)
  const rawVwapDist = indicators.vwap ? ((currentPrice - indicators.vwap) / indicators.vwap) * 100 : 0;
  const x10 = isLong ? -rawVwapDist : rawVwapDist;

  // x11: Parabolic SAR status: for SHORT: BEARISH -> 1, BULLISH -> -1; for LONG: BULLISH -> 1, BEARISH -> -1
  const x11 = isLong
    ? (indicators.psarStatus === 'BULLISH' ? 1 : (indicators.psarStatus === 'BEARISH' ? -1 : 0))
    : (indicators.psarStatus === 'BEARISH' ? 1 : (indicators.psarStatus === 'BULLISH' ? -1 : 0));

  const features = [x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11];

  return {
    features,
    hadIndicators: true,
    keyUsed,
    ageSec
  };
}
