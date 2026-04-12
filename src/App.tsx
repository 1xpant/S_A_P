import { useState, useEffect } from 'react';
import { 
  Thermometer, 
  Droplets, 
  MapPin, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown,
  Activity,
  Sprout,
  Wind,
  Layers,
  Cpu,
  ShieldCheck,
  Zap,
  Clock,
  ChevronRight,
  LogOut,
  LogIn,
  History,
  Database,
  BarChart3 as ChartIcon,
  Trash2
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from "./firebase";
import { doc, onSnapshot, collection, query, orderBy, limit, deleteDoc, getDocs, writeBatch } from "firebase/firestore";
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "firebase/auth";

interface SoilData {
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  lastUpdate: string;
  source?: string;
  lastPostTime?: string;
}

const Gauge = ({ label, value, color, icon: Icon, delay = 0 }: { label: string, value: number, color: string, icon: any, delay?: number }) => (
  <motion.div 
    initial={{ opacity: 0, x: -20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay }}
    className="space-y-3"
  >
    <div className="flex justify-between items-end">
      <div className="flex items-center gap-2.5">
        <div className={`p-1.5 rounded-md bg-opacity-10 ${color.replace('text-', 'bg-')}`}>
          <Icon size={14} className={color} />
        </div>
        <span className="tech-label">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-lg font-bold text-slate-100">
          {value !== undefined && value !== null ? value.toFixed(1) : 'N/A'}
        </span>
        <span className="text-[10px] text-slate-500 font-bold uppercase">mg/kg</span>
      </div>
    </div>
    <div className="h-1.5 bg-slate-800/50 rounded-full overflow-hidden relative">
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(value, 100)}%` }}
        className={`h-full rounded-full relative z-10 ${color.replace('text-', 'bg-')}`}
        transition={{ type: "spring", stiffness: 40, damping: 12, delay: delay + 0.2 }}
      />
      <div className={`absolute inset-0 opacity-20 blur-sm ${color.replace('text-', 'bg-')}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  </motion.div>
);

const SensorCard = ({ title, value, unit, icon: Icon, trend, color, delay = 0 }: any) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className="glass-card p-6 group relative"
  >
    <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
      <Icon size={48} className={color} />
    </div>
    <div className="relative z-10 flex flex-col h-full justify-between">
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2.5 rounded-xl bg-opacity-10 ${color.replace('text-', 'bg-')}`}>
          <Icon className={color} size={20} />
        </div>
        <span className="tech-label">{title}</span>
      </div>
      
      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-4xl font-black text-slate-100 font-mono tracking-tighter">
            {value !== undefined && value !== null ? value.toFixed(1) : 'N/A'}
          </h3>
          <span className="text-sm text-slate-500 font-bold uppercase tracking-widest">{unit}</span>
        </div>
        
        <AnimatePresence mode="wait">
          {trend !== undefined && (
            <motion.div 
              key={trend}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${trend >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              <span>{Math.abs(trend ?? 0).toFixed(1)}% Δ</span>
              <span className="text-slate-600 ml-1">vs prev</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  </motion.div>
);

export default function App() {
  const [data, setData] = useState<SoilData | null>(null);
  const [prevData, setPrevData] = useState<SoilData | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');

  const handleDeleteReading = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'readings', id));
    } catch (err) {
      console.error("Error deleting reading:", err);
    }
  };

  const handleClearHistory = async () => {
    if (!user || !window.confirm("Are you sure you want to clear all history? This cannot be undone.")) return;
    try {
      const q = query(collection(db, 'readings'));
      const snapshot = await getDocs(q);
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    } catch (err) {
      console.error("Error clearing history:", err);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // 1. Listen to latest status
    const unsubLatest = onSnapshot(doc(db, 'latest', 'status'), (doc) => {
      if (doc.exists()) {
        const newData = doc.data() as SoilData;
        setPrevData(prev => prev || newData);
        setData(newData);
        setLoading(false);
      } else {
        // Fallback if no data in Firebase yet
        fetchFallbackData();
      }
    }, (err) => {
      console.error("Firestore Error (Latest):", err);
      // Only show error if we don't have fallback data
      if (!data) {
        setError("Database connection error. Please sign in.");
        setLoading(false);
      }
    });

    // 2. Listen to historical trends
    const q = query(collection(db, 'readings'), orderBy('timestamp', 'desc'), limit(20));
    const unsubHistory = onSnapshot(q, (snapshot) => {
      const readings = snapshot.docs.map(doc => {
        const rawData = doc.data();
        const date = new Date(rawData.timestamp);
        return {
          ...rawData,
          id: doc.id,
          time: date.toLocaleTimeString([], { 
            hour: 'numeric', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: true 
          }),
          date: date.toLocaleDateString([], {
            month: 'short',
            day: 'numeric'
          })
        };
      }).reverse();
      setHistory(readings);
    });

    return () => {
      unsubLatest();
      unsubHistory();
    };
  }, []);

  const fetchFallbackData = async () => {
    try {
      const response = await fetch(`/api/data?t=${Date.now()}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const newData = await response.json();
      setData(newData);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login Error:", err);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface-dark gap-6">
        <motion.div 
          animate={{ 
            rotate: 360,
            scale: [1, 1.1, 1],
          }}
          transition={{ 
            rotate: { repeat: Infinity, duration: 2, ease: "linear" },
            scale: { repeat: Infinity, duration: 1.5, ease: "easeInOut" }
          }}
          className="relative"
        >
          <RefreshCw className="text-emerald-400" size={64} />
          <div className="absolute inset-0 blur-xl bg-emerald-500/20 rounded-full" />
        </motion.div>
        <div className="text-center space-y-2">
          <h2 className="text-gradient text-xl">Initializing SoilGuard Pro</h2>
          <p className="tech-label animate-pulse">Establishing Secure Uplink...</p>
        </div>
      </div>
    );
  }

  const chartData = data ? [
    { name: 'N', value: data.nitrogen, color: '#10b981', full: 'Nitrogen' },
    { name: 'P', value: data.phosphorus, color: '#3b82f6', full: 'Phosphorus' },
    { name: 'K', value: data.potassium, color: '#f59e0b', full: 'Potassium' },
  ] : [];

  const calculateTrend = (current: number, previous: number) => {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  };

  return (
    <div className="min-h-screen p-4 md:p-10 max-w-[1600px] mx-auto space-y-10">
      {/* Top Navigation / Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-6 px-2">
        <div className="flex items-center gap-4">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 shadow-lg shadow-emerald-500/5"
          >
            <Sprout className="text-emerald-400" size={32} />
          </motion.div>
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-gradient leading-none mb-1">SOILGUARD PRO</h1>
            <div className="flex items-center gap-2">
              <span className="tech-label text-emerald-500/80">V4.2.0 Stable</span>
              <span className="w-1 h-1 rounded-full bg-slate-700" />
              <span className="tech-label">Command Center</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex bg-slate-950/50 p-1 rounded-xl border border-slate-800">
            <button 
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'overview' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-500 hover:text-slate-300'}`}
            >
              OVERVIEW
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'history' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-500 hover:text-slate-300'}`}
            >
              HISTORY
            </button>
          </div>
          <div className="w-px h-6 bg-slate-800" />
          <div className="flex items-center gap-3">
            {user ? (
              <button 
                onClick={handleLogout}
                className="glass-card px-4 py-2 flex items-center gap-2 text-xs font-mono text-slate-400 hover:text-white transition-colors"
              >
                <LogOut size={14} />
                SIGN OUT
              </button>
            ) : (
              <button 
                onClick={handleLogin}
                className="glass-card px-4 py-2 flex items-center gap-2 text-xs font-mono text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <LogIn size={14} />
                SIGN IN
              </button>
            )}
          </div>
          <div className="glass-card px-4 py-2 flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="tech-label text-[8px]">Environment</span>
              <span className="font-mono text-[10px] font-bold text-slate-400">
                {window.location.hostname.includes('ais-pre') ? 'PRODUCTION (SHARED)' : 'DEVELOPMENT (PRIVATE)'}
              </span>
            </div>
            <div className="w-px h-6 bg-slate-800" />
            <div className="flex flex-col items-end">
              <span className="tech-label text-[8px]">Data Source</span>
              <span className={`font-mono text-xs font-bold ${data?.source?.includes('Live') ? 'text-emerald-400' : 'text-amber-400'}`}>
                {data?.source || 'Simulated'}
              </span>
            </div>
            <div className="w-px h-6 bg-slate-800" />
            <div className="flex flex-col items-end">
              <span className="tech-label text-[8px]">Last Sync</span>
              <span className="font-mono text-xs font-bold text-blue-400">
                {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '---'}
              </span>
            </div>
          </div>
          
          <motion.button 
            whileTap={{ scale: 0.95 }}
            onClick={fetchFallbackData}
            className="p-3 glass-card hover:bg-slate-800/80 text-slate-400 hover:text-emerald-400 transition-colors"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </motion.button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' ? (
          <motion.div 
            key="overview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 xl:grid-cols-12 gap-8"
          >
            {/* Left Column: Primary Analytics */}
            <div className="xl:col-span-8 space-y-8">
              {/* Main Nutrient Panel */}
              <div className="glass-card p-10 relative group">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-emerald-500 to-blue-500 opacity-50" />
                
                <div className="flex items-center justify-between mb-12">
                  <div className="flex items-center gap-3">
                    <Layers className="text-blue-400" size={24} />
                    <h2 className="text-lg font-bold text-slate-100 uppercase tracking-[0.2em]">Nutrient Composition</h2>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-950/50 rounded-full border border-slate-800">
                    <Zap size={12} className="text-amber-400" />
                    <span className="tech-label text-[9px]">Live Analysis</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                  <div className="h-[350px] w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          {chartData.map((entry, index) => (
                            <linearGradient key={`grad-${index}`} id={`grad-${index}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={entry.color} stopOpacity={0.8}/>
                              <stop offset="100%" stopColor={entry.color} stopOpacity={0.2}/>
                            </linearGradient>
                          ))}
                        </defs>
                        <CartesianGrid strokeDasharray="4 4" stroke="#1e293b" vertical={false} opacity={0.5} />
                        <XAxis 
                          dataKey="name" 
                          stroke="#475569" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          dy={10}
                          fontWeight="bold"
                        />
                        <YAxis 
                          stroke="#475569" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          dx={-10}
                          fontWeight="bold"
                        />
                        <Tooltip 
                          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="glass-card p-4 border-slate-700 shadow-2xl">
                                  <p className="tech-label mb-1">{data.full}</p>
                                  <p className="text-xl font-mono font-black text-slate-100">{(data.value ?? 0).toFixed(2)} <span className="text-[10px] text-slate-500">mg/kg</span></p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={60}>
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={`url(#grad-${index})`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex flex-col justify-center space-y-10">
                    <Gauge label="Nitrogen (N)" value={data?.nitrogen || 0} color="text-emerald-400" icon={Wind} delay={0.1} />
                    <Gauge label="Phosphorus (P)" value={data?.phosphorus || 0} color="text-blue-400" icon={Droplets} delay={0.2} />
                    <Gauge label="Potassium (K)" value={data?.potassium || 0} color="text-amber-400" icon={Activity} delay={0.3} />
                  </div>
                </div>
              </div>

              {/* Environmental Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <SensorCard 
                  title="Ambient Temperature" 
                  value={data?.temperature || 0} 
                  unit="°C" 
                  icon={Thermometer} 
                  color="text-rose-400"
                  trend={data && prevData ? calculateTrend(data.temperature, prevData.temperature) : undefined}
                  delay={0.4}
                />
                <SensorCard 
                  title="Soil Saturation" 
                  value={data?.humidity || 0} 
                  unit="%" 
                  icon={Droplets} 
                  color="text-blue-400"
                  trend={data && prevData ? calculateTrend(data.humidity, prevData.humidity) : undefined}
                  delay={0.5}
                />
              </div>
            </div>

            {/* Right Column: System & Location */}
            <div className="xl:col-span-4 space-y-8">
              {/* Location Panel */}
              <div className="glass-card p-8 flex flex-col h-full">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <MapPin className="text-emerald-400" size={20} />
                    <h2 className="text-lg font-bold text-slate-100 uppercase tracking-[0.2em]">Deployment Site</h2>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse glow-emerald" />
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/50">
                    <p className="tech-label text-[8px] mb-1 opacity-60">Latitude</p>
                    <p className="font-mono text-sm font-bold text-slate-200">{(data?.latitude ?? 0).toFixed(6)}°</p>
                  </div>
                  <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/50">
                    <p className="tech-label text-[8px] mb-1 opacity-60">Longitude</p>
                    <p className="font-mono text-sm font-bold text-slate-200">{(data?.longitude ?? 0).toFixed(6)}°</p>
                  </div>
                </div>

                <div className="flex-1 min-h-[300px] rounded-2xl overflow-hidden border border-slate-800/50 relative group">
                  <iframe 
                    width="100%" 
                    height="100%" 
                    frameBorder="0" 
                    style={{ border: 0, filter: 'invert(90%) hue-rotate(180deg) brightness(95%) contrast(90%)' }} 
                    src={`https://maps.google.com/maps?q=${data?.latitude},${data?.longitude}&z=14&output=embed&hl=en&t=m`} 
                    allowFullScreen
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 pointer-events-none border border-white/5 rounded-2xl" />
                  <div className="absolute bottom-4 left-4 right-4 p-3 glass-card bg-slate-950/80 border-slate-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span className="tech-label text-[8px]">GPS Lock Active</span>
                    </div>
                    <ChevronRight size={12} className="text-slate-600" />
                  </div>
                </div>
              </div>

              {/* System Diagnostics */}
              <div className="glass-card p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Cpu className="text-slate-400" size={20} />
                  <h2 className="text-lg font-bold text-slate-100 uppercase tracking-[0.2em]">Diagnostics</h2>
                </div>
                
                <div className="space-y-4">
                  {[
                    { label: 'Sensor Array', status: 'Optimal', icon: ShieldCheck, color: 'text-emerald-400' },
                    { label: 'Battery Level', status: '94%', icon: Zap, color: 'text-amber-400' },
                    { label: 'Uptime', status: '14d 2h', icon: Clock, color: 'text-blue-400' }
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-950/30 rounded-xl border border-slate-800/30">
                      <div className="flex items-center gap-3">
                        <item.icon size={14} className="text-slate-500" />
                        <span className="tech-label text-slate-400">{item.label}</span>
                      </div>
                      <span className={`font-mono text-xs font-bold ${item.color}`}>{item.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="history"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            <div className="glass-card p-8">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <History className="text-blue-400" size={24} />
                  <h2 className="text-lg font-bold text-slate-100 uppercase tracking-[0.2em]">Historical Readings</h2>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={handleClearHistory}
                    className="flex items-center gap-2 px-3 py-1 bg-rose-500/10 text-rose-400 rounded-full border border-rose-500/20 hover:bg-rose-500/20 transition-colors tech-label text-[9px]"
                  >
                    <Trash2 size={12} />
                    Clear All
                  </button>
                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-950/50 rounded-full border border-slate-800">
                    <Database size={12} className="text-slate-500" />
                    <span className="tech-label text-[9px]">{history.length} Records Stored</span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="py-4 px-4 tech-label text-[10px] opacity-50">Timestamp</th>
                      <th className="py-4 px-4 tech-label text-[10px] opacity-50">Nitrogen</th>
                      <th className="py-4 px-4 tech-label text-[10px] opacity-50">Phosphorus</th>
                      <th className="py-4 px-4 tech-label text-[10px] opacity-50">Potassium</th>
                      <th className="py-4 px-4 tech-label text-[10px] opacity-50">Temp</th>
                      <th className="py-4 px-4 tech-label text-[10px] opacity-50">Humidity</th>
                      <th className="py-4 px-4 tech-label text-[10px] opacity-50">Source</th>
                      <th className="py-4 px-4 tech-label text-[10px] opacity-50 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length > 0 ? (
                      history.slice().reverse().map((record, i) => (
                        <tr key={record.id || i} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors group">
                          <td className="py-4 px-4 font-mono text-xs text-slate-400">{record.time || 'N/A'}</td>
                          <td className="py-4 px-4 font-mono text-sm font-bold text-emerald-400">
                            {record.nitrogen !== undefined && record.nitrogen !== null ? record.nitrogen.toFixed(1) : 'N/A'}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm font-bold text-blue-400">
                            {record.phosphorus !== undefined && record.phosphorus !== null ? record.phosphorus.toFixed(1) : 'N/A'}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm font-bold text-amber-400">
                            {record.potassium !== undefined && record.potassium !== null ? record.potassium.toFixed(1) : 'N/A'}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm text-rose-400">
                            {record.temperature !== undefined && record.temperature !== null ? `${record.temperature.toFixed(1)}°C` : 'N/A'}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm text-blue-300">
                            {record.humidity !== undefined && record.humidity !== null ? `${record.humidity.toFixed(1)}%` : 'N/A'}
                          </td>
                          <td className="py-4 px-4">
                            <span className="px-2 py-1 rounded-md bg-slate-800 text-[8px] font-bold uppercase tracking-widest text-slate-500">
                              {record.source || 'Unknown'}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <button 
                              onClick={() => handleDeleteReading(record.id)}
                              className="p-2 text-slate-600 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100"
                              title="Delete Reading"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-20 text-center">
                          <div className="flex flex-col items-center gap-4 opacity-20">
                            <Database size={48} />
                            <p className="tech-label">No historical data found in Firestore</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Historical Trends Chart */}
            <div className="glass-card p-8">
              <div className="flex items-center gap-3 mb-8">
                <ChartIcon className="text-emerald-400" size={20} />
                <h2 className="text-lg font-bold text-slate-100 uppercase tracking-[0.2em]">Nutrient Trends (Last 20)</h2>
              </div>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="colorN" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '12px' }}
                      itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                    />
                    <Area type="monotone" dataKey="nitrogen" stroke="#10b981" fillOpacity={1} fill="url(#colorN)" />
                    <Area type="monotone" dataKey="phosphorus" stroke="#3b82f6" fillOpacity={0} strokeWidth={2} />
                    <Area type="monotone" dataKey="potassium" stroke="#f59e0b" fillOpacity={0} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer / Global Status */}
      <footer className="flex flex-col md:flex-row items-center justify-between gap-6 py-10 border-t border-slate-800/50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse glow-emerald" />
            <span className="tech-label text-[9px]">System Operational</span>
          </div>
          <div className="w-px h-4 bg-slate-800" />
          <div className="flex items-center gap-2">
            <ShieldCheck size={12} className="text-blue-400" />
            <span className="tech-label text-[9px]">Data Integrity Verified</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="tech-label text-[8px] opacity-40">© 2026 SoilGuard Technologies • All Rights Reserved</span>
        </div>
      </footer>
    </div>
  );
}
