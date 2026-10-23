import express from 'express';
import type { Request, Response, Router } from 'express';
import { BacktestEngine } from '../services/backtesting/backtestEngine.ts';
import { StrategyOptimizer } from '../services/backtesting/strategyOptimizer.ts';
import type { BacktestConfig } from '../services/backtesting/types.ts';

export interface BacktestRouterContext {
  getGlobalSettings?: () => any;
  saveSettings?: () => void;
}

export function createBacktestRouter(ctx: BacktestRouterContext = {}): Router {
  const router = express.Router();

  /**
   * GET /api/backtest/defaults
   * Returns default backtest configuration and available WEEX assets.
   */
  router.get('/backtest/defaults', (req: Request, res: Response) => {
    const symbol = (req.query.symbol as string) || 'BTC/USDT:USDT';
    const defaults = BacktestEngine.getDefaultConfig(symbol);
    const popularSymbols = [
      'BTC/USDT:USDT',
      'ETH/USDT:USDT',
      'SOL/USDT:USDT',
      'DOGE/USDT:USDT',
      'XRP/USDT:USDT',
      'AVAX/USDT:USDT'
    ];

    res.json({
      success: true,
      data: {
        defaults,
        popularSymbols,
        timeframes: ['1m', '5m', '15m', '1h']
      }
    });
  });

  /**
   * POST /api/backtest/run
   * Executes event-driven backtest simulation.
   */
  router.post('/backtest/run', async (req: Request, res: Response) => {
    try {
      const userConfig: Partial<BacktestConfig> = req.body || {};
      const baseDefault = BacktestEngine.getDefaultConfig(userConfig.symbol || 'BTC/USDT:USDT');

      const config: BacktestConfig = {
        symbol: userConfig.symbol || baseDefault.symbol,
        timeframe: userConfig.timeframe || baseDefault.timeframe,
        limitCandles: Math.min(3000, Math.max(50, Number(userConfig.limitCandles) || baseDefault.limitCandles)),
        initialBalance: Math.max(10, Number(userConfig.initialBalance) || baseDefault.initialBalance),
        leverage: Math.min(50, Math.max(1, Number(userConfig.leverage) || baseDefault.leverage)),
        marginPerTradePct: Math.min(100, Math.max(1, Number(userConfig.marginPerTradePct) || baseDefault.marginPerTradePct)),
        allowedDirections: userConfig.allowedDirections || baseDefault.allowedDirections,
        strategyParams: {
          ...baseDefault.strategyParams,
          ...(userConfig.strategyParams || {})
        }
      };

      const report = await BacktestEngine.run(config);
      res.json({ success: true, data: report });
    } catch (err: any) {
      console.error('[BACKTEST ROUTE ERROR]', err);
      res.status(500).json({ success: false, error: err.message || 'Backtest simulation failed' });
    }
  });

  /**
   * POST /api/backtest/optimize
   * Runs parameter grid search and Walk-Forward Analysis (WFO).
   */
  router.post('/backtest/optimize', async (req: Request, res: Response) => {
    try {
      const userConfig: Partial<BacktestConfig> = req.body || {};
      const baseDefault = BacktestEngine.getDefaultConfig(userConfig.symbol || 'BTC/USDT:USDT');

      const config: BacktestConfig = {
        symbol: userConfig.symbol || baseDefault.symbol,
        timeframe: userConfig.timeframe || baseDefault.timeframe,
        limitCandles: Math.min(2500, Math.max(80, Number(userConfig.limitCandles) || 500)),
        initialBalance: Math.max(10, Number(userConfig.initialBalance) || baseDefault.initialBalance),
        leverage: Math.min(50, Math.max(1, Number(userConfig.leverage) || baseDefault.leverage)),
        marginPerTradePct: Math.min(100, Math.max(1, Number(userConfig.marginPerTradePct) || baseDefault.marginPerTradePct)),
        allowedDirections: userConfig.allowedDirections || baseDefault.allowedDirections,
        strategyParams: {
          ...baseDefault.strategyParams,
          ...(userConfig.strategyParams || {})
        }
      };

      const optResult = await StrategyOptimizer.optimize(config);
      res.json({ success: true, data: optResult });
    } catch (err: any) {
      console.error('[OPTIMIZATION ROUTE ERROR]', err);
      res.status(500).json({ success: false, error: err.message || 'Optimization failed' });
    }
  });

  /**
   * POST /api/backtest/apply-parameters
   * Applies validated Walk-Forward model weights and strategy parameters into live settings.
   */
  router.post('/backtest/apply-parameters', (req: Request, res: Response) => {
    try {
      const { suggestedWeights, newStrategyParams } = req.body || {};

      if (!ctx.getGlobalSettings || !ctx.saveSettings) {
        return res.status(500).json({ success: false, error: 'Settings persistence context unavailable' });
      }

      const globalSettings = ctx.getGlobalSettings();

      // Non-destructive update: adapt model weights
      if (suggestedWeights && typeof suggestedWeights === 'object') {
        globalSettings.modelWeights = {
          ...(globalSettings.modelWeights || {}),
          ...suggestedWeights
        };
      }

      // Non-destructive update: adapt risk thresholds
      if (newStrategyParams) {
        if (typeof newStrategyParams.stopLossAtrMultiplier === 'number') {
          globalSettings.atrStopLossMultiplier = newStrategyParams.stopLossAtrMultiplier;
        }
        if (typeof newStrategyParams.wickThresholdPct === 'number') {
          globalSettings.liquiditySweepWickThreshold = +(newStrategyParams.wickThresholdPct / 100).toFixed(2);
        }
      }

      ctx.saveSettings();

      res.json({
        success: true,
        message: 'Оптимизированные параметры стратегии успешно применены в настройки терминала'
      });
    } catch (err: any) {
      console.error('[APPLY PARAMETERS ERROR]', err);
      res.status(500).json({ success: false, error: err.message || 'Failed to apply parameters' });
    }
  });

  return router;
}
