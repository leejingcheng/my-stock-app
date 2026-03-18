import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit2,
  Sun,
  Moon,
  Wallet,
  RefreshCw,
  BarChart2,
  LineChart,
  Download,
  ChevronDown,
  ChevronUp,
  Filter
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc,
  deleteDoc, 
  doc, 
  onSnapshot, 
  query 
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken,
  onAuthStateChanged 
} from 'firebase/auth';

// --- Firebase 配置 ---
let firebaseConfig;
if (typeof __firebase_config !== 'undefined') {
  // 於預覽環境中使用系統配置
  firebaseConfig = JSON.parse(__firebase_config);
} else {
  // 於您自行發佈的網域中使用專屬配置
  firebaseConfig = {
    apiKey: "AIzaSyAgYhwYLwAKeDCpGlCbCSJyTzNYzMUhxtU",
    authDomain: "my-stock-e83d8.firebaseapp.com",
    projectId: "my-stock-e83d8",
    storageBucket: "my-stock-e83d8.firebasestorage.app",
    messagingSenderId: "345712080615",
    appId: "1:345712080615:web:b601f46518eaf101345442",
    measurementId: "G-VZZ95DE0V3"
  };
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 取得 appId 並自動過濾斜線，避免破壞 Firebase 的路徑層級結構
const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'my-stock-tracker';
const appId = rawAppId.replace(/\//g, '_');

// --- 預設常用股票清單 ---
const DEFAULT_STOCKS = {
  'RKLB': 'Rocket Lab Corporation',
  'SPY': '标普 500ETF-SPDR',
  'QQQ': '纳斯达克 100ETF-Invesco',
  'TSLA': '特斯拉',
  'NBIS': 'Nebius Group N.V.',
  'ONDS': 'Ondas Inc.',
  'VSAT': 'ViaSat, Inc.',
  'NVDA': '輝達',
  'UNH': '聯合健康',
  'VOO': 'Vanguard S&P 500 ETF',
  '0050': '元大台灣 50',
  '2330': '台積電',
  '3231': '緯創',
  '5347': '世界',
  '2882': '國泰金'
};

const App = () => {
  const [user, setUser] = useState(null);
  const [records, setRecords] = useState([]);
  const [marketTab, setMarketTab] = useState('Overview'); 
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); 
  const [isDarkMode, setIsDarkMode] = useState(false); // 預設淺色模式
  const [exchangeRate, setExchangeRate] = useState(32.5);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [isRankingExpanded, setIsRankingExpanded] = useState(false); 
  const [collapsedYears, setCollapsedYears] = useState({}); 
  
  const [selectedYear, setSelectedYear] = useState('All');
  const [displayLimit, setDisplayLimit] = useState(20);

  // 表單狀態
  const [formData, setFormData] = useState({
    recordType: 'trade', 
    symbol: '',
    name: '',
    shares: '',
    cost: '', 
    revenue: '', 
    date: new Date().toISOString().split('T')[0],
    market: 'Overseas',
    exchangeRate: '32.5'
  });

  // 1. 處理身份驗證 (兼容預覽環境與正式環境)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 監聽 Firestore 數據
  useEffect(() => {
    if (!user) return;
    try {
      const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'realized_records'));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setRecords(data.sort((a, b) => new Date(b.date) - new Date(a.date)));
      }, (err) => console.error(err));
      
      return () => unsubscribe();
    } catch (err) {
      console.error("Firestore connection error:", err);
    }
  }, [user]);

  // 自動抓取歷史匯率
  useEffect(() => {
    if (formData.market !== 'Overseas' || !formData.date) return;
    
    if (editingId) {
      const currentRecord = records.find(r => r.id === editingId);
      if (currentRecord && currentRecord.date === formData.date) {
        return; 
      }
    }

    let isMounted = true;
    const fetchRate = async () => {
      setIsFetchingRate(true);
      try {
        let res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${formData.date}/v1/currencies/usd.json`);
        if (!res.ok) {
          res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json`);
        }
        
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.usd && data.usd.twd) {
            setFormData(prev => ({ ...prev, exchangeRate: data.usd.twd.toFixed(2) }));
            return; 
          }
        }
        throw new Error("API 回應異常或斷線");
      } catch (err) {
        console.warn("外部匯率 API 無法連線，啟動自我修復機制從歷史紀錄回推...", err);
        if (isMounted) {
          const pastRecords = records
            .filter(r => r.market === 'Overseas' && r.exchangeRate && r.date <= formData.date)
            .sort((a, b) => new Date(b.date) - new Date(a.date)); 
            
          if (pastRecords.length > 0) {
            setFormData(prev => ({ ...prev, exchangeRate: pastRecords[0].exchangeRate.toString() }));
          } else {
            setFormData(prev => ({ ...prev, exchangeRate: exchangeRate.toString() }));
          }
        }
      } finally {
        if (isMounted) setIsFetchingRate(false);
      }
    };

    fetchRate();
    return () => { isMounted = false; };
  }, [formData.date, formData.market, editingId, records, exchangeRate]);

  const availableYears = useMemo(() => {
    const years = new Set(records.map(r => r.date.substring(0, 4)));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [records]);

  useEffect(() => {
    setDisplayLimit(20);
  }, [marketTab, selectedYear]);

  // 3. 計算功能
  const filteredRecords = useMemo(() => {
    let res = records;
    if (marketTab !== 'Overview') {
      res = res.filter(r => r.market === marketTab);
    }
    if (selectedYear !== 'All') {
      res = res.filter(r => r.date.startsWith(selectedYear));
    }
    return res;
  }, [records, marketTab, selectedYear]);

  const visibleRecords = useMemo(() => {
    return filteredRecords.slice(0, displayLimit);
  }, [filteredRecords, displayLimit]);

  const summaryStats = useMemo(() => {
    if (filteredRecords.length === 0) return { cost: 0, revenue: 0, profit: 0, rate: 0 };
    
    let totalCost = 0;
    let totalRevenue = 0;

    filteredRecords.forEach(r => {
      const rate = r.market === 'Overseas' ? (r.exchangeRate || exchangeRate) : 1;
      totalCost += r.cost * rate;
      totalRevenue += r.revenue * rate;
    });

    const totalProfit = totalRevenue - totalCost;
    const totalRate = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
    return { cost: totalCost, revenue: totalRevenue, profit: totalProfit, rate: totalRate };
  }, [filteredRecords, exchangeRate]);

  const chartData = useMemo(() => {
    if (filteredRecords.length === 0) return { assetProfits: [], trendProfits: [], isYearly: true };

    const assetMap = {};
    const trendMap = {};
    const isYearly = selectedYear === 'All';

    filteredRecords.forEach(r => {
      const rate = r.market === 'Overseas' ? (r.exchangeRate || exchangeRate) : 1;
      const twdProfit = r.profit * rate;

      if (!assetMap[r.symbol]) assetMap[r.symbol] = { symbol: r.symbol, name: r.name, profit: 0 };
      assetMap[r.symbol].profit += twdProfit;

      const trendKey = isYearly ? r.date.substring(0, 4) : r.date.substring(0, 7); 
      if (!trendMap[trendKey]) trendMap[trendKey] = { key: trendKey, profit: 0 };
      trendMap[trendKey].profit += twdProfit;
    });

    const assetProfits = Object.values(assetMap).sort((a, b) => b.profit - a.profit);
    const maxAssetAbs = Math.max(...assetProfits.map(a => Math.abs(a.profit)), 1); 

    const trendProfits = Object.values(trendMap).sort((a, b) => a.key.localeCompare(b.key));
    const maxTrendAbs = Math.max(...trendProfits.map(t => Math.abs(t.profit)), 1);

    return { assetProfits, maxAssetAbs, trendProfits, maxTrendAbs, isYearly };
  }, [filteredRecords, exchangeRate, selectedYear]);

  const knownStocks = useMemo(() => {
    const map = { ...DEFAULT_STOCKS };
    records.forEach(r => {
      if (!map[r.symbol]) {
        map[r.symbol] = r.name;
      }
    });
    return map;
  }, [records]);

  const handleSymbolChange = (e) => {
    const val = e.target.value.toUpperCase();
    setFormData(prev => {
      const updates = { symbol: val };
      if (knownStocks[val]) {
        updates.name = knownStocks[val];
      }
      return { ...prev, ...updates };
    });
  };

  const exportToCSV = () => {
    if (filteredRecords.length === 0) return;

    const headers = ['市場', '紀錄類型', '代號', '名稱', '日期', '賣出股數', '投資成本', '帳面收入/股息', '損益', '報酬率(%)', '結匯匯率'];
    
    const rows = filteredRecords.map(r => {
      const isDiv = r.recordType === 'dividend';
      return [
        r.market === 'TW' ? '台股' : '海外股票',
        isDiv ? '現金股息' : '交易損益',
        r.symbol,
        r.name,
        r.date,
        isDiv ? '-' : r.shares,
        isDiv ? '-' : r.cost,
        r.revenue,
        r.profit,
        isDiv ? '-' : r.profitRate.toFixed(2),
        r.market === 'Overseas' ? (r.exchangeRate || exchangeRate) : 1
      ];
    });

    const csvContent = '\uFEFF' + [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `投資損益紀錄_${marketTab}_${selectedYear}年_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const closeAndResetModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({ recordType: 'trade', symbol: '', name: '', shares: '', cost: '', revenue: '', date: new Date().toISOString().split('T')[0], market: 'Overseas', exchangeRate: exchangeRate.toString() });
  };

  const handleEditClick = (record) => {
    setFormData({
      recordType: record.recordType || 'trade',
      symbol: record.symbol,
      name: record.name,
      shares: record.shares || '',
      cost: record.cost || '',
      revenue: record.revenue,
      date: record.date,
      market: record.market,
      exchangeRate: record.exchangeRate ? record.exchangeRate.toString() : exchangeRate.toString()
    });
    setEditingId(record.id);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    try {
      const isDividend = formData.recordType === 'dividend';
      
      const cost = isDividend ? 0 : (parseFloat(formData.cost) || 0);
      const revenue = parseFloat(formData.revenue) || 0;
      const shares = isDividend ? '0' : formData.shares;
      
      const profit = revenue - cost;
      const profitRate = cost > 0 ? (profit / cost) * 100 : 0;
      
      const recordExchangeRate = formData.market === 'Overseas' 
        ? (parseFloat(formData.exchangeRate) || exchangeRate) 
        : 1;

      const recordData = {
        ...formData,
        shares,
        cost,
        revenue,
        profit,
        profitRate,
        exchangeRate: recordExchangeRate,
      };

      if (editingId) {
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'realized_records', editingId), recordData);
      } else {
        recordData.timestamp = Date.now();
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'realized_records'), recordData);
      }
      
      closeAndResetModal();
    } catch (err) {
      console.error("Error saving record: ", err);
    }
  };

  const handleDelete = async (id) => {
    if (!user) return;
    if (window.confirm('確定要刪除這筆紀錄嗎？')) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'realized_records', id));
      } catch (err) {
        console.error(err);
      }
    }
  };

  const getPriceColor = (val) => val >= 0 ? 'text-red-500' : 'text-green-500';

  const theme = isDarkMode ? {
    bgMain: "bg-[#121212]",
    bgCard: "bg-[#1e1e1e]",
    bgInner: "bg-[#252525]",
    bgInput: "bg-[#2a2a2a]",
    bgNav: "bg-[#1e1e1e]",
    textMain: "text-slate-200",
    textMuted: "text-slate-400",
    textStrong: "text-white",
    borderMain: "border-white/5",
    borderInput: "border-none",
    backdrop: "bg-black/80",
    tabActive: "text-white border-emerald-400",
    tabInactive: "text-slate-400"
  } : {
    bgMain: "bg-slate-50",
    bgCard: "bg-white",
    bgInner: "bg-slate-50",
    bgInput: "bg-slate-100",
    bgNav: "bg-white",
    textMain: "text-slate-800",
    textMuted: "text-slate-500",
    textStrong: "text-slate-900",
    borderMain: "border-slate-200",
    borderInput: "border border-slate-200",
    backdrop: "bg-slate-900/40",
    tabActive: "text-slate-900 border-emerald-500",
    tabInactive: "text-slate-500"
  };

  return (
    <div className={`min-h-screen ${theme.bgMain} ${theme.textMain} font-sans pb-8 transition-colors duration-300`}>
      {/* 頂部導航 */}
      <div className={`${theme.bgCard} px-4 pt-6 pb-2 sticky top-0 z-20 shadow-sm transition-colors duration-300`}>
        <div className="flex justify-between items-center mb-6">
          <h1 className={`text-xl font-bold ${theme.textStrong}`}>帳務</h1>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={exportToCSV}
              className={`${theme.textMuted} hover:${theme.textStrong} transition-colors p-1`}
              title="匯出成 Excel (CSV)"
            >
              <Download size={20} />
            </button>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)} 
              className={`${theme.textMuted} hover:${theme.textStrong} transition-colors p-1`}
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </div>
        
        {/* 市場切換與年份篩選 */}
        <div className={`flex justify-between items-end border-b ${theme.borderMain} mb-4`}>
          <div className={`flex gap-6 text-sm font-medium overflow-x-auto no-scrollbar`}>
            {['總覽', '台股', '海外股票'].map(tab => {
              let tabValue = 'Overseas';
              if (tab === '總覽') tabValue = 'Overview';
              else if (tab === '台股') tabValue = 'TW';
              else if (tab === '海外股票') tabValue = 'Overseas';

              const isActive = marketTab === tabValue;

              return (
                <button 
                  key={tab}
                  onClick={() => setMarketTab(tabValue)}
                  className={`pb-2 relative whitespace-nowrap ${ isActive ? 'text-emerald-500' : theme.textMuted }`}
                >
                  {tab}
                  {isActive && (
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 bg-emerald-500 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="pb-2">
            <div className={`flex items-center gap-1 bg-transparent text-sm font-bold ${theme.textStrong}`}>
              <Filter size={14} className={theme.textMuted} />
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="bg-transparent outline-none cursor-pointer appearance-none text-right"
              >
                <option value="All" className={theme.bgCard}>全部年份</option>
                {availableYears.map(y => (
                  <option key={y} value={y} className={theme.bgCard}>{y}年</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <main className="p-4 space-y-4">
        {/* 總覽專屬區塊 (總計 + 圖表) */}
        {marketTab === 'Overview' && (
          <div className="space-y-4 mb-4">
            {/* 總結算卡片 */}
            <div className={`${theme.bgCard} p-5 rounded-2xl border ${theme.borderMain} shadow-sm transition-colors duration-300`}>
              <div className="flex justify-between items-center mb-4">
                <h2 className={`font-bold ${theme.textStrong} flex items-center gap-2`}>
                  <Wallet size={18} className="text-emerald-500" />
                  {selectedYear === 'All' ? '累積總結算' : `${selectedYear}年 結算`} (TWD)
                </h2>
                <div className={`text-xs flex items-center gap-1 ${theme.textMuted} ${isDarkMode ? 'bg-black/20' : 'bg-slate-100'} px-2 py-1 rounded-lg`}>
                  <span>預設匯率 =</span>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={exchangeRate} 
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    className={`w-12 bg-transparent border-b ${isDarkMode ? 'border-emerald-500/50' : 'border-emerald-500'} outline-none text-center text-emerald-500 font-bold`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="col-span-2">
                    <p className={`text-sm ${theme.textMuted}`}>淨損益</p>
                    <p className={`text-3xl font-bold ${getPriceColor(summaryStats.profit)}`}>
                      {summaryStats.profit >= 0 ? '+' : ''}NT$ {summaryStats.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      <span className="text-lg ml-2 font-medium">({summaryStats.rate >= 0 ? '+' : ''}{summaryStats.rate.toFixed(2)}%)</span>
                    </p>
                 </div>
                 <div className={`p-3 rounded-xl ${theme.bgInner} border ${theme.borderMain}`}>
                   <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-1 tracking-wider`}>總投資成本</p>
                   <p className={`font-mono font-bold ${theme.textStrong} text-lg`}>NT$ {summaryStats.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                 </div>
                 <div className={`p-3 rounded-xl ${theme.bgInner} border ${theme.borderMain}`}>
                   <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-1 tracking-wider`}>總帳面收入(含息)</p>
                   <p className={`font-mono font-bold ${theme.textStrong} text-lg`}>NT$ {summaryStats.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                 </div>
              </div>
            </div>

            {/* 圖表分析區塊 */}
            {chartData.assetProfits.length > 0 && (
              <>
                {/* 1. 各標的損益排行 */}
                <div className={`${theme.bgCard} p-5 rounded-2xl border ${theme.borderMain} shadow-sm transition-colors duration-300`}>
                  <h3 className={`font-bold ${theme.textStrong} mb-6 flex items-center gap-2`}>
                    <BarChart2 size={18} className="text-emerald-500" />
                    各標的累積損益排行 (TWD)
                  </h3>
                  <div className="space-y-5">
                    {chartData.assetProfits.slice(0, isRankingExpanded ? undefined : 5).map(asset => {
                      const pct = (Math.abs(asset.profit) / chartData.maxAssetAbs) * 50; 
                      const isPos = asset.profit >= 0;
                      return (
                        <div key={asset.symbol} className="flex flex-col gap-1.5 animate-in fade-in duration-300">
                          <div className="flex justify-between text-xs px-1">
                            <span className={`font-bold ${theme.textStrong}`}>{asset.symbol} <span className={`font-normal ${theme.textMuted} ml-1`}>{asset.name}</span></span>
                            <span className={`font-mono ${getPriceColor(asset.profit)}`}>
                              {isPos ? '+' : ''}{asset.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                          <div className={`h-2.5 relative w-full rounded-full ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}>
                            <div className={`absolute top-0 bottom-0 left-1/2 w-[1px] ${isDarkMode ? 'bg-white/20' : 'bg-slate-300'} z-10`} />
                            {isPos ? (
                              <div className="absolute top-0 bottom-0 left-1/2 bg-red-500 rounded-r-full" style={{ width: `${pct}%` }} />
                            ) : (
                              <div className="absolute top-0 bottom-0 right-1/2 bg-green-500 rounded-l-full" style={{ width: `${pct}%` }} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* 展開/收合按鈕 */}
                  {chartData.assetProfits.length > 5 && (
                    <button
                      onClick={() => setIsRankingExpanded(!isRankingExpanded)}
                      className={`w-full mt-5 pt-4 flex items-center justify-center gap-1 text-xs font-medium ${theme.textMuted} hover:${theme.textStrong} transition-colors border-t ${theme.borderMain}`}
                    >
                      {isRankingExpanded ? (
                        <>收起排行 <ChevronUp size={14} /></>
                      ) : (
                        <>展開其餘 {chartData.assetProfits.length - 5} 檔標的 <ChevronDown size={14} /></>
                      )}
                    </button>
                  )}
                </div>

                {/* 2. 趨勢圖表 */}
                <div className={`${theme.bgCard} p-5 rounded-2xl border ${theme.borderMain} shadow-sm transition-colors duration-300 mb-6`}>
                  <h3 className={`font-bold ${theme.textStrong} flex items-center gap-2`}>
                    <LineChart size={18} className="text-emerald-500" />
                    {chartData.isYearly ? '每年' : '每月'}獲利趨勢 (TWD)
                  </h3>
                  <div className="h-44 relative flex items-center justify-between gap-1 mt-6 pb-6">
                    <div className={`absolute left-0 right-0 top-1/2 h-[1px] ${isDarkMode ? 'bg-white/20' : 'bg-slate-300'} z-0 -translate-y-1/2`} />
                    
                    {chartData.trendProfits.map(t => {
                      const pct = (Math.abs(t.profit) / chartData.maxTrendAbs) * 50; 
                      const isPos = t.profit >= 0;
                      return (
                        <div key={t.key} className="relative flex-1 h-full group z-10 flex flex-col justify-center items-center cursor-crosshair">
                          {isPos ? (
                            <div className={`w-full ${chartData.isYearly ? 'max-w-[40px]' : 'max-w-[24px]'} bg-red-500 rounded-t-sm absolute bottom-1/2`} style={{ height: `${pct}%` }} />
                          ) : (
                            <div className={`w-full ${chartData.isYearly ? 'max-w-[40px]' : 'max-w-[24px]'} bg-green-500 rounded-b-sm absolute top-1/2`} style={{ height: `${pct}%` }} />
                          )}
                          
                          <div className={`absolute ${isPos ? '-top-6' : 'bottom-6'} bg-black/90 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-20 shadow-lg border border-white/10`}>
                            {isPos ? '+' : ''}{t.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </div>
                          
                          <span className={`absolute bottom-0 text-[10px] font-mono ${theme.textMuted}`}>
                            {chartData.isYearly ? `${t.key}年` : `${parseInt(t.key.substring(5))}月`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 依年份分群顯示紀錄 (不在總覽顯示) */}
        {marketTab !== 'Overview' && (
          <div className="space-y-6">
            {Object.entries(
              visibleRecords.reduce((acc, record) => {
                const year = record.date.substring(0, 4);
                if (!acc[year]) acc[year] = [];
                acc[year].push(record);
                return acc;
              }, {})
            ).sort(([yearA], [yearB]) => yearB.localeCompare(yearA)).map(([year, yearRecords]) => (
              <div key={year}>
                <div className={`-mx-4 mb-4 border-y ${theme.borderMain} ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}>
                  <button 
                    onClick={() => setCollapsedYears(prev => ({ ...prev, [year]: !prev[year] }))}
                    className={`w-full flex justify-center items-center py-2 ${theme.textMuted} text-sm font-mono tracking-widest active:bg-white/10 transition-colors`}
                  >
                    {year}年
                    {collapsedYears[year] ? <ChevronDown size={14} className="ml-2" /> : <ChevronUp size={14} className="ml-2" />}
                  </button>
                </div>
                
                {!collapsedYears[year] && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    {yearRecords.map((record) => {
                      const isDividend = record.recordType === 'dividend';
                      return (
                        <div key={record.id} className={`${theme.bgCard} rounded-xl overflow-hidden shadow-sm border ${theme.borderMain} transition-colors duration-300 relative`}>
                          {/* 股息專屬的左側標籤 */}
                          {isDividend && <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500" />}
                          
                          <div className="p-4">
                            <div className="flex justify-between items-start mb-1">
                              <div>
                                <div className="flex items-center gap-2">
                                   <span className={`${theme.textMuted} text-sm font-bold`}>{record.symbol}</span>
                                   <span className={`text-[10px] px-1.5 py-0.5 rounded border ${record.market === 'TW' ? 'border-blue-500/30 text-blue-500' : 'border-purple-500/30 text-purple-500'}`}>
                                     {record.market === 'TW' ? '台股' : '美股'}{isDividend ? ' • 股息' : ''}
                                   </span>
                                </div>
                                <h3 className={`${theme.textStrong} font-bold text-lg leading-tight mt-1`}>{record.name}</h3>
                              </div>
                              <span className={`${theme.textMuted} text-xs`}>{record.date.slice(5).replace('-', '/')}</span>
                            </div>

                            <div className="flex justify-between items-end mt-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className={`${theme.textMuted} text-sm`}>{isDividend ? '類型' : '股數'}</span>
                                  <span className={`${theme.textStrong} font-bold`}>{isDividend ? '現金股利' : record.shares}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`${theme.textMuted} text-sm`}>{isDividend ? '領息' : '損益'}</span>
                                  <span className={`font-bold ${getPriceColor(record.profit)}`}>
                                    {record.profit >= 0 ? '+' : ''}{record.profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    {!isDividend && ` (${record.profitRate >= 0 ? '+' : ''}${record.profitRate.toFixed(2)}%)`}
                                  </span>
                                </div>
                              </div>
                              <div className="flex gap-1 -mr-2">
                                <button onClick={() => handleEditClick(record)} className="text-slate-400 hover:text-blue-500 transition-colors p-2" title="編輯紀錄">
                                  <Edit2 size={16} />
                                </button>
                                <button onClick={() => handleDelete(record.id)} className="text-slate-400 hover:text-red-500 transition-colors p-2" title="刪除紀錄">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* 明細區塊 */}
                          <div className={`${theme.bgInner} p-4 space-y-3`}>
                            {record.market === 'Overseas' && (
                              <div className={`flex justify-between text-sm pb-2 border-b ${theme.borderMain}`}>
                                <span className={theme.textMuted}>結匯匯率</span>
                                <span className={`${theme.textStrong} font-mono`}>{record.exchangeRate || exchangeRate}</span>
                              </div>
                            )}
                            
                            {!isDividend ? (
                              <>
                                <div className="flex justify-between text-sm">
                                  <span className={theme.textMuted}>成交價</span>
                                  <span className={`${theme.textStrong} font-mono`}>{(record.revenue / record.shares).toFixed(2)}</span>
                                </div>
                                <div className={`flex justify-between text-sm border-t ${theme.borderMain} pt-2`}>
                                  <span className={theme.textMuted}>帳面收入</span>
                                  <span className={`${theme.textStrong} font-mono`}>{record.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className={`flex justify-between text-sm border-t ${theme.borderMain} pt-2`}>
                                  <span className={theme.textMuted}>投資成本</span>
                                  <span className={`${theme.textStrong} font-mono`}>{record.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                </div>
                              </>
                            ) : (
                              <div className="flex justify-between text-sm">
                                <span className={theme.textMuted}>股息總額</span>
                                <span className={`${theme.textStrong} font-mono text-yellow-500`}>{record.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {filteredRecords.length > displayLimit && (
              <div className="pt-4 pb-8">
                <button 
                  onClick={() => setDisplayLimit(prev => prev + 20)}
                  className={`w-full py-4 rounded-xl border border-dashed ${theme.borderMain} ${theme.textMuted} hover:${theme.textStrong} transition-colors text-sm font-bold active:scale-[0.98]`}
                >
                  載入更多紀錄 (目前顯示 {displayLimit} / {filteredRecords.length} 筆)
                </button>
              </div>
            )}

            {filteredRecords.length === 0 && (
              <div className={`text-center py-20 ${theme.textMuted}`}>
                該年份目前沒有紀錄
              </div>
            )}
          </div>
        )}
      </main>

      {/* 懸浮新增按鈕 */}
      <button 
        onClick={() => {
          setEditingId(null);
          setFormData({ recordType: 'trade', symbol: '', name: '', shares: '', cost: '', revenue: '', date: new Date().toISOString().split('T')[0], market: 'Overseas', exchangeRate: exchangeRate.toString() });
          setIsModalOpen(true);
        }}
        className="fixed bottom-8 right-6 w-14 h-14 bg-emerald-500 text-white rounded-full shadow-lg shadow-emerald-500/20 flex items-center justify-center hover:scale-105 active:scale-95 transition-all z-30"
      >
        <Plus size={32} strokeWidth={3} />
      </button>

      {/* 新增/編輯紀錄彈窗 */}
      {isModalOpen && (
        <div className={`fixed inset-0 ${theme.backdrop} backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-colors`}>
          <div className={`${theme.bgCard} w-full max-w-sm rounded-2xl overflow-hidden border ${theme.borderMain} shadow-2xl flex flex-col max-h-[90vh]`}>
            <div className={`p-4 border-b ${theme.borderMain} flex justify-between items-center shrink-0 ${theme.bgInner}`}>
              <h3 className={`font-bold ${theme.textStrong}`}>{editingId ? '編輯紀錄' : '新增紀錄'}</h3>
              <button onClick={closeAndResetModal} className={`${theme.textMuted} hover:${theme.textStrong}`}>取消</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
              
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button 
                  type="button"
                  onClick={() => setFormData({...formData, market: 'TW'})}
                  className={`py-2 rounded-lg text-sm font-bold border transition-colors ${formData.market === 'TW' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500' : `${theme.borderMain} ${theme.textMuted}`}`}
                >台股</button>
                <button 
                  type="button"
                  onClick={() => setFormData({...formData, market: 'Overseas'})}
                  className={`py-2 rounded-lg text-sm font-bold border transition-colors ${formData.market === 'Overseas' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500' : `${theme.borderMain} ${theme.textMuted}`}`}
                >海外股票</button>
              </div>

              {/* 紀錄類型切換 */}
              <div className={`flex rounded-lg p-1 border ${theme.borderMain} ${theme.bgInner}`}>
                 <button
                    type="button"
                    onClick={() => setFormData({...formData, recordType: 'trade'})}
                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${formData.recordType === 'trade' ? 'bg-indigo-500 text-white shadow' : `text-slate-400 hover:${theme.textStrong}`}`}
                 >交易損益</button>
                 <button
                    type="button"
                    onClick={() => setFormData({...formData, recordType: 'dividend'})}
                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${formData.recordType === 'dividend' ? 'bg-yellow-500 text-white shadow' : `text-slate-400 hover:${theme.textStrong}`}`}
                 >股息配息</button>
              </div>

              <div className="space-y-1 mt-2">
                <label className={`text-[10px] ${theme.textMuted} uppercase font-bold px-1`}>股票代號 / 名稱</label>
                <div className="grid grid-cols-2 gap-2">
                  <input 
                    list="known-symbols"
                    placeholder="代號 (如: RKLB)" 
                    required 
                    className={`${theme.bgInput} ${theme.borderInput} rounded-lg p-3 ${theme.textStrong} placeholder:${theme.textMuted} focus:ring-1 ring-emerald-500 outline-none`} 
                    value={formData.symbol} 
                    onChange={handleSymbolChange} 
                  />
                  <datalist id="known-symbols">
                    {Object.entries(knownStocks).map(([sym, name]) => (
                      <option key={sym} value={sym}>{name}</option>
                    ))}
                  </datalist>
                  <input 
                    placeholder="公司簡稱" 
                    required 
                    className={`${theme.bgInput} ${theme.borderInput} rounded-lg p-3 ${theme.textStrong} placeholder:${theme.textMuted} focus:ring-1 ring-emerald-500 outline-none`} 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {formData.recordType === 'trade' && (
                  <div className="space-y-1">
                    <label className={`text-[10px] ${theme.textMuted} uppercase font-bold px-1`}>賣出股數</label>
                    <input type="number" required className={`w-full ${theme.bgInput} ${theme.borderInput} rounded-lg p-3 ${theme.textStrong} focus:ring-1 ring-emerald-500 outline-none`} value={formData.shares} onChange={e => setFormData({...formData, shares: e.target.value})} />
                  </div>
                )}
                <div className={`space-y-1 ${formData.recordType === 'dividend' ? 'col-span-2' : ''}`}>
                  <label className={`text-[10px] ${theme.textMuted} uppercase font-bold px-1`}>日期</label>
                  <input type="date" className={`w-full ${theme.bgInput} ${theme.borderInput} rounded-lg p-3 ${theme.textStrong} text-xs focus:ring-1 ring-emerald-500 outline-none`} value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
                </div>
              </div>

              {formData.market === 'Overseas' && (
                <div className="space-y-1">
                  <label className={`text-[10px] ${theme.textMuted} uppercase font-bold px-1 flex items-center gap-2`}>
                    結算匯率 (USD/TWD)
                    {isFetchingRate && <RefreshCw size={10} className="animate-spin text-emerald-500" />}
                  </label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    className={`w-full ${theme.bgInput} ${theme.borderInput} rounded-lg p-3 ${theme.textStrong} focus:ring-1 ring-emerald-500 outline-none`} 
                    value={formData.exchangeRate} 
                    onChange={e => setFormData({...formData, exchangeRate: e.target.value})} 
                  />
                  <p className={`text-[10px] ${theme.textMuted} px-1 mt-1`}>自動連線抓取，若斷線將智慧帶入您最近一次的歷史匯率。</p>
                </div>
              )}

              <div className="space-y-4 pt-2">
                <div className="space-y-1">
                  <label className={`text-[10px] ${formData.recordType === 'dividend' ? 'text-yellow-500' : 'text-red-500'} uppercase font-bold px-1`}>
                    {formData.recordType === 'dividend' ? '股息金額 (總額)' : '帳面收入 (賣出總額)'}
                  </label>
                  <input type="number" step="0.01" required className={`w-full ${theme.bgInput} ${theme.borderInput} rounded-lg p-3 ${theme.textStrong} text-xl font-mono focus:ring-1 ring-emerald-500 outline-none`} value={formData.revenue} onChange={e => setFormData({...formData, revenue: e.target.value})} />
                </div>
                
                {formData.recordType === 'trade' && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-blue-500 uppercase font-bold px-1">投資成本 (總成本)</label>
                    <input type="number" step="0.01" required className={`w-full ${theme.bgInput} ${theme.borderInput} rounded-lg p-3 ${theme.textStrong} text-xl font-mono focus:ring-1 ring-emerald-500 outline-none`} value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} />
                  </div>
                )}
              </div>

              <button type="submit" className={`w-full text-white font-bold py-4 rounded-xl mt-4 shadow-lg active:scale-95 transition-colors ${editingId ? 'bg-blue-500 hover:bg-blue-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
                {editingId ? '儲存修改' : '儲存紀錄'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;