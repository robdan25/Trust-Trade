import { useState, useEffect } from 'react'
import './App.css'
import { WorldcoinProvider, WorldcoinContext } from './WorldcoinContext'
import { WorldcoinButton } from './WorldcoinButton'
import { PriceChart } from './PriceChart'
import { DashboardIcon, SignalsIcon, AutomationIcon, PortfolioIcon, TradesIcon, DayTradingIcon, AnalyticsIcon, RiskIcon, BacktestIcon, NotificationsIcon } from './NavIcons'

// Use same domain as frontend (same host), fallback to localhost for development
const API_BASE = import.meta.env.VITE_API_BASE || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:9999')

// Helper to extract error message from various error formats
function getErrorMessage(data) {
  if (!data) return 'Unknown error'

  if (typeof data === 'string') {
    return data
  }

  if (data.error) {
    if (typeof data.error === 'string') {
      return data.error
    } else if (data.error.fieldErrors) {
      // Zod validation error
      const fieldErrors = data.error.fieldErrors
      return Object.entries(fieldErrors).map(([field, errors]) =>
        `${field}: ${errors.join(', ')}`
      ).join(' | ')
    } else {
      return JSON.stringify(data.error)
    }
  }

  return 'Failed to complete request'
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [showApiModal, setShowApiModal] = useState(false)
  const [apiKeys, setApiKeys] = useState({
    krakenApiKey: localStorage.getItem('krakenApiKey') || '',
    krakenApiSecret: localStorage.getItem('krakenApiSecret') || ''
  })
  const [apiKeysForm, setApiKeysForm] = useState({ ...apiKeys })

  // Dashboard state
  const [price, setPrice] = useState(null)
  const [symbol, setSymbol] = useState('BTCUSD')
  const [timeInterval, setTimeInterval] = useState('1m')
  const [signals, setSignals] = useState(null)
  const [candles, setCandles] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [realtimeEnabled, setRealtimeEnabled] = useState(false)
  const [realtimeInterval, setRealtimeInterval] = useState(10000) // 10 seconds
  const [useWebSocket, setUseWebSocket] = useState(true) // Try WebSocket first
  const [wsConnected, setWsConnected] = useState(false)
  const [lastUpdateTime, setLastUpdateTime] = useState(null)

  // Automation state
  const [automationActive, setAutomationActive] = useState(false)
  const [automationSymbols, setAutomationSymbols] = useState('BTCUSD,ETHUSD')
  const [checkInterval, setCheckInterval] = useState(60000)
  const [capitalAmount, setCapitalAmount] = useState(1000)
  const [tradingMode, setTradingMode] = useState('paper')
  const [tradingModeLoading, setTradingModeLoading] = useState(false)
  const [portfolio, setPortfolio] = useState(null)
  const [trades, setTrades] = useState(null)
  const [health, setHealth] = useState(null)

  // Day Trading state
  const [simulationCapital, setSimulationCapital] = useState(100)
  const [simulationResults, setSimulationResults] = useState(null)
  const [simulationLoading, setSimulationLoading] = useState(false)
  const [strategyStatus, setStrategyStatus] = useState(null)
  const [strategyLoading, setStrategyLoading] = useState(false)

  // Analytics state
  const [analytics, setAnalytics] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsTimeRange, setAnalyticsTimeRange] = useState('all') // 'all', '7d', '30d', '90d'

  // Risk Management state
  const [riskSummary, setRiskSummary] = useState(null)
  const [riskLoading, setRiskLoading] = useState(false)
  const [circuitBreakerConfig, setCircuitBreakerConfig] = useState({ maxConsecutiveLosses: 3, cooldownMinutes: 60 })
  const [portfolioLimits, setPortfolioLimits] = useState({ maxExposurePerSymbol: 0.25, maxTotalExposure: 0.75, maxDrawdownPercent: 0.20, maxDailyLossPercent: 0.10 })

  // Backtesting state
  const [backtestResult, setBacktestResult] = useState(null)
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [backtestConfig, setBacktestConfig] = useState({
    symbol: 'BTCUSD',
    strategy: 'momentum',
    days: 30,
    initialCapital: 10000,
    positionSize: 1000,
    interval: '1h'
  })
  const [availableStrategies, setAvailableStrategies] = useState([])
  const [compareResults, setCompareResults] = useState(null)

  // Notifications state
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationPreferences, setNotificationPreferences] = useState(null)
  const [notificationTypes, setNotificationTypes] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)

  useEffect(() => {
    checkHealth()
    checkAutomationStatus() // Check if automation is already running
    fetchTradingMode() // Check current trading mode

    // Periodically check both health and automation status
    const healthCheckInterval = setInterval(checkHealth, 5000)
    const automationCheckInterval = setInterval(checkAutomationStatus, 10000) // Every 10 seconds
    const tradingModeCheckInterval = setInterval(fetchTradingMode, 10000) // Every 10 seconds

    return () => {
      clearInterval(healthCheckInterval)
      clearInterval(automationCheckInterval)
      clearInterval(tradingModeCheckInterval)
    }
  }, [])

  // Real-time chart updates (WebSocket with fallback to polling)
  useEffect(() => {
    if (!realtimeEnabled || !signals) {
      return
    }

    let ws = null
    let realtimeTimer = null

    // Try WebSocket first
    if (useWebSocket) {
      try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsBase = API_BASE.replace('http:', wsProtocol).replace('https:', wsProtocol)
        const wsUrl = wsBase.endsWith('/') ? wsBase + 'ws' : wsBase + '/ws'
        ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          console.log('WebSocket connected')
          setWsConnected(true)
          // Subscribe to symbol
          ws.send(JSON.stringify({
            type: 'subscribe',
            symbol,
            interval: timeInterval
          }))
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'initial' || msg.type === 'update') {
              setSignals({
                symbol: msg.symbol,
                interval: msg.interval,
                price: msg.price,
                signal: msg.signal,
                candles: msg.candles
              })
              setCandles(msg.candles)
              setLastUpdateTime(new Date())
            }
          } catch (e) {
            console.error('WS message parse error:', e)
          }
        }

        ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          setWsConnected(false)
          // Fall back to polling
          setUseWebSocket(false)
        }

        ws.onclose = () => {
          console.log('WebSocket closed')
          setWsConnected(false)
        }
      } catch (e) {
        console.error('WebSocket creation error:', e)
        setUseWebSocket(false)
      }
    }

    // Fallback to polling if WebSocket is disabled
    if (!useWebSocket) {
      realtimeTimer = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/signals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symbol,
              interval: timeInterval,
              short: 12,
              long: 26
            })
          })
          const data = await res.json()
          if (res.ok) {
            setSignals(data)
            setCandles(data.candles || null)
            setLastUpdateTime(new Date())
          }
        } catch (e) {
          console.error('Real-time update error:', e)
        }
      }, realtimeInterval)
    }

    return () => {
      if (ws) {
        ws.close()
        setWsConnected(false)
      }
      if (realtimeTimer) clearInterval(realtimeTimer)
    }
  }, [realtimeEnabled, symbol, timeInterval, realtimeInterval, signals, useWebSocket])

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`)
      const data = await res.json()
      setHealth(data)
    } catch (e) {
      setHealth({ ok: false, error: String(e) })
    }
  }

  const checkAutomationStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/automation/status`)
      const data = await res.json()

      // Update frontend state to match backend
      if (data.active !== undefined) {
        setAutomationActive(data.active)
        console.log('✅ Automation status synced:', data.active ? 'RUNNING' : 'STOPPED')

        // If automation is running, show which symbols
        if (data.active && data.symbols) {
          console.log('   Symbols:', data.symbols.join(', '))
        }
      }
    } catch (e) {
      console.error('Failed to check automation status:', e)
    }
  }

  const fetchTradingMode = async () => {
    try {
      const res = await fetch(`${API_BASE}/automation/mode`)
      const data = await res.json()
      if (data.ok && data.mode) {
        setTradingMode(data.mode)
      }
    } catch (e) {
      console.error('Failed to fetch trading mode:', e)
    }
  }

  const changeTradingMode = async (mode) => {
    setTradingModeLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/automation/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setTradingMode(data.mode)
    } catch (e) {
      setError(String(e))
    } finally {
      setTradingModeLoading(false)
    }
  }

  const saveApiKeys = () => {
    localStorage.setItem('krakenApiKey', apiKeysForm.krakenApiKey)
    localStorage.setItem('krakenApiSecret', apiKeysForm.krakenApiSecret)
    setApiKeys({ ...apiKeysForm })
    setShowApiModal(false)
    setError(null)
  }

  const fetchSignals = async () => {
    setLoading(true)
    setError(null)
    try {
      // Debug: log the actual values
      console.log('Fetching signals with:', { symbol, timeInterval, intervalType: typeof timeInterval })

      const res = await fetch(`${API_BASE}/signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval: timeInterval,
          short: 12,
          long: 26
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setSignals(data)
      setCandles(data.candles || null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const startAutomation = async () => {
    setLoading(true)
    setError(null)
    try {
      const symbols = automationSymbols.split(',').map(s => s.trim().toUpperCase())
      const res = await fetch(`${API_BASE}/automation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols,
          interval: '1m',
          checkInterval: parseInt(checkInterval),
          autoTrade: true,
          balancePerSymbol: parseFloat(capitalAmount),
          sizePct: 0.75
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setAutomationActive(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const stopAutomation = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/automation/stop`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setAutomationActive(false)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const fetchPortfolio = async () => {
    try {
      const res = await fetch(`${API_BASE}/portfolio`)
      const data = await res.json()
      setPortfolio(data)
    } catch (e) {
      setError(String(e))
    }
  }

  const fetchTrades = async () => {
    try {
      const res = await fetch(`${API_BASE}/trades?limit=20`)
      const data = await res.json()
      setTrades(data.trades)
    } catch (e) {
      setError(String(e))
    }
  }

  // Day Trading Functions
  const runSimulation = async () => {
    setSimulationLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/simulation/day-trading`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capital: parseFloat(simulationCapital),
          symbol: 'BTCUSD'
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setSimulationResults(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setSimulationLoading(false)
    }
  }

  const fetchStrategyStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/strategy/status`)
      const data = await res.json()
      setStrategyStatus(data)
    } catch (e) {
      setError(String(e))
    }
  }

  const forceStrategy = async (strategy) => {
    setStrategyLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/strategy/force`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      // Refresh strategy status after forcing
      await fetchStrategyStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setStrategyLoading(false)
    }
  }

  // Analytics Functions
  const fetchAnalytics = async () => {
    setAnalyticsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams();

      // Calculate date ranges
      if (analyticsTimeRange !== 'all') {
        const now = Date.now();
        const days = analyticsTimeRange === '7d' ? 7 : analyticsTimeRange === '30d' ? 30 : 90;
        const startDate = now - (days * 24 * 60 * 60 * 1000);
        params.append('startDate', startDate);
      }

      params.append('initialCapital', capitalAmount || 1000);

      const res = await fetch(`${API_BASE}/analytics?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setAnalytics(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setAnalyticsLoading(false)
    }
  }

  // Risk Management Functions
  const fetchRiskSummary = async () => {
    setRiskLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams();
      params.append('portfolioValue', capitalAmount || 1000);

      const res = await fetch(`${API_BASE}/risk/summary?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setRiskSummary(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setRiskLoading(false)
    }
  }

  const updateCircuitBreakerConfig = async () => {
    setRiskLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/risk/circuit-breaker/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(circuitBreakerConfig)
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setSuccess('Circuit breaker configuration updated')
      await fetchRiskSummary()
    } catch (e) {
      setError(String(e))
    } finally {
      setRiskLoading(false)
    }
  }

  const resetCircuitBreakerManual = async () => {
    setRiskLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/risk/circuit-breaker/reset`, {
        method: 'POST'
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setSuccess('Circuit breaker reset successfully')
      await fetchRiskSummary()
    } catch (e) {
      setError(String(e))
    } finally {
      setRiskLoading(false)
    }
  }

  const updatePortfolioLimitsConfig = async () => {
    setRiskLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/risk/limits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portfolioLimits)
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setSuccess('Portfolio limits updated')
      await fetchRiskSummary()
    } catch (e) {
      setError(String(e))
    } finally {
      setRiskLoading(false)
    }
  }

  // Backtesting Functions
  const fetchAvailableStrategies = async () => {
    try {
      const res = await fetch(`${API_BASE}/backtest/strategies`)
      const data = await res.json()
      if (res.ok && data.strategies) {
        setAvailableStrategies(data.strategies)
      }
    } catch (e) {
      console.error('Failed to fetch strategies:', e)
    }
  }

  const runBacktest = async () => {
    setBacktestLoading(true)
    setError(null)
    setBacktestResult(null)
    try {
      const startDate = Date.now() - (backtestConfig.days * 24 * 60 * 60 * 1000)
      const endDate = Date.now()

      const res = await fetch(`${API_BASE}/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...backtestConfig,
          startDate,
          endDate
        })
      })

      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }

      setBacktestResult(data)
      setSuccess(`Backtest complete: ${data.summary?.totalTrades || 0} trades`)
    } catch (e) {
      setError(String(e))
    } finally {
      setBacktestLoading(false)
    }
  }

  const runStrategyComparison = async () => {
    setBacktestLoading(true)
    setError(null)
    setCompareResults(null)
    try {
      const startDate = Date.now() - (backtestConfig.days * 24 * 60 * 60 * 1000)
      const endDate = Date.now()

      const res = await fetch(`${API_BASE}/backtest/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: backtestConfig.symbol,
          startDate,
          endDate,
          initialCapital: backtestConfig.initialCapital,
          positionSize: backtestConfig.positionSize,
          interval: backtestConfig.interval
        })
      })

      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }

      setCompareResults(data)
      setSuccess(`Compared ${data.comparison?.length || 0} strategies`)
    } catch (e) {
      setError(String(e))
    } finally {
      setBacktestLoading(false)
    }
  }

  // Notification Functions
  const fetchNotifications = async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications`)
      const data = await res.json()
      if (res.ok && data.notifications) {
        setNotifications(data.notifications)
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e)
    }
  }

  const fetchUnreadCount = async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications/unread`)
      const data = await res.json()
      if (res.ok) {
        setUnreadCount(data.count || 0)
      }
    } catch (e) {
      console.error('Failed to fetch unread count:', e)
    }
  }

  const fetchNotificationPreferences = async () => {
    setNotificationsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/notifications/preferences`)
      const data = await res.json()
      if (res.ok && data.preferences) {
        setNotificationPreferences(data.preferences)
      }
    } catch (e) {
      console.error('Failed to fetch notification preferences:', e)
    } finally {
      setNotificationsLoading(false)
    }
  }

  const fetchNotificationTypes = async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications/types`)
      const data = await res.json()
      if (res.ok && data.types) {
        setNotificationTypes(data.types)
      }
    } catch (e) {
      console.error('Failed to fetch notification types:', e)
    }
  }

  const updateNotificationPreferences = async (newPrefs) => {
    setNotificationsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/notifications/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPrefs)
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setNotificationPreferences(data.preferences)
      setSuccess('Notification preferences updated')
    } catch (e) {
      setError(String(e))
    } finally {
      setNotificationsLoading(false)
    }
  }

  const sendTestNotification = async () => {
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/notifications/test`, {
        method: 'POST'
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getErrorMessage(data))
        return
      }
      setSuccess('Test notification sent!')
      await fetchNotifications()
      await fetchUnreadCount()
    } catch (e) {
      setError(String(e))
    }
  }

  const markNotificationAsRead = async (id) => {
    try {
      await fetch(`${API_BASE}/notifications/${id}/read`, {
        method: 'POST'
      })
      await fetchNotifications()
      await fetchUnreadCount()
    } catch (e) {
      console.error('Failed to mark notification as read:', e)
    }
  }

  const markAllNotificationsAsRead = async () => {
    try {
      await fetch(`${API_BASE}/notifications/read-all`, {
        method: 'POST'
      })
      await fetchNotifications()
      await fetchUnreadCount()
    } catch (e) {
      console.error('Failed to mark all as read:', e)
    }
  }

  const clearAllNotifications = async () => {
    try {
      await fetch(`${API_BASE}/notifications/clear`, {
        method: 'POST'
      })
      await fetchNotifications()
      await fetchUnreadCount()
    } catch (e) {
      console.error('Failed to clear notifications:', e)
    }
  }

  return (
    <div className="App">
      {/* Header */}
      <header className="kraken-header">
        <div className="header-content">
          <div className="logo">
            <h1>TrustTrade</h1>
            <span className="subtitle">Kraken Powered Trading</span>
          </div>
          <div className="header-right">
            <div className={`status-indicator ${health?.ok ? 'online' : 'offline'}`}>
              <span className="status-dot"></span>
              {health?.ok ? 'Connected' : 'Offline'}
            </div>
            <WorldcoinProvider>
              <WorldcoinButton />
            </WorldcoinProvider>
            <button
              className="api-btn"
              onClick={() => setShowApiModal(true)}
              title="Configure API Keys"
            >
              ⚙️ API Config
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="kraken-nav">
        <button
          className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
          title="Dashboard"
        >
          <DashboardIcon />
          <span>Dashboard</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'signals' ? 'active' : ''}`}
          onClick={() => setActiveTab('signals')}
          title="Signals"
        >
          <SignalsIcon />
          <span>Signals</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'automation' ? 'active' : ''}`}
          onClick={() => setActiveTab('automation')}
          title="Automation"
        >
          <AutomationIcon />
          <span>Automation</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'portfolio' ? 'active' : ''}`}
          onClick={() => { setActiveTab('portfolio'); fetchPortfolio(); fetchTrades(); }}
          title="Portfolio"
        >
          <PortfolioIcon />
          <span>Portfolio</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'trades' ? 'active' : ''}`}
          onClick={() => { setActiveTab('trades'); fetchTrades(); }}
          title="Trade History"
        >
          <TradesIcon />
          <span>Trade History</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'daytrading' ? 'active' : ''}`}
          onClick={() => { setActiveTab('daytrading'); fetchStrategyStatus(); }}
          title="Day Trading"
        >
          <DayTradingIcon />
          <span>Day Trading</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => { setActiveTab('analytics'); fetchAnalytics(); }}
          title="Performance Analytics"
        >
          <AnalyticsIcon />
          <span>Analytics</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'risk' ? 'active' : ''}`}
          onClick={() => { setActiveTab('risk'); fetchRiskSummary(); }}
          title="Risk Management"
        >
          <RiskIcon />
          <span>Risk</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'backtest' ? 'active' : ''}`}
          onClick={() => { setActiveTab('backtest'); fetchAvailableStrategies(); }}
          title="Backtesting"
        >
          <BacktestIcon />
          <span>Backtest</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'notifications' ? 'active' : ''}`}
          onClick={() => { setActiveTab('notifications'); fetchNotifications(); fetchNotificationPreferences(); fetchNotificationTypes(); fetchUnreadCount(); }}
          title="Notifications"
        >
          <NotificationsIcon hasUnread={unreadCount > 0} />
          <span>Notifications{unreadCount > 0 && ` (${unreadCount})`}</span>
        </button>
      </nav>

      {/* Main Content */}
      <main className="kraken-main">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="dashboard">
            <div className="price-display">
              <div className="symbol-selector">
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="BTCUSD"
                  className="symbol-input"
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                {[
                  { symbol: 'BTCUSD', label: 'BTC' },
                  { symbol: 'ETHUSD', label: 'ETH' },
                  { symbol: 'XRPUSD', label: 'XRP' },
                  { symbol: 'ADAUSD', label: 'ADA' },
                  { symbol: 'SOLUSD', label: 'SOL' },
                  { symbol: 'WLDUSD', label: '🌍 WLD' }
                ].map(({ symbol: coin, label }) => (
                  <button
                    key={coin}
                    onClick={() => {
                      setSymbol(coin)
                      // Clear existing data when switching symbols
                      setSignals(null)
                      setCandles(null)
                      setRealtimeEnabled(false)
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      background: symbol === coin ? 'var(--primary)' : 'rgba(107, 91, 149, 0.2)',
                      color: symbol === coin ? 'white' : 'var(--primary)',
                      border: `1px solid ${symbol === coin ? 'var(--primary)' : 'rgba(107, 91, 149, 0.5)'}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: '600',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (symbol !== coin) {
                        e.target.style.background = 'rgba(107, 91, 149, 0.3)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (symbol !== coin) {
                        e.target.style.background = 'rgba(107, 91, 149, 0.2)'
                      }
                    }}
                    title={coin === 'WLDUSD' ? 'Worldcoin Token' : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {signals && (
                <div className="price-card">
                  <div className="price-row">
                    <span className="price-label">Last Price</span>
                    <span className="price-value">${signals.price?.toFixed(2)}</span>
                  </div>
                  <div className="price-row">
                    <span className="price-label">Signal</span>
                    <span className={`signal-badge ${signals.signal}`}>
                      {signals.signal.toUpperCase()}
                    </span>
                  </div>
                  {signals.explain && (
                    <div className="explanation">
                      <p><strong>AI Insight:</strong> {signals.explain.explanation}</p>
                    </div>
                  )}
                </div>
              )}
              <button
                className="btn-primary"
                onClick={fetchSignals}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Generate Signal'}
              </button>
              {signals && (
                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--dark-secondary)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={realtimeEnabled}
                      onChange={(e) => setRealtimeEnabled(e.target.checked)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.95rem' }}>📡 Real-time Updates</span>
                    {wsConnected && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        ● WebSocket
                      </span>
                    )}
                    {realtimeEnabled && !wsConnected && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        ● Polling
                      </span>
                    )}
                  </label>

                  {realtimeEnabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                      <div>
                        <label style={{ fontSize: '0.85rem', color: '#a0a0a0', display: 'block', marginBottom: '0.5rem' }}>
                          Update Interval: {realtimeInterval / 1000}s
                        </label>
                        <input
                          type="range"
                          min="5000"
                          max="60000"
                          step="5000"
                          value={realtimeInterval}
                          onChange={(e) => setRealtimeInterval(parseInt(e.target.value))}
                          style={{ width: '100%', cursor: 'pointer' }}
                        />
                        <div style={{ fontSize: '0.75rem', color: '#666', display: 'flex', justifyContent: 'space-between', marginTop: '0.3rem' }}>
                          <span>5s</span>
                          <span>60s</span>
                        </div>
                      </div>

                      {lastUpdateTime && (
                        <div style={{ fontSize: '0.8rem', color: '#888' }}>
                          Last update: {lastUpdateTime.toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Price Chart */}
            <div className="card" style={{ marginTop: '2rem' }}>
              <h3>Price Chart</h3>
              <PriceChart candles={candles} symbol={symbol} />
            </div>

            {error && <div className="alert-error">{error}</div>}
          </div>
        )}

        {/* Signals Tab */}
        {activeTab === 'signals' && (
          <div className="signals-section">
            <div className="card">
              <h2>Signal Generator</h2>
              <div className="form-grid">
                <div className="form-group">
                  <label>Symbol</label>
                  <input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    placeholder="BTCUSD"
                    className="input"
                  />
                </div>
                <div className="form-group">
                  <label>Interval</label>
                  <select value={timeInterval} onChange={(e) => setTimeInterval(e.target.value)} className="input">
                    <option>1m</option>
                    <option>5m</option>
                    <option>15m</option>
                    <option>1h</option>
                  </select>
                </div>
              </div>
              <button className="btn-primary" onClick={fetchSignals} disabled={loading}>
                {loading ? 'Analyzing...' : 'Generate Signal'}
              </button>

              {signals && (
                <div className="signal-result">
                  <div className="result-grid">
                    <div className="result-item">
                      <span className="result-label">Signal</span>
                      <span className={`result-value signal-${signals.signal}`}>
                        {signals.signal.toUpperCase()}
                      </span>
                    </div>
                    <div className="result-item">
                      <span className="result-label">Price</span>
                      <span className="result-value">${signals.price?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
              {error && <div className="alert-error">{error}</div>}
            </div>
          </div>
        )}

        {/* Automation Tab */}
        {activeTab === 'automation' && (
          <div className="automation-section">
            <div className="card">
              <h2>Automated Trading</h2>

              {/* Trading Mode Toggle */}
              <div style={{
                background: tradingMode === 'live' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                border: `2px solid ${tradingMode === 'live' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(34, 197, 94, 0.5)'}`,
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '1.5rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                      {tradingMode === 'paper' ? '📄 Paper Trading Mode' : '🔴 LIVE Trading Mode'}
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#a0a0a0' }}>
                      {tradingMode === 'paper'
                        ? 'Simulated trades with fake money - Safe for testing'
                        : '⚠️ WARNING: Real money trades will be executed on Kraken'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn-secondary"
                      onClick={() => changeTradingMode('paper')}
                      disabled={tradingModeLoading || tradingMode === 'paper'}
                      style={{
                        background: tradingMode === 'paper' ? 'rgba(34, 197, 94, 0.3)' : 'transparent',
                        border: `1px solid ${tradingMode === 'paper' ? '#22c55e' : 'rgba(255,255,255,0.2)'}`,
                        color: tradingMode === 'paper' ? '#22c55e' : '#fff',
                        cursor: tradingModeLoading || tradingMode === 'paper' ? 'not-allowed' : 'pointer'
                      }}
                    >
                      📄 Paper
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => changeTradingMode('live')}
                      disabled={tradingModeLoading || tradingMode === 'live'}
                      style={{
                        background: tradingMode === 'live' ? 'rgba(239, 68, 68, 0.3)' : 'transparent',
                        border: `1px solid ${tradingMode === 'live' ? '#ef4444' : 'rgba(255,255,255,0.2)'}`,
                        color: tradingMode === 'live' ? '#ef4444' : '#fff',
                        cursor: tradingModeLoading || tradingMode === 'live' ? 'not-allowed' : 'pointer'
                      }}
                    >
                      🔴 Live
                    </button>
                  </div>
                </div>
                {tradingMode === 'live' && (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    borderRadius: '6px',
                    padding: '1rem',
                    fontSize: '0.85rem',
                    color: '#fca5a5'
                  }}>
                    <strong>⚠️ LIVE MODE ACTIVE:</strong> Real orders will be placed on Kraken. Real money will be used. Losses are permanent. Make sure you understand the risks before trading.
                  </div>
                )}
              </div>

              <div className="preset-buttons">
                <button
                  className="preset-btn"
                  onClick={() => setAutomationSymbols('BTCUSD')}
                  disabled={automationActive}
                >
                  BTC Only
                </button>
                <button
                  className="preset-btn"
                  onClick={() => setAutomationSymbols('BTCUSD,ETHUSD')}
                  disabled={automationActive}
                >
                  Top 2
                </button>
                <button
                  className="preset-btn"
                  onClick={() => setAutomationSymbols('BTCUSD,ETHUSD,XRPUSD,ADAUSD,SOLUSD')}
                  disabled={automationActive}
                >
                  Top 5
                </button>
                <button
                  className="preset-btn"
                  onClick={() => setAutomationSymbols('WLDUSD')}
                  disabled={automationActive}
                  title="Worldcoin Token - WLD"
                >
                  🌍 Worldcoin
                </button>
              </div>

              {/* Capital Amount Input with Presets */}
              <div className="form-group" style={{ marginTop: '1.5rem' }}>
                <label>Capital per Symbol (USD)</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={capitalAmount}
                    onChange={(e) => setCapitalAmount(e.target.value)}
                    placeholder="1000"
                    className="input"
                    disabled={automationActive}
                    min="10"
                    step="10"
                    style={{ flex: 1 }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {[100, 500, 1000, 5000, 10000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setCapitalAmount(amount)}
                        className="preset-btn"
                        disabled={automationActive}
                        style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                      >
                        ${amount.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#a0a0a0', marginTop: '0.5rem' }}>
                  Amount to allocate per trading symbol. Bot will use 75% of this for each position.
                </p>
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label>Symbols (comma-separated)</label>
                  <input
                    value={automationSymbols}
                    onChange={(e) => setAutomationSymbols(e.target.value)}
                    placeholder="BTCUSD,ETHUSD,XRPUSD"
                    className="input"
                    disabled={automationActive}
                  />
                </div>
                <div className="form-group">
                  <label>Check Interval (ms)</label>
                  <input
                    type="number"
                    value={checkInterval}
                    onChange={(e) => setCheckInterval(e.target.value)}
                    className="input"
                    disabled={automationActive}
                  />
                </div>
              </div>

              <div className="button-group">
                {!automationActive ? (
                  <button className="btn-primary large" onClick={startAutomation} disabled={loading}>
                    {loading ? 'Starting...' : '▶️ Start Automation'}
                  </button>
                ) : (
                  <button className="btn-danger large" onClick={stopAutomation} disabled={loading}>
                    {loading ? 'Stopping...' : '⏹️ Stop Automation'}
                  </button>
                )}
              </div>

              <div className={`status-card ${automationActive ? 'active' : ''}`}>
                <div className="status-item">
                  <span className="status-label">Status</span>
                  <span className={`status-value ${automationActive ? 'active' : ''}`}>
                    {automationActive ? '🟢 ACTIVE' : '⚫ INACTIVE'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-label">Mode</span>
                  <span className={`status-value ${tradingMode === 'live' ? 'live-mode' : ''}`}>
                    {tradingMode === 'paper' ? '📄 PAPER' : '🔴 LIVE'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-label">Capital</span>
                  <span className="status-value">${parseFloat(capitalAmount).toLocaleString()}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">Symbols</span>
                  <span className="status-value">{automationSymbols}</span>
                </div>
              </div>

              {error && <div className="alert-error">{error}</div>}
            </div>
          </div>
        )}

        {/* Portfolio Tab */}
        {activeTab === 'portfolio' && (
          <div className="portfolio-section">
            {portfolio && (
              <div className="card">
                <h2>Portfolio Overview</h2>
                {portfolio.source === 'kraken' && (
                  <div className="info-box" style={{ marginBottom: '1.5rem' }}>
                    <span style={{ color: 'var(--success)' }}>✓ Connected to Kraken</span> - Real-time balances from your account
                  </div>
                )}
                {portfolio.message && !portfolio.positions?.length && (
                  <div className="info-box" style={{ marginBottom: '1.5rem' }}>
                    {portfolio.message}
                  </div>
                )}

                {portfolio.source === 'local' && (
                  <div className="portfolio-stats">
                    <div className="stat-card">
                      <span className="stat-label">Total Value</span>
                      <span className="stat-value">${portfolio.totalValue?.toFixed(2)}</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Total P&L</span>
                      <span className={`stat-value ${portfolio.totalPnl >= 0 ? 'positive' : 'negative'}`}>
                        ${portfolio.totalPnl?.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {portfolio.positions && portfolio.positions.length > 0 && (
                  <div className="positions-table">
                    <h3>{portfolio.source === 'kraken' ? 'Account Assets' : 'Open Positions'}</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>{portfolio.source === 'kraken' ? 'Asset' : 'Symbol'}</th>
                          <th>Amount</th>
                          {portfolio.source === 'local' && (
                            <>
                              <th>Avg Price</th>
                              <th>Current</th>
                              <th>P&L</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {portfolio.positions.map((pos) => (
                          <tr key={pos.symbol || pos.asset}>
                            <td><strong>{pos.symbol || pos.asset}</strong></td>
                            <td>{portfolio.source === 'kraken'
                              ? parseFloat(pos.amount).toFixed(6)
                              : pos.quantity?.toFixed(4)}</td>
                            {portfolio.source === 'local' && (
                              <>
                                <td>${pos.avg_price?.toFixed(2)}</td>
                                <td>${pos.current_price?.toFixed(2)}</td>
                                <td className={pos.pnl >= 0 ? 'positive' : 'negative'}>
                                  ${pos.pnl?.toFixed(2)}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {(!portfolio.positions || portfolio.positions.length === 0) && (
                  <div className="alert-info" style={{ marginTop: '2rem' }}>
                    No assets to display. {portfolio.source === 'kraken' ? 'Your Kraken account appears to be empty.' : 'Execute trades to see your portfolio here.'}
                  </div>
                )}
              </div>
            )}

            {trades && trades.length > 0 && (
              <div className="card">
                <h3>Recent Trades</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Price</th>
                      <th>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade) => (
                      <tr key={trade.id}>
                        <td>{new Date(trade.timestamp).toLocaleTimeString()}</td>
                        <td>{trade.symbol}</td>
                        <td className={trade.side === 'buy' ? 'buy' : 'sell'}>
                          {trade.side.toUpperCase()}
                        </td>
                        <td>${trade.price.toFixed(2)}</td>
                        <td>{trade.quantity.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {error && <div className="alert-error">{error}</div>}
          </div>
        )}

        {/* Trade History Tab */}
        {activeTab === 'trades' && (
          <div className="trades-section">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2>Trade History</h2>
                <button className="btn-secondary" onClick={fetchTrades}>
                  Refresh
                </button>
              </div>

              {trades && trades.length > 0 ? (
                <div className="trades-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Date & Time</th>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Price</th>
                        <th>Quantity</th>
                        <th>Notional</th>
                        <th>Mode</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade) => (
                        <tr key={trade.id}>
                          <td>
                            <div style={{ fontSize: '0.9em' }}>
                              {new Date(trade.timestamp).toLocaleDateString()}<br/>
                              <span style={{ color: '#888' }}>{new Date(trade.timestamp).toLocaleTimeString()}</span>
                            </div>
                          </td>
                          <td><strong>{trade.symbol}</strong></td>
                          <td>
                            <span className={`signal-badge ${trade.side}`}>
                              {trade.side.toUpperCase()}
                            </span>
                          </td>
                          <td>${trade.price.toFixed(2)}</td>
                          <td>{trade.quantity.toFixed(6)}</td>
                          <td>${trade.notional.toFixed(2)}</td>
                          <td>
                            <span className={`mode-badge ${trade.mode}`}>
                              {trade.mode.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge ${trade.status}`}>
                              {trade.status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="alert-info">
                  {trades === null
                    ? 'Click "Refresh" to load trade history'
                    : 'No trades yet. Start automation or execute manual trades to see your history here.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Day Trading Tab */}
        {activeTab === 'daytrading' && (
          <div className="daytrading-section">
            <div className="card">
              <h2>⚡ Day Trading Simulator</h2>
              <p style={{ color: '#a0a0a0', marginBottom: '1.5rem' }}>
                Backtest day trading strategy on real market data from the last 24 hours
              </p>

              <div className="form-group">
                <label>Starting Capital (CAD)</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={simulationCapital}
                    onChange={(e) => setSimulationCapital(e.target.value)}
                    placeholder="100"
                    className="input"
                    min="10"
                    step="10"
                    style={{ flex: 1 }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {[50, 100, 500, 1000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setSimulationCapital(amount)}
                        className="preset-btn"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                      >
                        ${amount}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                className="btn-primary large"
                onClick={runSimulation}
                disabled={simulationLoading}
              >
                {simulationLoading ? '⏳ Running Simulation...' : '🎯 Run Simulation'}
              </button>

              {simulationResults && (
                <div style={{ marginTop: '2rem' }}>
                  <div style={{
                    background: simulationResults.summary?.profitable ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: `1px solid ${simulationResults.summary?.profitable ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    borderRadius: '8px',
                    padding: '1.5rem',
                    marginBottom: '1.5rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1.2rem' }}>
                        {simulationResults.summary?.profitable ? '✅ Profitable' : '❌ Unprofitable'}
                      </h3>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: simulationResults.summary?.profitable ? '#22c55e' : '#ef4444' }}>
                        {simulationResults.summary?.totalPnlPercent >= 0 ? '+' : ''}{simulationResults.summary?.totalPnlPercent?.toFixed(2)}%
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: '#a0a0a0' }}>Starting Capital</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>${simulationResults.summary?.startingCapital?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: '#a0a0a0' }}>Ending Capital</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>${simulationResults.summary?.endingCapital?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: '#a0a0a0' }}>Total P&L</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: '600', color: simulationResults.summary?.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                          {simulationResults.summary?.totalPnl >= 0 ? '+' : ''}${simulationResults.summary?.totalPnl?.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: '#a0a0a0' }}>Total Trades</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>{simulationResults.summary?.totalTrades}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: '#a0a0a0' }}>Win Rate</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>{simulationResults.summary?.winRate?.toFixed(1)}%</div>
                      </div>
                    </div>
                  </div>

                  {simulationResults.results && (
                    <div style={{ background: 'var(--dark-secondary)', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border)' }}>
                      <h3 style={{ marginTop: 0 }}>📊 Detailed Statistics</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', fontSize: '0.9rem' }}>
                        <div>
                          <div style={{ color: '#a0a0a0' }}>Winning Trades</div>
                          <div style={{ color: '#22c55e', fontWeight: '600' }}>✅ {simulationResults.results.winningTrades}</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0' }}>Losing Trades</div>
                          <div style={{ color: '#ef4444', fontWeight: '600' }}>❌ {simulationResults.results.losingTrades}</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0' }}>Avg Win</div>
                          <div style={{ color: '#22c55e', fontWeight: '600' }}>+{simulationResults.results.avgWin?.toFixed(2)}%</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0' }}>Avg Loss</div>
                          <div style={{ color: '#ef4444', fontWeight: '600' }}>{simulationResults.results.avgLoss?.toFixed(2)}%</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0' }}>Avg Hold Time</div>
                          <div style={{ fontWeight: '600' }}>{simulationResults.results.avgHoldTimeMinutes} min</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0' }}>Max Drawdown</div>
                          <div style={{ color: '#ef4444', fontWeight: '600' }}>{simulationResults.results.maxDrawdown?.toFixed(2)}%</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0' }}>Total Fees</div>
                          <div style={{ fontWeight: '600' }}>${simulationResults.results.totalFees?.toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0' }}>Total Slippage</div>
                          <div style={{ fontWeight: '600' }}>${simulationResults.results.totalSlippage?.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="card" style={{ marginTop: '2rem' }}>
              <h2>🎯 Strategy Control</h2>
              <p style={{ color: '#a0a0a0', marginBottom: '1.5rem' }}>
                Force your bot to use a specific strategy or enable auto-switching
              </p>

              {strategyStatus && (
                <div style={{
                  background: 'var(--dark-secondary)',
                  borderRadius: '8px',
                  padding: '1.5rem',
                  marginBottom: '1.5rem',
                  border: '1px solid var(--border)'
                }}>
                  <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Current Strategy Status</h3>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#a0a0a0' }}>Active Strategy:</span>
                      <span style={{ fontWeight: '600', textTransform: 'uppercase' }}>{strategyStatus.currentStrategy || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#a0a0a0' }}>Auto-Switching:</span>
                      <span style={{ fontWeight: '600', color: strategyStatus.config?.autoSwitch ? '#22c55e' : '#fbbf24' }}>
                        {strategyStatus.config?.autoSwitch ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    {strategyStatus.currentRegime && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#a0a0a0' }}>Market Regime:</span>
                          <span style={{ fontWeight: '600' }}>{strategyStatus.currentRegime.type}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#a0a0a0' }}>Confidence:</span>
                          <span style={{ fontWeight: '600' }}>{strategyStatus.currentRegime.confidence}%</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <button
                  className="btn-primary large"
                  onClick={() => forceStrategy('day-trading')}
                  disabled={strategyLoading}
                  style={{
                    background: strategyStatus?.currentStrategy === 'day-trading' ? 'rgba(107, 91, 149, 0.5)' : 'var(--primary)',
                    cursor: strategyLoading ? 'wait' : 'pointer'
                  }}
                >
                  {strategyLoading ? '⏳ Updating...' : '⚡ Force Day Trading Strategy'}
                </button>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  <button
                    className="btn-secondary"
                    onClick={() => forceStrategy('momentum')}
                    disabled={strategyLoading}
                  >
                    📈 Momentum
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => forceStrategy('mean-reversion')}
                    disabled={strategyLoading}
                  >
                    🔄 Mean Reversion
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => forceStrategy('grid-trading')}
                    disabled={strategyLoading}
                  >
                    📊 Grid Trading
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => forceStrategy('multi-indicator')}
                    disabled={strategyLoading}
                  >
                    🎯 Multi-Indicator
                  </button>
                </div>

                <button
                  className="btn-secondary large"
                  onClick={() => forceStrategy('auto')}
                  disabled={strategyLoading}
                  style={{ marginTop: '1rem' }}
                >
                  🤖 Re-enable Auto-Switching
                </button>
              </div>

              <div className="info-box" style={{ marginTop: '1.5rem' }}>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>
                  <strong>💡 Tip:</strong> Run a simulation first to see if day trading is profitable.
                  If you get good results (65%+ win rate, positive P&L), force the day trading strategy above.
                </p>
              </div>
            </div>

            {error && <div className="alert-error" style={{ marginTop: '1.5rem' }}>{error}</div>}
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="analytics-section">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2>📊 Performance Analytics</h2>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {['all', '7d', '30d', '90d'].map(range => (
                    <button
                      key={range}
                      onClick={() => { setAnalyticsTimeRange(range); setTimeout(fetchAnalytics, 100); }}
                      className="btn-secondary"
                      disabled={analyticsLoading}
                      style={{
                        background: analyticsTimeRange === range ? 'rgba(107, 91, 149, 0.3)' : 'transparent',
                        border: `1px solid ${analyticsTimeRange === range ? '#6b5b95' : 'rgba(255,255,255,0.2)'}`,
                        padding: '0.5rem 1rem',
                        fontSize: '0.85rem'
                      }}
                    >
                      {range === 'all' ? 'All Time' : range.toUpperCase()}
                    </button>
                  ))}
                  <button
                    className="btn-primary"
                    onClick={fetchAnalytics}
                    disabled={analyticsLoading}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                  >
                    {analyticsLoading ? '⏳' : '🔄 Refresh'}
                  </button>
                </div>
              </div>

              {analyticsLoading && (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#a0a0a0' }}>
                  <p>Loading analytics...</p>
                </div>
              )}

              {!analyticsLoading && analytics && analytics.overall && (
                <>
                  {/* Overall Performance Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                    <div style={{ background: 'var(--dark-secondary)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.85rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>Total P&L</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: analytics.overall.totalPnL >= 0 ? '#22c55e' : '#ef4444' }}>
                        {analytics.overall.totalPnL >= 0 ? '+' : ''}${analytics.overall.totalPnL?.toFixed(2)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#a0a0a0', marginTop: '0.3rem' }}>
                        {analytics.overall.totalPnLPercent >= 0 ? '+' : ''}{analytics.overall.totalPnLPercent}% ROI
                      </div>
                    </div>

                    <div style={{ background: 'var(--dark-secondary)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.85rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>Win Rate</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                        {analytics.overall.winRate}%
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#a0a0a0', marginTop: '0.3rem' }}>
                        {analytics.overall.winningTrades} wins / {analytics.overall.losingTrades} losses
                      </div>
                    </div>

                    <div style={{ background: 'var(--dark-secondary)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.85rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>Total Trades</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                        {analytics.overall.totalTrades}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#a0a0a0', marginTop: '0.3rem' }}>
                        Profit Factor: {analytics.overall.profitFactor}
                      </div>
                    </div>

                    <div style={{ background: 'var(--dark-secondary)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.85rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>Sharpe Ratio</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                        {analytics.overall.sharpeRatio}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#a0a0a0', marginTop: '0.3rem' }}>
                        Risk-adjusted returns
                      </div>
                    </div>

                    <div style={{ background: 'var(--dark-secondary)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.85rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>Max Drawdown</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#ef4444' }}>
                        {analytics.overall.maxDrawdownPercent}%
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#a0a0a0', marginTop: '0.3rem' }}>
                        ${analytics.overall.maxDrawdown?.toFixed(2)} peak loss
                      </div>
                    </div>

                    <div style={{ background: 'var(--dark-secondary)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.85rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>Avg Hold Time</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                        {analytics.overall.avgHoldTimeFormatted || 'N/A'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#a0a0a0', marginTop: '0.3rem' }}>
                        Per position
                      </div>
                    </div>
                  </div>

                  {/* Performance by Strategy */}
                  {analytics.byStrategy && Object.keys(analytics.byStrategy).length > 0 && (
                    <div style={{ marginBottom: '2rem' }}>
                      <h3 style={{ marginBottom: '1rem' }}>Performance by Strategy</h3>
                      <div style={{ background: 'var(--dark-secondary)', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border)' }}>
                        <table style={{ width: '100%', fontSize: '0.9rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '0.75rem' }}>Strategy</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>Trades</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>Win Rate</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>Total P&L</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>ROI</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(analytics.byStrategy).map(([strategy, metrics]) => (
                              <tr key={strategy} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <td style={{ padding: '0.75rem', textTransform: 'capitalize' }}>{strategy}</td>
                                <td style={{ textAlign: 'right', padding: '0.75rem' }}>{metrics.totalTrades}</td>
                                <td style={{ textAlign: 'right', padding: '0.75rem' }}>{metrics.winRate}%</td>
                                <td style={{ textAlign: 'right', padding: '0.75rem', color: metrics.totalPnL >= 0 ? '#22c55e' : '#ef4444' }}>
                                  {metrics.totalPnL >= 0 ? '+' : ''}${metrics.totalPnL}
                                </td>
                                <td style={{ textAlign: 'right', padding: '0.75rem', color: metrics.roi >= 0 ? '#22c55e' : '#ef4444' }}>
                                  {metrics.roi >= 0 ? '+' : ''}{metrics.roi}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Performance by Symbol */}
                  {analytics.bySymbol && Object.keys(analytics.bySymbol).length > 0 && (
                    <div style={{ marginBottom: '2rem' }}>
                      <h3 style={{ marginBottom: '1rem' }}>Performance by Symbol</h3>
                      <div style={{ background: 'var(--dark-secondary)', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border)' }}>
                        <table style={{ width: '100%', fontSize: '0.9rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '0.75rem' }}>Symbol</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>Trades</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>Win Rate</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>Total P&L</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>Avg Win</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem' }}>Avg Loss</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(analytics.bySymbol).map(([symbol, metrics]) => (
                              <tr key={symbol} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{symbol}</td>
                                <td style={{ textAlign: 'right', padding: '0.75rem' }}>{metrics.totalTrades}</td>
                                <td style={{ textAlign: 'right', padding: '0.75rem' }}>{metrics.winRate}%</td>
                                <td style={{ textAlign: 'right', padding: '0.75rem', color: metrics.totalPnL >= 0 ? '#22c55e' : '#ef4444' }}>
                                  {metrics.totalPnL >= 0 ? '+' : ''}${metrics.totalPnL}
                                </td>
                                <td style={{ textAlign: 'right', padding: '0.75rem', color: '#22c55e' }}>
                                  +${metrics.avgWin}
                                </td>
                                <td style={{ textAlign: 'right', padding: '0.75rem', color: '#ef4444' }}>
                                  -${Math.abs(metrics.avgLoss)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Detailed Metrics */}
                  <div>
                    <h3 style={{ marginBottom: '1rem' }}>Detailed Metrics</h3>
                    <div style={{ background: 'var(--dark-secondary)', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', fontSize: '0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#a0a0a0' }}>Average Win:</span>
                          <span style={{ color: '#22c55e', fontWeight: '600' }}>+${analytics.overall.avgWin}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#a0a0a0' }}>Average Loss:</span>
                          <span style={{ color: '#ef4444', fontWeight: '600' }}>-${Math.abs(analytics.overall.avgLoss)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#a0a0a0' }}>Largest Win:</span>
                          <span style={{ color: '#22c55e', fontWeight: '600' }}>+${analytics.overall.largestWin}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#a0a0a0' }}>Largest Loss:</span>
                          <span style={{ color: '#ef4444', fontWeight: '600' }}>${analytics.overall.largestLoss}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#a0a0a0' }}>Total Fees:</span>
                          <span style={{ fontWeight: '600' }}>${analytics.overall.totalFees}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#a0a0a0' }}>Net Profit:</span>
                          <span style={{ color: analytics.overall.netProfit >= 0 ? '#22c55e' : '#ef4444', fontWeight: '600' }}>
                            {analytics.overall.netProfit >= 0 ? '+' : ''}${analytics.overall.netProfit}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {!analyticsLoading && analytics && analytics.overall && analytics.overall.totalTrades === 0 && (
                <div className="alert-info" style={{ marginTop: '2rem' }}>
                  No trades to analyze yet. Start trading to see your performance metrics here.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Risk Management Tab */}
        {activeTab === 'risk' && (
          <div className="risk-dashboard">
            <h2>Risk Management Dashboard</h2>

            <div style={{ marginBottom: '1rem' }}>
              <button onClick={fetchRiskSummary} disabled={riskLoading} className="btn-secondary">
                {riskLoading ? 'Loading...' : '🔄 Refresh Risk Summary'}
              </button>
            </div>

            {riskLoading && <div className="loading">Loading risk data...</div>}

            {!riskLoading && riskSummary && (
              <>
                {/* Risk Alerts */}
                {riskSummary.alerts && riskSummary.alerts.length > 0 && (
                  <div style={{ marginBottom: '2rem' }}>
                    <h3>⚠️ Active Alerts</h3>
                    {riskSummary.alerts.map((alert, idx) => (
                      <div
                        key={idx}
                        className={alert.severity === 'critical' ? 'alert-error' : 'alert-warning'}
                        style={{ marginBottom: '0.5rem', padding: '1rem', borderRadius: '8px' }}
                      >
                        <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{alert.message}</div>
                        <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Action: {alert.action}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Overall Risk Level */}
                <div className="metric-card" style={{
                  marginBottom: '2rem',
                  padding: '1.5rem',
                  borderLeft: `4px solid ${riskSummary.overallRiskLevel === 'HIGH' ? '#dc2626' : riskSummary.overallRiskLevel === 'MEDIUM' ? '#f59e0b' : '#10b981'}`
                }}>
                  <h3 style={{ margin: '0 0 0.5rem 0' }}>Overall Risk Level</h3>
                  <div style={{
                    fontSize: '2rem',
                    fontWeight: 'bold',
                    color: riskSummary.overallRiskLevel === 'HIGH' ? '#dc2626' : riskSummary.overallRiskLevel === 'MEDIUM' ? '#f59e0b' : '#10b981'
                  }}>
                    {riskSummary.overallRiskLevel}
                  </div>
                </div>

                {/* Circuit Breaker Status */}
                <div className="section-card" style={{ marginBottom: '2rem' }}>
                  <h3>🔒 Circuit Breaker Status</h3>

                  <div className="info-box" style={{
                    backgroundColor: riskSummary.circuitBreaker?.halted ? '#dc2626' : '#10b981',
                    color: 'white',
                    padding: '1rem',
                    borderRadius: '8px',
                    marginBottom: '1rem'
                  }}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                      {riskSummary.circuitBreaker?.halted ? '🛑 TRADING HALTED' : '✅ Trading Active'}
                    </div>
                    {riskSummary.circuitBreaker?.halted && riskSummary.circuitBreaker?.reason && (
                      <div style={{ marginTop: '0.5rem', opacity: 0.95 }}>{riskSummary.circuitBreaker.reason}</div>
                    )}
                    {riskSummary.circuitBreaker?.remainingCooldown && (
                      <div style={{ marginTop: '0.5rem', opacity: 0.95 }}>
                        Cooldown remaining: {riskSummary.circuitBreaker.remainingCooldown} minutes
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Consecutive Losses</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: riskSummary.circuitBreaker?.consecutiveLosses >= 2 ? '#f59e0b' : 'inherit' }}>
                        {riskSummary.circuitBreaker?.consecutiveLosses || 0}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '1rem' }}>
                    <h4 style={{ marginBottom: '0.5rem' }}>Circuit Breaker Configuration</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                          Max Consecutive Losses
                        </label>
                        <input
                          type="number"
                          value={circuitBreakerConfig.maxConsecutiveLosses}
                          onChange={(e) => setCircuitBreakerConfig({ ...circuitBreakerConfig, maxConsecutiveLosses: parseInt(e.target.value) })}
                          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                          min="1"
                          max="10"
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                          Cooldown (minutes)
                        </label>
                        <input
                          type="number"
                          value={circuitBreakerConfig.cooldownMinutes}
                          onChange={(e) => setCircuitBreakerConfig({ ...circuitBreakerConfig, cooldownMinutes: parseInt(e.target.value) })}
                          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                          min="5"
                          max="1440"
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                      <button onClick={updateCircuitBreakerConfig} className="btn-primary" disabled={riskLoading}>
                        Update Configuration
                      </button>
                      {riskSummary.circuitBreaker?.halted && (
                        <button onClick={resetCircuitBreakerManual} className="btn-danger" disabled={riskLoading}>
                          🔓 Manual Reset
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Value at Risk */}
                <div className="section-card" style={{ marginBottom: '2rem' }}>
                  <h3>📊 Value at Risk (VaR)</h3>

                  {riskSummary.valueAtRisk?.var95?.message ? (
                    <div className="alert-info">{riskSummary.valueAtRisk.var95.message}</div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div className="metric-card">
                          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Daily VaR (95%)</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>
                            ${riskSummary.valueAtRisk?.var95?.dailyVaRDollar || 0}
                          </div>
                          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                            {riskSummary.valueAtRisk?.var95?.dailyVaR || 0}% of portfolio
                          </div>
                        </div>

                        <div className="metric-card">
                          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Weekly VaR (95%)</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>
                            ${riskSummary.valueAtRisk?.var95?.weeklyVaRDollar || 0}
                          </div>
                          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                            {riskSummary.valueAtRisk?.var95?.weeklyVaR || 0}% of portfolio
                          </div>
                        </div>

                        <div className="metric-card">
                          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Daily VaR (99%)</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#991b1b' }}>
                            ${riskSummary.valueAtRisk?.var99?.dailyVaRDollar || 0}
                          </div>
                          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                            {riskSummary.valueAtRisk?.var99?.dailyVaR || 0}% of portfolio
                          </div>
                        </div>
                      </div>

                      {riskSummary.valueAtRisk?.var95?.interpretation && (
                        <div className="info-box" style={{ fontSize: '0.9rem' }}>
                          ℹ️ {riskSummary.valueAtRisk.var95.interpretation}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Portfolio Exposure */}
                <div className="section-card" style={{ marginBottom: '2rem' }}>
                  <h3>💼 Portfolio Exposure</h3>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    <div className="metric-card">
                      <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Total Exposure</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                        {riskSummary.exposure?.totalExposurePercent || 0}%
                      </div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                        ${riskSummary.exposure?.totalExposure || 0}
                      </div>
                    </div>

                    <div className="metric-card">
                      <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Status</div>
                      <div style={{
                        fontSize: '1.2rem',
                        fontWeight: 'bold',
                        color: riskSummary.exposure?.withinLimits ? '#10b981' : '#dc2626'
                      }}>
                        {riskSummary.exposure?.withinLimits ? '✅ Within Limits' : '⚠️ Exceeded'}
                      </div>
                    </div>
                  </div>

                  {riskSummary.exposure?.exposureBySymbol && Object.keys(riskSummary.exposure.exposureBySymbol).length > 0 && (
                    <div style={{ marginTop: '1rem' }}>
                      <h4 style={{ marginBottom: '0.5rem' }}>Exposure by Symbol</h4>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Exposure</th>
                            <th>% of Portfolio</th>
                            <th>Trades</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(riskSummary.exposure.exposureBySymbol).map(([symbol, data]) => (
                            <tr key={symbol}>
                              <td>{symbol}</td>
                              <td>${data.exposure?.toFixed(2) || 0}</td>
                              <td style={{
                                color: (data.exposurePercent || 0) > (riskSummary.limits?.maxExposurePerSymbol * 100) ? '#dc2626' : 'inherit'
                              }}>
                                {((data.exposurePercent || 0) * 100).toFixed(1)}%
                              </td>
                              <td>{data.trades || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Portfolio Limits Configuration */}
                <div className="section-card" style={{ marginBottom: '2rem' }}>
                  <h3>⚙️ Portfolio Limits Configuration</h3>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                        Max Exposure Per Symbol (%)
                      </label>
                      <input
                        type="number"
                        value={(portfolioLimits.maxExposurePerSymbol * 100).toFixed(0)}
                        onChange={(e) => setPortfolioLimits({ ...portfolioLimits, maxExposurePerSymbol: parseFloat(e.target.value) / 100 })}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                        min="5"
                        max="100"
                        step="5"
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                        Max Total Exposure (%)
                      </label>
                      <input
                        type="number"
                        value={(portfolioLimits.maxTotalExposure * 100).toFixed(0)}
                        onChange={(e) => setPortfolioLimits({ ...portfolioLimits, maxTotalExposure: parseFloat(e.target.value) / 100 })}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                        min="10"
                        max="100"
                        step="5"
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                        Max Drawdown (%)
                      </label>
                      <input
                        type="number"
                        value={(portfolioLimits.maxDrawdownPercent * 100).toFixed(0)}
                        onChange={(e) => setPortfolioLimits({ ...portfolioLimits, maxDrawdownPercent: parseFloat(e.target.value) / 100 })}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                        min="5"
                        max="50"
                        step="5"
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                        Max Daily Loss (%)
                      </label>
                      <input
                        type="number"
                        value={(portfolioLimits.maxDailyLossPercent * 100).toFixed(0)}
                        onChange={(e) => setPortfolioLimits({ ...portfolioLimits, maxDailyLossPercent: parseFloat(e.target.value) / 100 })}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                        min="1"
                        max="50"
                        step="1"
                      />
                    </div>
                  </div>

                  <button onClick={updatePortfolioLimitsConfig} className="btn-primary" style={{ marginTop: '1rem' }} disabled={riskLoading}>
                    Update Limits
                  </button>
                </div>

                {/* Drawdown & Kelly Position Sizing */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                  {/* Current Drawdown */}
                  <div className="section-card">
                    <h3>📉 Current Drawdown</h3>
                    <div className="metric-card">
                      <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Drawdown from Peak</div>
                      <div style={{
                        fontSize: '1.8rem',
                        fontWeight: 'bold',
                        color: (riskSummary.drawdown?.currentDrawdownPercent || 0) > 10 ? '#dc2626' : '#f59e0b'
                      }}>
                        {riskSummary.drawdown?.currentDrawdownPercent || 0}%
                      </div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.5rem' }}>
                        ${riskSummary.drawdown?.currentDrawdown || 0} loss from peak
                      </div>
                    </div>
                    <div style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
                      <div>Peak: ${riskSummary.drawdown?.peak || 0}</div>
                      <div>Current: ${riskSummary.drawdown?.currentValue || 0}</div>
                      {riskSummary.drawdown?.isAtPeak && (
                        <div style={{ color: '#10b981', fontWeight: 'bold', marginTop: '0.5rem' }}>
                          🎉 At all-time high!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Kelly Criterion Position Sizing */}
                  <div className="section-card">
                    <h3>🎯 Kelly Position Sizing</h3>
                    {riskSummary.kellyPositionSize?.message ? (
                      <div className="alert-info">{riskSummary.kellyPositionSize.message}</div>
                    ) : (
                      <>
                        <div className="metric-card">
                          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Optimal Position Size</div>
                          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#3b82f6' }}>
                            ${riskSummary.kellyPositionSize?.positionSize || 0}
                          </div>
                          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                            {riskSummary.kellyPositionSize?.kellyPercent || 0}% of portfolio
                          </div>
                        </div>
                        <div style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
                          <div>Win Rate: {riskSummary.kellyPositionSize?.winRate || 0}%</div>
                          <div>Win/Loss Ratio: {riskSummary.kellyPositionSize?.winLossRatio || 0}:1</div>
                          <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: 'var(--dark-secondary)', borderRadius: '4px' }}>
                            {riskSummary.kellyPositionSize?.recommendation || ''}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {!riskLoading && !riskSummary && (
              <div className="alert-info">
                Click "Refresh Risk Summary" to load risk management data.
              </div>
            )}
          </div>
        )}

        {/* Backtesting Tab */}
        {activeTab === 'backtest' && (
          <div className="backtest-dashboard">
            <h2>Strategy Backtesting</h2>
            <p style={{ opacity: 0.7, marginBottom: '2rem' }}>Test your trading strategies against historical data before risking real money</p>

            {/* Configuration Section */}
            <div className="section-card" style={{ marginBottom: '2rem' }}>
              <h3>Backtest Configuration</h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Symbol</label>
                  <select
                    value={backtestConfig.symbol}
                    onChange={(e) => setBacktestConfig({ ...backtestConfig, symbol: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--dark-secondary)', color: 'inherit' }}
                  >
                    <option value="BTCUSD">BTC/USD</option>
                    <option value="ETHUSD">ETH/USD</option>
                    <option value="SOLUSD">SOL/USD</option>
                    <option value="XRPUSD">XRP/USD</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Strategy</label>
                  <select
                    value={backtestConfig.strategy}
                    onChange={(e) => setBacktestConfig({ ...backtestConfig, strategy: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--dark-secondary)', color: 'inherit' }}
                  >
                    {availableStrategies.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                    {availableStrategies.length === 0 && (
                      <>
                        <option value="momentum">Momentum</option>
                        <option value="sma-crossover">SMA Crossover</option>
                        <option value="mean-reversion">Mean Reversion</option>
                        <option value="multi-indicator">Multi-Indicator</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Time Period (Days)</label>
                  <select
                    value={backtestConfig.days}
                    onChange={(e) => setBacktestConfig({ ...backtestConfig, days: parseInt(e.target.value) })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--dark-secondary)', color: 'inherit' }}
                  >
                    <option value="7">7 Days</option>
                    <option value="14">14 Days</option>
                    <option value="30">30 Days</option>
                    <option value="60">60 Days</option>
                    <option value="90">90 Days</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Timeframe</label>
                  <select
                    value={backtestConfig.interval}
                    onChange={(e) => setBacktestConfig({ ...backtestConfig, interval: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--dark-secondary)', color: 'inherit' }}
                  >
                    <option value="15m">15 Minutes</option>
                    <option value="1h">1 Hour</option>
                    <option value="4h">4 Hours</option>
                    <option value="1d">1 Day</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Initial Capital ($)</label>
                  <input
                    type="number"
                    value={backtestConfig.initialCapital}
                    onChange={(e) => setBacktestConfig({ ...backtestConfig, initialCapital: parseInt(e.target.value) })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--dark-secondary)', color: 'inherit' }}
                    min="100"
                    step="100"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Position Size ($)</label>
                  <input
                    type="number"
                    value={backtestConfig.positionSize}
                    onChange={(e) => setBacktestConfig({ ...backtestConfig, positionSize: parseInt(e.target.value) })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--dark-secondary)', color: 'inherit' }}
                    min="10"
                    step="10"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button onClick={runBacktest} disabled={backtestLoading} className="btn-primary">
                  {backtestLoading ? 'Running Backtest...' : '🚀 Run Backtest'}
                </button>
                <button onClick={runStrategyComparison} disabled={backtestLoading} className="btn-secondary">
                  {backtestLoading ? 'Comparing...' : '📊 Compare All Strategies'}
                </button>
              </div>

              {availableStrategies.length > 0 && (
                <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'var(--dark-secondary)', borderRadius: '8px' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0' }}>Strategy Descriptions</h4>
                  {availableStrategies.map(s => (
                    <div key={s.id} style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      <strong>{s.name}:</strong> {s.description}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Loading State */}
            {backtestLoading && (
              <div className="loading" style={{ textAlign: 'center', padding: '2rem' }}>
                <div style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Running backtest...</div>
                <div style={{ opacity: 0.7 }}>This may take a few moments as we fetch and analyze historical data</div>
              </div>
            )}

            {/* Backtest Results */}
            {!backtestLoading && backtestResult && (
              <div>
                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                  <div className="metric-card">
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Total Return</div>
                    <div style={{
                      fontSize: '1.8rem',
                      fontWeight: 'bold',
                      color: backtestResult.summary?.totalReturn >= 0 ? '#10b981' : '#dc2626'
                    }}>
                      {backtestResult.summary?.totalReturn >= 0 ? '+' : ''}${backtestResult.summary?.totalReturn || 0}
                    </div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                      {backtestResult.summary?.totalReturnPercent >= 0 ? '+' : ''}{backtestResult.summary?.totalReturnPercent || 0}%
                    </div>
                  </div>

                  <div className="metric-card">
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Annualized Return</div>
                    <div style={{
                      fontSize: '1.8rem',
                      fontWeight: 'bold',
                      color: backtestResult.summary?.annualizedReturn >= 0 ? '#10b981' : '#dc2626'
                    }}>
                      {backtestResult.summary?.annualizedReturn >= 0 ? '+' : ''}{backtestResult.summary?.annualizedReturn || 0}%
                    </div>
                  </div>

                  <div className="metric-card">
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Win Rate</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#3b82f6' }}>
                      {backtestResult.metrics?.winRate || 0}%
                    </div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                      {backtestResult.metrics?.winningTrades || 0}W / {backtestResult.metrics?.losingTrades || 0}L
                    </div>
                  </div>

                  <div className="metric-card">
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Total Trades</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                      {backtestResult.summary?.totalTrades || 0}
                    </div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                      {backtestResult.summary?.tradesPerDay || 0} per day
                    </div>
                  </div>

                  <div className="metric-card">
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Sharpe Ratio</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#8b5cf6' }}>
                      {backtestResult.metrics?.sharpeRatio || 0}
                    </div>
                  </div>

                  <div className="metric-card">
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.25rem' }}>Max Drawdown</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#dc2626' }}>
                      {backtestResult.metrics?.maxDrawdownPercent || 0}%
                    </div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                      ${backtestResult.metrics?.maxDrawdown || 0}
                    </div>
                  </div>
                </div>

                {/* Detailed Metrics */}
                <div className="section-card" style={{ marginBottom: '2rem' }}>
                  <h3>Detailed Performance Metrics</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Initial Capital</div>
                      <div style={{ fontWeight: 'bold' }}>${backtestResult.summary?.initialCapital || 0}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Final Capital</div>
                      <div style={{ fontWeight: 'bold' }}>${backtestResult.summary?.finalCapital || 0}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Profit Factor</div>
                      <div style={{ fontWeight: 'bold' }}>{backtestResult.metrics?.profitFactor || 0}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Avg Win</div>
                      <div style={{ fontWeight: 'bold', color: '#10b981' }}>${backtestResult.metrics?.avgWin || 0}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Avg Loss</div>
                      <div style={{ fontWeight: 'bold', color: '#dc2626' }}>${backtestResult.metrics?.avgLoss || 0}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Total Fees</div>
                      <div style={{ fontWeight: 'bold' }}>${backtestResult.metrics?.totalFees || 0}</div>
                    </div>
                  </div>
                </div>

                {/* Trade History */}
                {backtestResult.trades && backtestResult.trades.length > 0 && (
                  <div className="section-card">
                    <h3>Trade History ({backtestResult.trades.length} trades)</h3>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Date</th>
                            <th>Side</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>Qty</th>
                            <th>P&L</th>
                            <th>P&L %</th>
                            <th>Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backtestResult.trades.slice(0, 50).map(trade => (
                            <tr key={trade.id}>
                              <td>{trade.id}</td>
                              <td>{new Date(trade.entry_time).toLocaleDateString()}</td>
                              <td>
                                <span style={{
                                  color: trade.side === 'buy' ? '#10b981' : '#dc2626',
                                  fontWeight: 'bold'
                                }}>
                                  {trade.side.toUpperCase()}
                                </span>
                              </td>
                              <td>${trade.entry_price?.toFixed(2) || 0}</td>
                              <td>${trade.exit_price?.toFixed(2) || 0}</td>
                              <td>{trade.quantity?.toFixed(6) || 0}</td>
                              <td style={{ color: trade.pnl >= 0 ? '#10b981' : '#dc2626', fontWeight: 'bold' }}>
                                {trade.pnl >= 0 ? '+' : ''}${trade.pnl?.toFixed(2) || 0}
                              </td>
                              <td style={{ color: trade.pnl_percent >= 0 ? '#10b981' : '#dc2626' }}>
                                {trade.pnl_percent >= 0 ? '+' : ''}{trade.pnl_percent?.toFixed(2) || 0}%
                              </td>
                              <td>{Math.round(trade.duration / 1000 / 60)} min</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {backtestResult.trades.length > 50 && (
                        <div style={{ textAlign: 'center', marginTop: '1rem', opacity: 0.7 }}>
                          Showing first 50 of {backtestResult.trades.length} trades
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Strategy Comparison Results */}
            {!backtestLoading && compareResults && (
              <div className="section-card">
                <h3>Strategy Comparison Results</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Strategy</th>
                        <th>Total Return</th>
                        <th>Return %</th>
                        <th>Annualized</th>
                        <th>Trades</th>
                        <th>Win Rate</th>
                        <th>Sharpe</th>
                        <th>Max DD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareResults.comparison?.map((result, idx) => (
                        <tr key={result.strategy}>
                          <td style={{ fontWeight: 'bold' }}>{idx + 1}</td>
                          <td style={{ fontWeight: 'bold' }}>{result.strategy}</td>
                          <td style={{
                            color: result.metrics?.totalReturn >= 0 ? '#10b981' : '#dc2626',
                            fontWeight: 'bold'
                          }}>
                            ${result.metrics?.totalReturn || 0}
                          </td>
                          <td style={{ color: result.metrics?.totalReturnPercent >= 0 ? '#10b981' : '#dc2626' }}>
                            {result.metrics?.totalReturnPercent >= 0 ? '+' : ''}{result.metrics?.totalReturnPercent || 0}%
                          </td>
                          <td>{result.metrics?.annualizedReturn || 0}%</td>
                          <td>{result.metrics?.totalTrades || 0}</td>
                          <td>{result.performance?.winRate || 0}%</td>
                          <td>{result.performance?.sharpeRatio || 0}</td>
                          <td style={{ color: '#dc2626' }}>{result.performance?.maxDrawdownPercent || 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="alert-info" style={{ marginTop: '1rem' }}>
                  💡 The best strategy shows the highest total return with acceptable risk (Sharpe ratio and drawdown)
                </div>
              </div>
            )}

            {!backtestLoading && !backtestResult && !compareResults && (
              <div className="alert-info" style={{ textAlign: 'center', padding: '2rem' }}>
                Configure your backtest parameters above and click "Run Backtest" to test your strategy against historical data
              </div>
            )}
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="notifications-dashboard">
            <h2>Notifications & Alerts</h2>
            <p style={{ opacity: 0.7, marginBottom: '2rem' }}>Manage your trading notifications and alert preferences</p>

            {/* Notification Preferences */}
            <div className="section-card" style={{ marginBottom: '2rem' }}>
              <h3>Notification Settings</h3>

              {notificationPreferences && (
                <>
                  {/* Email Notifications */}
                  <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: 'var(--dark-secondary)', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 1rem 0' }}>📧 Email Notifications</h4>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={notificationPreferences.email?.enabled || false}
                          onChange={(e) => updateNotificationPreferences({
                            email: { ...notificationPreferences.email, enabled: e.target.checked }
                          })}
                        />
                        <span>Enable email notifications</span>
                      </label>
                    </div>

                    {notificationPreferences.email?.enabled && (
                      <>
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Email Address</label>
                          <input
                            type="email"
                            value={notificationPreferences.email?.address || ''}
                            onChange={(e) => setNotificationPreferences({
                              ...notificationPreferences,
                              email: { ...notificationPreferences.email, address: e.target.value }
                            })}
                            onBlur={() => updateNotificationPreferences(notificationPreferences)}
                            placeholder="your@email.com"
                            style={{ width: '100%', maxWidth: '400px', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--dark-secondary)', color: 'inherit' }}
                          />
                        </div>

                        <div className="alert-info" style={{ fontSize: '0.9rem' }}>
                          ℹ️ Email notifications are logged to console and file. To enable real email delivery, configure SMTP settings in the backend.
                        </div>
                      </>
                    )}
                  </div>

                  {/* In-App Notifications */}
                  <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'var(--dark-secondary)', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 1rem 0' }}>🔔 In-App Notifications</h4>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={notificationPreferences.inApp?.enabled || false}
                        onChange={(e) => updateNotificationPreferences({
                          inApp: { ...notificationPreferences.inApp, enabled: e.target.checked }
                        })}
                      />
                      <span>Enable in-app notifications</span>
                    </label>
                  </div>

                  {/* Notification Types */}
                  {notificationTypes.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h4 style={{ marginBottom: '1rem' }}>Notification Types</h4>
                      <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {notificationTypes.map(type => (
                          <div key={type.id} style={{ padding: '1rem', backgroundColor: 'var(--dark-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div>
                                <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                                  {type.icon} {type.name}
                                </div>
                                <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>{type.description}</div>
                              </div>
                              <div style={{ display: 'flex', gap: '1rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={notificationPreferences.email?.types?.[type.id] || false}
                                    onChange={(e) => updateNotificationPreferences({
                                      email: {
                                        ...notificationPreferences.email,
                                        types: { ...notificationPreferences.email.types, [type.id]: e.target.checked }
                                      }
                                    })}
                                    disabled={!notificationPreferences.email?.enabled}
                                  />
                                  <span style={{ fontSize: '0.85rem' }}>Email</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={notificationPreferences.inApp?.types?.[type.id] || false}
                                    onChange={(e) => updateNotificationPreferences({
                                      inApp: {
                                        ...notificationPreferences.inApp,
                                        types: { ...notificationPreferences.inApp.types, [type.id]: e.target.checked }
                                      }
                                    })}
                                    disabled={!notificationPreferences.inApp?.enabled}
                                  />
                                  <span style={{ fontSize: '0.85rem' }}>In-App</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button onClick={sendTestNotification} className="btn-secondary">
                    📬 Send Test Notification
                  </button>
                </>
              )}

              {!notificationPreferences && !notificationsLoading && (
                <div className="alert-info">
                  Loading notification preferences...
                </div>
              )}
            </div>

            {/* Notifications List */}
            <div className="section-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>Recent Notifications ({notifications.length})</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {unreadCount > 0 && (
                    <button onClick={markAllNotificationsAsRead} className="btn-secondary" style={{ fontSize: '0.85rem' }}>
                      Mark All Read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button onClick={clearAllNotifications} className="btn-secondary" style={{ fontSize: '0.85rem' }}>
                      Clear All
                    </button>
                  )}
                </div>
              </div>

              {notifications.length === 0 && (
                <div className="alert-info" style={{ textAlign: 'center', padding: '2rem' }}>
                  No notifications yet. When trading events occur, you'll see them here.
                </div>
              )}

              {notifications.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {notifications.map(notification => (
                    <div
                      key={notification.id}
                      onClick={() => !notification.read && markNotificationAsRead(notification.id)}
                      style={{
                        padding: '1rem',
                        backgroundColor: notification.read ? 'var(--dark-secondary)' : 'rgba(59, 130, 246, 0.1)',
                        borderLeft: `4px solid ${
                          notification.severity === 'critical' ? '#dc2626' :
                          notification.severity === 'warning' ? '#f59e0b' :
                          notification.severity === 'success' ? '#10b981' :
                          '#3b82f6'
                        }`,
                        borderRadius: '8px',
                        cursor: notification.read ? 'default' : 'pointer',
                        opacity: notification.read ? 0.7 : 1
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{notification.title}</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.7, whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                          {new Date(notification.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ marginBottom: '0.25rem' }}>{notification.message}</div>
                      {notification.details && (
                        <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{notification.details}</div>
                      )}
                      {!notification.read && (
                        <div style={{ fontSize: '0.75rem', color: '#3b82f6', marginTop: '0.5rem' }}>
                          Click to mark as read
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* API Configuration Modal */}
      {showApiModal && (
        <div className="modal-overlay" onClick={() => setShowApiModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Configure API Keys</h2>
              <button className="modal-close" onClick={() => setShowApiModal(false)}>×</button>
            </div>

            <div className="modal-body">
              <div className="info-box">
                <p>🔑 Enter your Kraken API credentials for live trading.</p>
                <p className="small">Paper trading works without API keys.</p>
              </div>

              <div className="form-group">
                <label>Kraken API Key</label>
                <input
                  type="password"
                  value={apiKeysForm.krakenApiKey}
                  onChange={(e) => setApiKeysForm({...apiKeysForm, krakenApiKey: e.target.value})}
                  placeholder="Paste your API key here"
                  className="input"
                />
              </div>

              <div className="form-group">
                <label>Kraken API Secret</label>
                <input
                  type="password"
                  value={apiKeysForm.krakenApiSecret}
                  onChange={(e) => setApiKeysForm({...apiKeysForm, krakenApiSecret: e.target.value})}
                  placeholder="Paste your API secret here"
                  className="input"
                />
              </div>

              <div className="warning-box">
                <p>⚠️ <strong>Security Warning:</strong></p>
                <p>Never share your API keys. They are stored locally in your browser.</p>
              </div>

              <div className="setup-steps">
                <h3>How to Get Your API Keys:</h3>
                <ol>
                  <li>Go to <strong>Kraken.com</strong> and log in</li>
                  <li>Navigate to <strong>Settings → API</strong></li>
                  <li>Click <strong>Generate New Key</strong></li>
                  <li>Select permissions:
                    <ul>
                      <li>✓ Query Funds</li>
                      <li>✓ Query Open Orders & Trades</li>
                      <li>✓ Create & Modify Orders</li>
                    </ul>
                  </li>
                  <li>Copy the <strong>Key</strong> and <strong>Private Key</strong></li>
                  <li>Paste them here</li>
                </ol>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowApiModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveApiKeys}>Save API Keys</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
