import React, { useState, useEffect } from 'react';
import {
  Play,
  RotateCcw,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Activity,
  ShieldAlert,
  BarChart2,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Percent,
  DollarSign,
  ArrowRight,
  Layers,
  ChevronDown,
  ChevronUp,
  Save
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';

interface BacktestPanelProps {
  addToast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const BacktestPanel: React.FC<BacktestPanelProps> = ({ addToast }) => {
  // Configuration state
  const [symbol, setSymbol] = useState('BTC/USDT:USDT');
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '1h'>('15m');
  const [limitCandles, setLimitCandles] = useState<number>(1000);
  const [initialBalance, setInitialBalance] = useState<number>(1000);
  const [leverage, setLeverage] = useState<number>(5);
  const [marginPerTradePct, setMarginPerTradePct] = useState<number>(5);
  const [allowedDirections, setAllowedDirections] = useState<'BOTH' | 'SHORT' | 'LONG'>('BOTH');

  // Advanced strategy parameter state
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [wickThresholdPct, setWickThresholdPct] = useState<number>(45);
  const [volumeMultiplierThreshold, setVolumeMultiplierThreshold] = useState<number>(1.4);
  const [stopLossAtrMultiplier, setStopLossAtrMultiplier] = useState<number>(1.8);
  const [takeProfit1Pct, setTakeProfit1Pct] = useState<number>(1.0);
  const [takeProfit2Pct, setTakeProfit2Pct] = useState<number>(2.0);
  const [takeProfit3Pct, setTakeProfit3Pct] = useState<number>(3.5);
  const [takeProfit4Pct, setTakeProfit4Pct] = useState<number>(5.5);
  const [breakevenTriggerPct, setBreakevenTriggerPct] = useState<number>(1.5);
  const [timeoutStagnationCandles, setTimeoutStagnationCandles] = useState<number>(35);

  // Runtime & Results state
  const [isRunning, setIsRunning] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [report, setReport] = useState<any | null>(null);
  const [optimizationResult, setOptimizationResult] = useState<any | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'trades' | 'optimization'>('overview');
  const [applyingParams, setApplyingParams] = useState(false);

  // Popular quick symbols
  const popularSymbols = [
    'BTC/USDT:USDT',
    'ETH/USDT:USDT',
    'SOL/USDT:USDT',
    'DOGE/USDT:USDT',
    'XRP/USDT:USDT',
    'AVAX/USDT:USDT'
  ];

  // Auto-run baseline backtest on initial mount if not run yet
  useEffect(() => {
    handleRunBacktest();
  }, []);

  const handleRunBacktest = async () => {
    setIsRunning(true);
    try {
      const payload = {
        symbol,
        timeframe,
        limitCandles,
        initialBalance,
        leverage,
        marginPerTradePct,
        allowedDirections,
        strategyParams: {
          wickThresholdPct,
          volumeMultiplierThreshold,
          stopLossAtrMultiplier,
          takeProfit1Pct,
          takeProfit2Pct,
          takeProfit3Pct,
          takeProfit4Pct,
          breakevenTriggerPct,
          timeoutStagnationCandles
        }
      };

      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (json.success && json.data) {
        setReport(json.data);
        if (addToast) {
          addToast(`Бэктест завершен: ${json.data.summary.totalTrades} сделок, Профит: ${json.data.summary.netProfitPct >= 0 ? '+' : ''}${json.data.summary.netProfitPct}%`, json.data.summary.netProfitPct >= 0 ? 'success' : 'info');
        }
      } else {
        throw new Error(json.error || 'Ошибка симуляции бэктеста');
      }
    } catch (err: any) {
      console.error('[BACKTEST FAILED]', err);
      if (addToast) {
        addToast(err.message || 'Не удалось выполнить симуляцию бэктеста', 'error');
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunOptimization = async () => {
    setIsOptimizing(true);
    setActiveSubTab('optimization');
    try {
      const payload = {
        symbol,
        timeframe,
        limitCandles: Math.min(limitCandles, 1500),
        initialBalance,
        leverage,
        marginPerTradePct,
        allowedDirections,
        strategyParams: {
          wickThresholdPct,
          volumeMultiplierThreshold,
          stopLossAtrMultiplier,
          takeProfit1Pct,
          takeProfit2Pct,
          takeProfit3Pct,
          takeProfit4Pct,
          breakevenTriggerPct,
          timeoutStagnationCandles
        }
      };

      const res = await fetch('/api/backtest/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (json.success && json.data) {
        setOptimizationResult(json.data);
        if (addToast) {
          addToast(`Оптимизация завершена: проверено ${json.data.testedConfigurations} конфигураций. WFO вердикт: ${json.data.walkForwardAnalysis?.recommendation || 'OK'}`, 'success');
        }
      } else {
        throw new Error(json.error || 'Ошибка оптимизации');
      }
    } catch (err: any) {
      console.error('[OPTIMIZATION FAILED]', err);
      if (addToast) {
        addToast(err.message || 'Не удалось выполнить оптимизацию', 'error');
      }
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleApplyOptimalParameters = async () => {
    if (!optimizationResult) return;
    setApplyingParams(true);
    try {
      const best = optimizationResult.bestConfig?.strategyParams || {};
      const weights = optimizationResult.walkForwardAnalysis?.suggestedModelWeights || {};

      const res = await fetch('/api/backtest/apply-parameters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestedWeights: weights,
          newStrategyParams: best
        })
      });

      const json = await res.json();
      if (json.success) {
        // Sync local inputs
        if (best.wickThresholdPct) setWickThresholdPct(best.wickThresholdPct);
        if (best.volumeMultiplierThreshold) setVolumeMultiplierThreshold(best.volumeMultiplierThreshold);
        if (best.stopLossAtrMultiplier) setStopLossAtrMultiplier(best.stopLossAtrMultiplier);
        if (best.takeProfit1Pct) setTakeProfit1Pct(best.takeProfit1Pct);

        if (addToast) {
          addToast('Оптимизированные параметры стратегии успешно сохранены в боевые настройки бота', 'success');
        }
      } else {
        throw new Error(json.error || 'Не удалось применить параметры');
      }
    } catch (err: any) {
      console.error('[APPLY ERROR]', err);
      if (addToast) {
        addToast(err.message || 'Ошибка обновления настроек', 'error');
      }
    } finally {
      setApplyingParams(false);
    }
  };

  const summary = report?.summary;

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Config Control Bar */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-5 border-b border-zinc-800/60">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <BarChart2 className="w-5 h-5" />
              </div>
              <h1 className="text-lg font-bold text-zinc-100 tracking-wide uppercase">
                Квантовый Бэктест & Эволюция Стратегии
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                WEEX Event-Driven Replay
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Пошаговая эмуляция рыночной микроструктуры: шпили 1m/15m, снятие ликвидности, 4-ступенчатый TP, спред, проскальзывание и комиссии.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleRunBacktest}
              disabled={isRunning || isOptimizing}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isRunning ? (
                <RotateCcw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Play className="w-4 h-4 fill-white" />
              )}
              {isRunning ? 'Симуляция...' : 'Запустить Бэктест'}
            </button>

            <button
              onClick={handleRunOptimization}
              disabled={isRunning || isOptimizing}
              className="px-4 py-2 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 font-semibold text-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isOptimizing ? (
                <RotateCcw className="w-4 h-4 animate-spin text-purple-300" />
              ) : (
                <Sparkles className="w-4 h-4 text-purple-400" />
              )}
              {isOptimizing ? 'Оптимизация WFO...' : 'Эволюция & WFO'}
            </button>
          </div>
        </div>

        {/* Input Parameters Form */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 pt-4">
          {/* Symbol */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Торговая пара (WEEX)
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Timeframe */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Таймфрейм
            </label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as any)}
              className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-indigo-500 focus:outline-none"
            >
              <option value="1m">1m (Скальпинг)</option>
              <option value="5m">5m (Импульсы)</option>
              <option value="15m">15m (Базовый)</option>
              <option value="1h">1h (Тренд HTF)</option>
            </select>
          </div>

          {/* Candle Count */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Количество свечей
            </label>
            <input
              type="number"
              min="100"
              max="2500"
              step="100"
              value={limitCandles}
              onChange={(e) => setLimitCandles(Number(e.target.value))}
              className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Balance */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Начальный депо ($)
            </label>
            <input
              type="number"
              min="50"
              max="100000"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Leverage */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Плечо (Leverage)
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Direction */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Направление
            </label>
            <select
              value={allowedDirections}
              onChange={(e) => setAllowedDirections(e.target.value as any)}
              className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-indigo-500 focus:outline-none"
            >
              <option value="BOTH">BOTH (SHORT & LONG)</option>
              <option value="SHORT">SHORT ONLY</option>
              <option value="LONG">LONG ONLY</option>
            </select>
          </div>
        </div>

        {/* Quick select coins */}
        <div className="flex items-center gap-1.5 pt-3 overflow-x-auto no-scrollbar">
          <span className="text-[10px] text-zinc-500 font-bold uppercase mr-1">Быстрый выбор:</span>
          {popularSymbols.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                symbol === s
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold'
                  : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {s.split('/')[0]}
            </button>
          ))}

          <button
            onClick={() => setShowAdvancedParams(!showAdvancedParams)}
            className="ml-auto flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
          >
            <Sliders className="w-3 h-3" />
            {showAdvancedParams ? 'Скрыть параметры паттернов' : 'Настроить пороги паттернов'}
            {showAdvancedParams ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Collapsible Advanced Parameters */}
        {showAdvancedParams && (
          <div className="mt-4 pt-4 border-t border-zinc-800/70 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 bg-zinc-950/40 p-3.5 rounded-xl border border-zinc-800/40">
            <div>
              <label className="block text-[9.5px] font-semibold text-zinc-400 mb-1">Порог фитиля (%)</label>
              <input
                type="number"
                min="20"
                max="80"
                value={wickThresholdPct}
                onChange={(e) => setWickThresholdPct(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[9.5px] font-semibold text-zinc-400 mb-1">Всплеск объема (x)</label>
              <input
                type="number"
                step="0.1"
                min="1.0"
                max="5.0"
                value={volumeMultiplierThreshold}
                onChange={(e) => setVolumeMultiplierThreshold(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[9.5px] font-semibold text-zinc-400 mb-1">SL множитель ATR</label>
              <input
                type="number"
                step="0.1"
                min="0.8"
                max="4.0"
                value={stopLossAtrMultiplier}
                onChange={(e) => setStopLossAtrMultiplier(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[9.5px] font-semibold text-zinc-400 mb-1">TP 1 цель (%)</label>
              <input
                type="number"
                step="0.1"
                min="0.3"
                max="5.0"
                value={takeProfit1Pct}
                onChange={(e) => setTakeProfit1Pct(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[9.5px] font-semibold text-zinc-400 mb-1">Безубыток триггер (%)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="4.0"
                value={breakevenTriggerPct}
                onChange={(e) => setBreakevenTriggerPct(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
              />
            </div>
          </div>
        )}
      </div>

      {/* Sub-tab navigation */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
        <button
          onClick={() => setActiveSubTab('overview')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeSubTab === 'overview'
              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Обзор & Метрики
        </button>
        <button
          onClick={() => setActiveSubTab('trades')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            activeSubTab === 'trades'
              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          История Сделок ({report?.trades?.length || 0})
        </button>
        <button
          onClick={() => setActiveSubTab('optimization')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
            activeSubTab === 'optimization'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          Walk-Forward & Эволюция
        </button>
      </div>

      {/* 2. Overview Tab */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {summary ? (
            <>
              {/* KPI Cards Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {/* Net Profit */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Чистый PnL</span>
                  <div className={`text-lg font-bold font-mono mt-1 ${summary.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {summary.netProfit >= 0 ? '+' : ''}{summary.netProfit} $
                  </div>
                  <span className={`text-[10px] font-semibold ${summary.netProfitPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {summary.netProfitPct >= 0 ? '+' : ''}{summary.netProfitPct}%
                  </span>
                </div>

                {/* Win Rate */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Винрейт</span>
                  <div className="text-lg font-bold font-mono mt-1 text-zinc-100">
                    {summary.winRatePct}%
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    {summary.winningTrades}W / {summary.losingTrades}L ({summary.totalTrades} всего)
                  </span>
                </div>

                {/* Profit Factor */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Profit Factor</span>
                  <div className="text-lg font-bold font-mono mt-1 text-indigo-400">
                    {summary.profitFactor}
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    R:R {summary.riskRewardRatio}:1
                  </span>
                </div>

                {/* Sharpe & Sortino */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Sharpe / Sortino</span>
                  <div className="text-lg font-bold font-mono mt-1 text-purple-400">
                    {summary.sharpeRatio} / {summary.sortinoRatio}
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    Calmar: {summary.calmarRatio}
                  </span>
                </div>

                {/* Max Drawdown */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Макс. Просадка</span>
                  <div className="text-lg font-bold font-mono mt-1 text-rose-400">
                    -{summary.maxDrawdownPct}%
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    -{summary.maxDrawdownUsd} $
                  </span>
                </div>

                {/* Alpha vs Buy & Hold */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Альфа к Buy&Hold</span>
                  <div className={`text-lg font-bold font-mono mt-1 ${summary.alphaAgainstBuyAndHold >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {summary.alphaAgainstBuyAndHold >= 0 ? '+' : ''}{summary.alphaAgainstBuyAndHold}%
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    B&H: {summary.buyAndHoldProfitPct >= 0 ? '+' : ''}{summary.buyAndHoldProfitPct}%
                  </span>
                </div>
              </div>

              {/* Equity & Drawdown Chart */}
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                      Кривая Эквити и Динамика Депозита
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Учет нереализованного PnL, маржи, комиссий биржи и проскальзывания
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <span className="flex items-center gap-1.5 text-indigo-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> Эквити ($)
                    </span>
                    <span className="flex items-center gap-1.5 text-rose-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span> Просадка (%)
                    </span>
                  </div>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.equityCurve} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="candleIndex" stroke="#71717a" fontSize={10} tickLine={false} />
                      <YAxis stroke="#71717a" fontSize={10} tickLine={false} domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '0.75rem', fontSize: '11px' }}
                      />
                      <Area type="monotone" dataKey="equity" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#equityGrad)" name="Эквити" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Side Breakdown: LONG vs SHORT */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-rose-400 uppercase">
                      <TrendingDown className="w-4 h-4" /> Шорт-Позиции (SHORT)
                    </span>
                    <span className="text-xs font-mono font-bold text-zinc-200">{summary.shortTradesCount} сделок</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-2 border-t border-zinc-800/60">
                    <span className="text-zinc-400">Винрейт: <strong className="text-zinc-200">{summary.shortWinRatePct}%</strong></span>
                    <span className="text-zinc-400">PnL: <strong className={summary.shortNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{summary.shortNetProfit} $</strong></span>
                  </div>
                </div>

                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 uppercase">
                      <TrendingUp className="w-4 h-4" /> Лонг-Позиции (LONG)
                    </span>
                    <span className="text-xs font-mono font-bold text-zinc-200">{summary.longTradesCount} сделок</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-2 border-t border-zinc-800/60">
                    <span className="text-zinc-400">Винрейт: <strong className="text-zinc-200">{summary.longWinRatePct}%</strong></span>
                    <span className="text-zinc-400">PnL: <strong className={summary.longNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{summary.longNetProfit} $</strong></span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="py-20 text-center text-zinc-500 font-mono text-xs">
              Запустите бэктест для отображения метрик и кривой капитала.
            </div>
          )}
        </div>
      )}

      {/* 3. Trades History Tab */}
      {activeSubTab === 'trades' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 text-[10px] uppercase">
                  <th className="pb-2.5">ID / Сторона</th>
                  <th className="pb-2.5">Паттерн входа</th>
                  <th className="pb-2.5">Вход / Выход</th>
                  <th className="pb-2.5">Причина закрытия</th>
                  <th className="pb-2.5">MFE / MAE</th>
                  <th className="pb-2.5">Комиссия</th>
                  <th className="pb-2.5 text-right">PnL (%)</th>
                  <th className="pb-2.5 text-right">Чистый PnL ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {report?.trades?.map((t: any) => (
                  <tr key={t.id} className="hover:bg-zinc-800/20 transition-colors">
                    <td className="py-2.5 font-bold">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        t.side === 'LONG' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {t.side}
                      </span>
                    </td>
                    <td className="py-2.5 text-zinc-300 text-[11px] truncate max-w-[200px]" title={t.entryPattern}>
                      {t.entryPattern}
                    </td>
                    <td className="py-2.5 text-zinc-300">
                      <div>${t.entryPrice}</div>
                      <div className="text-[10px] text-zinc-500">→ ${t.exitPrice}</div>
                    </td>
                    <td className="py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                        t.closeReason.startsWith('TP')
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : t.closeReason === 'BREAKEVEN'
                          ? 'bg-indigo-500/15 text-indigo-300'
                          : 'bg-rose-500/15 text-rose-300'
                      }`}>
                        {t.closeReason}
                      </span>
                    </td>
                    <td className="py-2.5 text-zinc-400 text-[10px]">
                      <span className="text-emerald-400">+{t.maxFavorableExcursionPct}%</span> / <span className="text-rose-400">-{t.maxAdverseExcursionPct}%</span>
                    </td>
                    <td className="py-2.5 text-zinc-500 text-[10px]">
                      ${t.feePaid.toFixed(3)}
                    </td>
                    <td className={`py-2.5 text-right font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.pnlPercent >= 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                    </td>
                    <td className={`py-2.5 text-right font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Optimization & Walk-Forward Tab */}
      {activeSubTab === 'optimization' && (
        <div className="space-y-6">
          {optimizationResult ? (
            <>
              {/* Walk Forward Status Card */}
              <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/30 rounded-2xl p-5 backdrop-blur-xl">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-purple-400" />
                      <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                        Walk-Forward Анализ Устойчивости (WFO)
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        optimizationResult.walkForwardAnalysis?.recommendation === 'STRONG_PASS'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : optimizationResult.walkForwardAnalysis?.recommendation === 'MODERATE_PASS'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}>
                        {optimizationResult.walkForwardAnalysis?.recommendation}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300 mt-1">
                      Оценка переобучения (Overfitting): стратегия обучалась на In-Sample (70%), затем верифицировалась на Out-of-Sample (30%).
                    </p>
                  </div>

                  <button
                    onClick={handleApplyOptimalParameters}
                    disabled={applyingParams}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {applyingParams ? 'Применение...' : 'Применить лучшие параметры'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 pt-4 border-t border-purple-500/20">
                  <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">In-Sample (70% данных)</span>
                    <div className="text-sm font-bold text-emerald-400 font-mono mt-1">
                      +{optimizationResult.walkForwardAnalysis?.inSamplePeriod?.netProfitPct}%
                    </div>
                    <span className="text-[10px] text-zinc-400">
                      Винрейт: {optimizationResult.walkForwardAnalysis?.inSamplePeriod?.winRatePct}% | Sharpe: {optimizationResult.walkForwardAnalysis?.inSamplePeriod?.sharpeRatio}
                    </span>
                  </div>

                  <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">Out-of-Sample (30% новых)</span>
                    <div className={`text-sm font-bold font-mono mt-1 ${
                      optimizationResult.walkForwardAnalysis?.outOfSamplePeriod?.netProfitPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {optimizationResult.walkForwardAnalysis?.outOfSamplePeriod?.netProfitPct >= 0 ? '+' : ''}
                      {optimizationResult.walkForwardAnalysis?.outOfSamplePeriod?.netProfitPct}%
                    </div>
                    <span className="text-[10px] text-zinc-400">
                      Винрейт: {optimizationResult.walkForwardAnalysis?.outOfSamplePeriod?.winRatePct}% | Sharpe: {optimizationResult.walkForwardAnalysis?.outOfSamplePeriod?.sharpeRatio}
                    </span>
                  </div>

                  <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">Устойчивость (Robustness)</span>
                    <div className="text-sm font-bold text-purple-300 font-mono mt-1">
                      {optimizationResult.walkForwardAnalysis?.robustnessScore} / 100
                    </div>
                    <span className="text-[10px] text-zinc-400">
                      Защита от случайной подгонки под график
                    </span>
                  </div>
                </div>
              </div>

              {/* Optimization Candidates Leaderboard */}
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide mb-3">
                  Таблица Сетки Параметров (Hyperparameter Grid Ranking)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400 text-[10px] uppercase">
                        <th className="pb-2">Ранг</th>
                        <th className="pb-2">Ключевые пороги (Wick / Vol / ATR / TP1)</th>
                        <th className="pb-2">Сделок</th>
                        <th className="pb-2">Винрейт</th>
                        <th className="pb-2">Profit Factor</th>
                        <th className="pb-2">Sharpe</th>
                        <th className="pb-2">Макс. DD</th>
                        <th className="pb-2 text-right">PnL (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {optimizationResult.rankings.map((r: any) => (
                        <tr key={r.rank} className={r.rank === 1 ? 'bg-indigo-500/10' : 'hover:bg-zinc-800/20'}>
                          <td className="py-2.5 font-bold">
                            {r.rank === 1 ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">#1 BEST</span>
                            ) : (
                              <span className="text-zinc-500">#{r.rank}</span>
                            )}
                          </td>
                          <td className="py-2.5 text-zinc-300 text-[11px]">
                            Wick: {r.params.wickThresholdPct || wickThresholdPct}% | Vol: {r.params.volumeMultiplierThreshold || volumeMultiplierThreshold}x | ATR: {r.params.stopLossAtrMultiplier || stopLossAtrMultiplier} | TP1: {r.params.takeProfit1Pct || takeProfit1Pct}%
                          </td>
                          <td className="py-2.5 text-zinc-400">{r.totalTrades}</td>
                          <td className="py-2.5 text-zinc-200">{r.winRatePct}%</td>
                          <td className="py-2.5 text-indigo-400 font-bold">{r.profitFactor}</td>
                          <td className="py-2.5 text-purple-400">{r.sharpeRatio}</td>
                          <td className="py-2.5 text-rose-400">-{r.maxDrawdownPct}%</td>
                          <td className={`py-2.5 text-right font-bold ${r.netProfitPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {r.netProfitPct >= 0 ? '+' : ''}{r.netProfitPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="py-20 text-center text-zinc-500 font-mono text-xs">
              Нажмите кнопку "Эволюция & WFO" для поиска оптимальных параметров и проверки на Walk-Forward окнах.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BacktestPanel;
