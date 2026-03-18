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
  Filter,
  AlertCircle
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

// --- Firebase 配置 (已更換為您截圖中的專屬正確金鑰，修正第 9 位字母為小寫 y) ---
let firebaseConfig;
if (typeof __firebase_config !== 'undefined') {
  firebaseConfig = JSON.parse(__firebase_config);
} else {
  firebaseConfig = {
    apiKey: "AIzaSyAgyHwYLwAKeDCpGlCbCSJyTzNYzMUhxtU",
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

// 取得 appId
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
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(32.5);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [isRankingExpanded, setIsRankingExpanded] = useState(false); 
  const [collapsedYears, setCollapsedYears] = useState({}); 
  const [selectedYear, setSelectedYear] = useState('All');
  const [displayLimit, setDisplayLimit] = useState(20);
  const [errorMsg, setErrorMsg] = useState('');

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

  // 1. 身份驗證
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

  // 2. 監聽 Firestore
  useEffect(() => {
    if (!user) return;
    try {
      const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'realized_records'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setRecords(data.sort((a, b) => new Date(b.date) - new Date(a.date)));
      }, (err) => {
        console.error("Firestore error:", err);
      });
      return () => unsubscribe();
    } catch (err) {
      console.error("Connection error:", err);
    }
  }, [user]);

  // 匯率自動抓取
  useEffect(() => {
    if (formData.market !== 'Overseas' || !formData.date) return;
    if (editingId) {
      const currentRecord = records.find(r => r.id === editingId);
      if (currentRecord && currentRecord.date === formData.date) return; 
    }
    let isMounted = true;
    const fetchRate = async () => {
      setIsFetchingRate(true);
      try {
        let res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${formData.date}/v1/currencies/usd.json`);
        if (!res.ok) res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.usd && data.usd.twd) {
            setFormData(prev => ({ ...prev, exchangeRate: data.usd.twd.toFixed(2) }));
            return; 
          }
        }
      } catch (err) {
        if (isMounted) {
          const pastRecords = records
            .filter(r => r.market === 'Overseas' && r.exchangeRate && r.date <= formData.date)
            .sort((a, b) => new Date(b.date) - new Date(a.date)); 
          setFormData(prev => ({ ...prev, exchangeRate: pastRecords.length > 0 ? pastRecords[0].exchangeRate.toString() : exchangeRate.toString() }));
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

  const filteredRecords = useMemo(() => {
    let res = records;
    if (marketTab !== 'Overview') res = res.filter(r => r.market === marketTab);
    if (selectedYear !== 'All') res = res.filter(r => r.date.startsWith(selectedYear));
    return res;
  }, [records, marketTab, selectedYear]);

  const visibleRecords = useMemo(() => filteredRecords.slice(0, displayLimit), [filteredRecords, displayLimit]);

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
    records.forEach(r => { if (!map[r.symbol]) map[r.symbol] = r.name; });
    return map;
  }, [records]);

  const handleSymbolChange = (e) => {
    const val = e.target.value.toUpperCase();
    setFormData(prev => {
      const updates = { symbol: val };
      if (knownStocks[val]) updates.name = knownStocks[val];
      return { ...prev, ...updates };
    });
  };

  const exportToCSV = () => {
    if (filteredRecords.length === 0) return;
    const headers = ['市場', '紀錄類型', '代號', '名稱', '日期', '賣出股數', '投資成本', '帳面收入/股息', '損益', '報酬率(%)', '結匯匯率'];
    const rows = filteredRecords.map(r => [
        r.market === 'TW' ? '台股' : '海外股票',
        r.recordType === 'dividend' ? '現金股息' : '交易損益',
        r.symbol, r.name, r.date, r.shares, r.cost, r.revenue, r.profit, r.profitRate.toFixed(2),
        r.market === 'Overseas' ? (r.exchangeRate || exchangeRate) : 1
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `投資損益紀錄_${marketTab}_${selectedYear}年.csv`;
    link.click();
  };

  const closeAndResetModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setErrorMsg('');
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
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    if (!user) {
      setErrorMsg('連線失敗：請確保 Firebase Authentication 已開啟「匿名登入」，並將此網址加入「授權網域」。');
      return;
    }
    try {
      const isDividend = formData.recordType === 'dividend';
      const cost = isDividend ? 0 : (parseFloat(formData.cost) || 0);
      const revenue = parseFloat(formData.revenue) || 0;
      const profit = revenue - cost;
      const recordData = { 
        ...formData, 
        shares: isDividend ? '0' : formData.shares, 
        cost, revenue, profit, 
        profitRate: cost > 0 ? (profit / cost) * 100 : 0,
        exchangeRate: formData.market === 'Overseas' ? (parseFloat(formData.exchangeRate) || exchangeRate) : 1 
      };

      if (editingId) {
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'realized_records', editingId), recordData);
      } else {
        recordData.timestamp = Date.now();
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'realized_records'), recordData);
      }
      closeAndResetModal();
    } catch (err) {
      console.error(err);
      setErrorMsg('儲存失敗：請檢查 Firebase 資料庫 Rules 規則。');
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('確定要刪除這筆紀錄嗎？')) {
      try { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'realized_records', id)); } catch (err) { console.error(err); }
    }
  };

  const theme = isDarkMode ? {
    bgMain: "bg-[#121212]", bgCard: "bg-[#1e1e1e]", bgInner: "bg-[#252525]", bgInput: "bg-[#2a2a2a]",
    textMain: "text-slate-200", textMuted: "text-slate-400", textStrong: "text-white", borderMain: "border-white/5", backdrop: "bg-black/80"
  } : {
    bgMain: "bg-slate-50", bgCard: "bg-white", bgInner: "bg-slate-50", bgInput: "bg-slate-100",
    textMain: "text-slate-800", textMuted: "text-slate-500", textStrong: "text-slate-900", borderMain: "border-slate-200", backdrop: "bg-slate-900/40"
  };

  return (
    <div className={`min-h-screen ${theme.bgMain} ${theme.textMain} font-sans pb-8 transition-colors duration-300`}>
      <div className={`${theme.bgCard} px-4 pt-6 pb-2 sticky top-0 z-20 shadow-sm`}>
        <div className="flex justify-between items-center mb-6">
          <h1 className={`text-xl font-bold ${theme.textStrong}`}>帳務</h1>
          <div className="flex items-center gap-3">
            <button onClick={exportToCSV} className={`${theme.textMuted} hover:${theme.textStrong} p-1`}><Download size={20} /></button>
            <button onClick={() => setIsDarkMode(!isDarkMode)} className={`${theme.textMuted} hover:${theme.textStrong} p-1`}>
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </div>
        <div className={`flex justify-between items-end border-b ${theme.borderMain} mb-4`}>
          <div className="flex gap-6 text-sm font-medium overflow-x-auto no-scrollbar">
            {['總覽', '台股', '海外股票'].map(tab => {
              const tabValue = tab === '總覽' ? 'Overview' : (tab === '台股' ? 'TW' : 'Overseas');
              return (
                <button key={tab} onClick={() => setMarketTab(tabValue)} className={`pb-2 relative whitespace-nowrap ${marketTab === tabValue ? 'text-emerald-500' : theme.textMuted}`}>
                  {tab}{marketTab === tabValue && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 bg-emerald-500 rounded-full" />}
                </button>
              );
            })}
          </div>
          <div className="pb-2">
            <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="bg-transparent outline-none text-sm font-bold text-right">
              <option value="All">全部年份</option>
              {availableYears.map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
          </div>
        </div>
      </div>

      <main className="p-4 space-y-4">
        {marketTab === 'Overview' && (
          <div className="space-y-4">
            <div className={`${theme.bgCard} p-5 rounded-2xl border ${theme.borderMain} shadow-sm`}>
              <div className="flex justify-between items-center mb-4">
                <h2 className={`font-bold ${theme.textStrong} flex items-center gap-2`}><Wallet size={18} className="text-emerald-500" />{selectedYear === 'All' ? '累積總結算' : `${selectedYear}年 結算`} (TWD)</h2>
                <div className="text-xs flex items-center gap-1 text-emerald-500 font-bold">匯率 <input type="number" step="0.1" value={exchangeRate} onChange={(e) => setExchangeRate(Number(e.target.value))} className="w-10 bg-transparent border-b border-emerald-500 text-center outline-none" /></div>
              </div>
              <div>
                <p className={`text-sm ${theme.textMuted}`}>淨損益</p>
                <p className={`text-3xl font-bold ${summaryStats.profit >= 0 ? 'text-red-500' : 'text-green-500'}`}>NT$ {summaryStats.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-lg">({summaryStats.rate.toFixed(2)}%)</span></p>
                <div className="grid grid-cols-2 gap-4 mt-4">
                   <div className={`p-3 rounded-xl ${theme.bgInner} border ${theme.borderMain}`}><p className="text-[10px] uppercase font-bold text-slate-500 mb-1">總成本</p><p className="font-mono font-bold">NT$ {summaryStats.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
                   <div className={`p-3 rounded-xl ${theme.bgInner} border ${theme.borderMain}`}><p className="text-[10px] uppercase font-bold text-slate-500 mb-1">總收入</p><p className="font-mono font-bold">NT$ {summaryStats.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
                </div>
              </div>
            </div>
            {chartData.assetProfits.length > 0 && (
              <div className={`${theme.bgCard} p-5 rounded-2xl border ${theme.borderMain}`}>
                <h3 className="font-bold mb-6 flex items-center gap-2 text-emerald-500"><BarChart2 size={18} />累積損益排行</h3>
                <div className="space-y-5">
                  {chartData.assetProfits.slice(0, isRankingExpanded ? undefined : 5).map(asset => (
                    <div key={asset.symbol} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-bold"><span>{asset.symbol} <span className="opacity-50 ml-1">{asset.name}</span></span><span className={asset.profit >= 0 ? 'text-red-500' : 'text-green-500'}>{asset.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                      <div className={`h-2 relative rounded-full ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}>
                        <div className={`absolute top-0 bottom-0 left-1/2 w-[1px] ${isDarkMode ? 'bg-white/20' : 'bg-slate-300'}`} />
                        {asset.profit >= 0 ? 
                          <div className="absolute top-0 bottom-0 left-1/2 bg-red-500 rounded-r-full" style={{ width: `${(Math.abs(asset.profit) / chartData.maxAssetAbs) * 50}%` }} /> : 
                          <div className="absolute top-0 bottom-0 right-1/2 bg-green-500 rounded-l-full" style={{ width: `${(Math.abs(asset.profit) / chartData.maxAssetAbs) * 50}%` }} />}
                      </div>
                    </div>
                  ))}
                  {chartData.assetProfits.length > 5 && <button onClick={() => setIsRankingExpanded(!isRankingExpanded)} className={`w-full pt-4 text-xs font-bold ${theme.textMuted} border-t ${theme.borderMain}`}>{isRankingExpanded ? '收起' : '展開全部'}</button>}
                </div>
              </div>
            )}
          </div>
        )}

        {marketTab !== 'Overview' && (
          <div className="space-y-6">
            {Object.entries(visibleRecords.reduce((acc, r) => { const y = r.date.substring(0, 4); if (!acc[y]) acc[y] = []; acc[y].push(r); return acc; }, {})).sort(([a], [b]) => b - a).map(([year, yrRecs]) => (
              <div key={year}>
                <button onClick={() => setCollapsedYears(p => ({...p, [year]: !p[year]}))} className={`w-full py-2 -mx-4 px-4 border-y ${theme.borderMain} ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'} text-xs font-mono tracking-widest ${theme.textMuted} flex justify-center items-center`}>{year}年 {collapsedYears[year] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
                {!collapsedYears[year] && (
                  <div className="space-y-4 mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    {yrRecs.map(r => (
                      <div key={r.id} className={`${theme.bgCard} rounded-xl overflow-hidden shadow-sm border ${theme.borderMain} relative`}>
                        {r.recordType === 'dividend' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500" />}
                        <div className="p-4">
                          <div className="flex justify-between items-start mb-4">
                            <div><div className="flex items-center gap-2"><span className="text-sm font-bold">{r.symbol}</span><span className={`text-[10px] px-1.5 py-0.5 rounded border ${r.market === 'TW' ? 'border-blue-500/30 text-blue-500' : 'border-purple-500/30 text-purple-500'}`}>{r.market === 'TW' ? '台股' : '美股'}</span></div><h3 className="font-bold text-lg leading-tight mt-1">{r.name}</h3></div>
                            <span className="text-slate-400 text-xs">{r.date.slice(5).replace('-', '/')}</span>
                          </div>
                          <div className="flex justify-between items-end">
                            <div className="space-y-1">
                              <div className="text-sm font-medium"><span className={theme.textMuted}>{r.recordType === 'dividend' ? '類型: ' : '股數: '}</span>{r.recordType === 'dividend' ? '配息' : r.shares}</div>
                              <div className={`text-lg font-bold ${r.profit >= 0 ? 'text-red-500' : 'text-green-500'}`}>{r.profit >= 0 ? '+' : ''}{r.profit.toLocaleString()} <span className="text-xs">({r.profitRate.toFixed(2)}%)</span></div>
                            </div>
                            <div className="flex gap-1"><button onClick={() => handleEditClick(r)} className="text-slate-400 p-2"><Edit2 size={16} /></button><button onClick={() => handleDelete(r.id)} className="text-slate-400 p-2"><Trash2 size={16} /></button></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      <button onClick={() => { setEditingId(null); setIsModalOpen(true); }} className="fixed bottom-8 right-6 w-14 h-14 bg-emerald-500 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all z-30"><Plus size={32} /></button>

      {isModalOpen && (
        <div className={`fixed inset-0 ${theme.backdrop} backdrop-blur-sm z-50 flex items-center justify-center p-4`}>
          <div className={`${theme.bgCard} w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]`}>
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-black/5 font-bold"><span>紀錄細節</span><button onClick={closeAndResetModal} className="opacity-50">關閉</button></div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              {errorMsg && <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-3 rounded-lg text-xs flex gap-2"><AlertCircle size={14} className="shrink-0" />{errorMsg}</div>}
              <div className="grid grid-cols-2 gap-2">
                {['TW', 'Overseas'].map(m => <button key={m} type="button" onClick={() => setFormData({...formData, market: m})} className={`py-2 rounded-lg text-sm font-bold border ${formData.market === m ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500' : 'border-white/5 opacity-50'}`}>{m === 'TW' ? '台股' : '海外'}</button>)}
              </div>
              <div className="flex rounded-lg p-1 bg-black/10">
                {['trade', 'dividend'].map(t => <button key={t} type="button" onClick={() => setFormData({...formData, recordType: t})} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${formData.recordType === t ? (t === 'trade' ? 'bg-emerald-500' : 'bg-yellow-500') + ' text-white' : 'opacity-50'}`}>{t === 'trade' ? '交易' : '配息'}</button>)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input list="known-symbols" placeholder="代號" required className={`${theme.bgInput} rounded-lg p-3 outline-none`} value={formData.symbol} onChange={handleSymbolChange} />
                <datalist id="known-symbols">{Object.entries(knownStocks).map(([s, n]) => <option key={s} value={s}>{n}</option>)}</datalist>
                <input placeholder="名稱" required className={`${theme.bgInput} rounded-lg p-3 outline-none`} value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {formData.recordType === 'trade' && <input type="number" placeholder="股數" required className={`${theme.bgInput} rounded-lg p-3 outline-none`} value={formData.shares} onChange={e => setFormData({...formData, shares: e.target.value})} />}
                <input type="date" className={`${theme.bgInput} rounded-lg p-3 outline-none text-xs ${formData.recordType === 'dividend' ? 'col-span-2' : ''}`} value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
              </div>
              <div className="space-y-4 pt-4 border-t border-white/5">
                <input type="number" step="0.01" placeholder={formData.recordType === 'dividend' ? "股息總額" : "賣出總額"} required className={`${theme.bgInput} w-full rounded-lg p-3 outline-none text-xl font-mono`} value={formData.revenue} onChange={e => setFormData({...formData, revenue: e.target.value})} />
                {formData.recordType === 'trade' && <input type="number" step="0.01" placeholder="投資成本" required className={`${theme.bgInput} w-full rounded-lg p-3 outline-none text-xl font-mono`} value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} />}
              </div>
              <button type="submit" className={`w-full text-white font-bold py-4 rounded-xl shadow-lg active:scale-95 transition-all ${editingId ? 'bg-blue-500' : 'bg-emerald-500'}`}>{editingId ? '確認修改' : '儲存紀錄'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;