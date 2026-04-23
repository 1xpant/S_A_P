import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { GoogleGenAI } from "@google/genai";
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
  History as HistoryIcon,
  Database,
  BarChart as ChartIcon,
  Trash2,
  BrainCircuit,
  FileText,
  Download,
  AlertTriangle,
  ArrowRight,
  Info,
  Plus,
  MessageSquare,
  Activity as PulseIcon,
  Target as TargetIcon,
  Sparkles,
  Send,
  ChevronDown,
  PlusCircle,
  MoreVertical,
  Calendar,
  Gauge as LucideGauge,
  X,
  Settings,
  Hand
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
  Area,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth, firebaseConfig } from "./firebase";
import { doc, onSnapshot, collection, query, orderBy, limit, deleteDoc, getDocs, writeBatch, addDoc, serverTimestamp, getDocFromServer, setDoc, getDoc } from "firebase/firestore";
import { signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut, onAuthStateChanged, getRedirectResult } from "firebase/auth";
import { analyzeSoilData, scoutCropProfile } from "./services/geminiService";
import Markdown from 'react-markdown';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    providerInfo: { providerId: string; displayName: string | null; email: string | null; }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
      })) || []
    }
  };
  console.error("Firestore Error:", errInfo);
  // Do not throw, just log and return null for the caller to handle
  return null;
}

async function testConnection() {
  // Moved to useEffect within App component
}

testConnection();

interface SoilData {
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  timestamp: string;
  source?: string;
  lastPostTime?: string;
}

interface Fertilizer {
  name: string;
  n: number;
  p: number;
  k: number;
  quantity: number;
  unit: string;
}

interface CropProfile {
  id: string;
  name: string;
  category: "Vegetable" | "Fruit" | "Grain" | "Other";
  idealNPK: { n: number; p: number; k: number };
  idealTemp: { min: number; max: number };
  idealHumidity: { min: number; max: number };
  description: string;
  difficulty?: number; // 1-5
  managementLevel?: string; // Low, Medium, High
  daysToHarvest?: number;
  waterNeeds?: string; // Low, Medium, High
  growthStages?: GrowthStage[];
}

interface GrowthStage {
  name: string;
  durationDays: number;
  targets: {
    n: number;
    p: number;
    k: number;
    temp: { min: number; max: number };
  };
}

interface FarmZone {
  id: string;
  name: string;
  activeCropId?: string;
  currentStageIndex: number;
  plantedDate?: string;
  health: number;
  size: number; // in sq meters
}

interface FieldAlert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
  read: boolean;
}

interface SystemStatus {
  battery: number;
  wifi: number;
  uptime: string;
  lastPing: string;
}

const CROP_PROFILES: CropProfile[] = [];

const FALLBACK_PROFILE: CropProfile = {
  id: 'baseline',
  name: 'No Target Set',
  category: 'Other',
  idealNPK: { n: 0, p: 0, k: 0 },
  idealTemp: { min: 0, max: 50 },
  idealHumidity: { min: 0, max: 100 },
  description: 'Add a plant profile using the AI Intelligence Scout to begin monitoring.',
  difficulty: 1,
  managementLevel: 'Low'
};

const GROWTH_STAGES_TEMPLATE: GrowthStage[] = [
  { name: 'Seedling', durationDays: 14, targets: { n: 50, p: 30, k: 30, temp: { min: 18, max: 24 } } },
  { name: 'Vegetative', durationDays: 30, targets: { n: 100, p: 40, k: 40, temp: { min: 20, max: 28 } } },
  { name: 'Flowering', durationDays: 20, targets: { n: 40, p: 80, k: 80, temp: { min: 18, max: 25 } } },
  { name: 'Harvest', durationDays: 10, targets: { n: 20, p: 20, k: 20, temp: { min: 15, max: 22 } } },
];

interface AIRecommendation {
  action: string;
  reason: string;
  priority: "High" | "Medium" | "Low";
  category: "Nutrients" | "Irrigation" | "Climate";
  suggestedFertilizer?: string;
  stockPrediction?: string;
}

const validateValue = (val: any) => {
  if (val === undefined || val === null || val === 65535) return undefined;
  return Number(val);
};

const formatForAI = (val: any) => {
  const v = validateValue(val);
  if (v === undefined) return "SENSOR_NULL (Disconnected or Error)";
  return v === 0 ? "0 (Measured Actual Zero)" : v.toString();
};

const formatTemperature = (c: number | undefined, unit: 'C' | 'F' | 'both') => {
  if (c === undefined || c === null) return '---';
  const f = (c * 9/5) + 32;
  if (unit === 'C') return `${c.toFixed(1)}°C`;
  if (unit === 'F') return `${f.toFixed(1)}°F`;
  return `${c.toFixed(1)}°C / ${f.toFixed(1)}°F`;
};

const Gauge = ({ label, value, color, icon: Icon, delay = 0, unit = 'mg/kg' }: { label: string, value: number | undefined, color: string, icon: any, delay?: number, unit?: string }) => (
  <motion.div 
    initial={{ opacity: 0, x: -20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay }}
    className="space-y-2.5"
  >
    <div className="flex justify-between items-end px-0.5">
      <div className="flex items-center gap-1.5">
        <Icon size={12} className="text-neutral-500 opacity-80" />
        <span className="tech-label text-[8px] whitespace-nowrap">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-display text-base font-medium text-neutral-100">
          {value !== undefined ? value.toFixed(1) : '---'}
        </span>
        <span className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">{unit}</span>
      </div>
    </div>
    <div className="h-1 bg-neutral-800/20 rounded-full overflow-hidden backdrop-blur-sm">
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(value || 0, 100)}%` }}
        className={`h-full rounded-full ${color.replace('text-', 'bg-')} shadow-[0_0_10px_rgba(0,0,0,0.05)]`}
        transition={{ type: "spring", stiffness: 40, damping: 12, delay: delay + 0.2 }}
      />
    </div>
  </motion.div>
);

const SensorCard = ({ title, value, unit, icon: Icon, trend, color, delay = 0, isCircleMode = false }: any) => (
  <motion.div 
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className={`glass-card p-6 group h-full ${isCircleMode ? 'rounded-full aspect-square flex items-center justify-center' : ''}`}
  >
    <div className={`flex flex-col h-full justify-between gap-5 ${isCircleMode ? 'items-center text-center' : ''}`}>
      <div className={`flex items-center justify-between w-full ${isCircleMode ? 'flex-col gap-2' : ''}`}>
        <div className="flex items-center gap-2">
          <Icon className="text-neutral-500 group-hover:text-emerald-500 transition-all duration-300" size={14} />
          <span className="tech-label text-[8px]">{title}</span>
        </div>
        {trend !== undefined && !isCircleMode && (
          <div className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${trend >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
            {trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            <span>{Math.abs(trend ?? 0).toFixed(1)}%</span>
          </div>
        )}
      </div>
      
      <div className={`flex items-baseline gap-1.5 ${isCircleMode ? 'flex-col items-center gap-0' : ''}`}>
        <h3 className={`${isCircleMode ? 'text-xl' : 'text-3xl'} font-display font-medium text-neutral-100 tracking-tight leading-none`}>
          {typeof value === 'string' ? value : (value !== undefined && value !== null ? value.toFixed(1) : '---')}
        </h3>
        <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-[0.1em]">{unit}</span>
      </div>
    </div>
  </motion.div>
);

const geoUrl = "https://raw.githubusercontent.com/lotusms/world-map-data/main/world.json";

// Create custom pulse icon
const createPulseIcon = () => {
  return L.divIcon({
    className: 'custom-pulse-icon',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-6 h-6 bg-emerald-500/20 rounded-full animate-ping"></div>
        <div class="w-3 h-3 bg-emerald-500 rounded-full border-2 border-white shadow-lg"></div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

const MapController = ({ center }: { center: [number, number] }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
};

const FieldMap = ({ history }: { history: any[] }) => {
  const points = useMemo(() => {
    return history
      .filter(p => p.latitude !== undefined && p.longitude !== undefined)
      .map(p => ({
        name: p.source || "Sensor Node",
        coordinates: [p.latitude, p.longitude] as [number, number],
        id: p.id,
        data: p
      }));
  }, [history]);

  const latestPos = points[0]?.coordinates || [40, -100];
  const zoomLevel = points.length > 0 ? 18 : 3;

  return (
    <div className="glass-card p-0 h-full relative overflow-hidden flex flex-col min-h-[400px]">
      <div className="p-8 pb-0 flex items-center justify-between absolute top-0 left-0 right-0 z-[10] pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-neutral-900/80 backdrop-blur-md rounded-xl border border-white/5 pointer-events-auto">
            <MapPin className="text-emerald-500" size={20} />
          </div>
          <div className="p-2 px-4 bg-neutral-900/80 backdrop-blur-md rounded-xl border border-white/5 pointer-events-auto">
            <h2 className="text-sm font-display font-medium text-white tracking-tight uppercase">Spatial Intelligence</h2>
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="p-2 px-4 bg-neutral-900/80 backdrop-blur-md rounded-xl border border-white/5 flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="tech-label text-emerald-500">Live Grid</span>
          </div>
        </div>
      </div>
      
      <div className="flex-grow">
        <MapContainer 
          center={latestPos} 
          zoom={zoomLevel} 
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
            subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
          />
          <MapController center={latestPos} />
          {points.map(({ id, name, coordinates, data }) => (
            <Marker 
              key={id} 
              position={coordinates}
              icon={createPulseIcon()}
            >
              <Popup>
                <div className="p-3 min-w-[180px] bg-neutral-950 text-white rounded-2xl border border-white/5 backdrop-blur-3xl">
                  <p className="tech-label text-[7px] mb-2 text-emerald-500">{name}</p>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div className="bg-neutral-900/50 p-2 rounded-lg">
                      <p className="text-[7px] text-neutral-500 uppercase font-black mb-1">Temperature</p>
                      <p className="text-sm font-bold text-neutral-100">{data.temperature?.toFixed(1)}°C</p>
                    </div>
                    <div className="bg-neutral-900/50 p-2 rounded-lg">
                      <p className="text-[7px] text-neutral-500 uppercase font-black mb-1">Humidity</p>
                      <p className="text-sm font-bold text-neutral-100">{data.humidity?.toFixed(0)}%</p>
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div className="p-6 bg-neutral-900/50 backdrop-blur-sm border-t border-white/5 z-[10]">
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-[8px] text-neutral-500 uppercase font-bold tracking-widest mb-1">Active Cluster</span>
            <span className="text-xs font-medium text-white">
              {points.length > 0 ? `${points.length} Localized Nodes` : "Global Overview"}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[8px] text-neutral-500 uppercase font-bold tracking-widest mb-1">Scale Logic</span>
            <span className="text-xs font-medium text-emerald-500">Auto-Center Active</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface WidgetConfig {
  id: string;
  title: string;
  colSpan: number; // 1-12
  rowSpan: number; // 1-12
  order: number;
  visible: boolean;
}

const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: 'field_map', title: 'Spatial Intelligence', colSpan: 12, rowSpan: 8, order: 0, visible: true },
  { id: 'nutrient_composition', title: 'Nutrient Composition', colSpan: 8, rowSpan: 6, order: 1, visible: true },
  { id: 'sensor_gauges', title: 'Sensor Gauges', colSpan: 4, rowSpan: 6, order: 2, visible: true },
  { id: 'environmental_grid', title: 'Environmental Grid', colSpan: 6, rowSpan: 4, order: 3, visible: true },
  { id: 'weather_yield', title: 'Weather & Yield', colSpan: 6, rowSpan: 4, order: 4, visible: true },
  { id: 'growth_timeline', title: 'Growth Timeline', colSpan: 12, rowSpan: 4, order: 5, visible: true },
  { id: 'health_score', title: 'Health Score', colSpan: 4, rowSpan: 4, order: 6, visible: true },
  { id: 'nutrient_balance', title: 'Nutrient Balance', colSpan: 4, rowSpan: 4, order: 7, visible: true },
  { id: 'diagnostics', title: 'Intelligence Uplink', colSpan: 4, rowSpan: 5, order: 8, visible: true },
  { id: 'controls', title: 'Control Center', colSpan: 4, rowSpan: 4, order: 9, visible: true },
  { id: 'active_alerts', title: 'Active Alerts', colSpan: 6, rowSpan: 4, order: 10, visible: true },
  { id: 'predictive_alerts', title: 'Predictive Alerts', colSpan: 6, rowSpan: 4, order: 11, visible: true },
  { id: 'crop_profile_card', title: 'Crop Profile', colSpan: 6, rowSpan: 6, order: 12, visible: true },
  { id: 'fertilizer_calculator', title: 'Fertilizer Calculator', colSpan: 6, rowSpan: 6, order: 13, visible: true },
];

export default function App() {
  const [data, setData] = useState<SoilData | null>(null);
  const [prevData, setPrevData] = useState<SoilData | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'intelligence' | 'logbook' | 'settings'>('overview');
  
  const INITIAL_TABS = [
    { id: 'overview', label: 'Overview', icon: PulseIcon },
    { id: 'history', label: 'History', icon: HistoryIcon },
    { id: 'intelligence', label: 'AI Intel', icon: BrainCircuit },
    { id: 'logbook', label: 'Logbook', icon: FileText },
    { id: 'settings', label: 'Configuration', icon: Cpu }
  ];

  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [isEditingLayout, setIsEditingLayout] = useState(false);
  const [layout, setLayout] = useState<WidgetConfig[]>(DEFAULT_LAYOUT);
  const [originalLayout, setOriginalLayout] = useState<WidgetConfig[]>([...DEFAULT_LAYOUT]);
  const [originalTabs, setOriginalTabs] = useState<any[]>([...INITIAL_TABS]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLoginTroubleshooter, setShowLoginTroubleshooter] = useState(false);
  const [firebaseConnected, setFirebaseConnected] = useState<boolean | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
    { role: 'model', text: "Systems online. I am your SoilGuard AI Assistant. How can I help you optimize your field today?" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  
  const [thresholds, setThresholds] = useState({
    nitrogen: { min: 20, max: 80 },
    phosphorus: { min: 20, max: 80 },
    potassium: { min: 20, max: 80 },
    temp: { min: 15, max: 35 },
    humidity: { min: 30, max: 80 }
  });
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [inventory, setInventory] = useState<Fertilizer[]>([
    { name: "NPK 10-10-10", n: 10, p: 10, k: 10, quantity: 50, unit: "kg" },
    { name: "Urea", n: 46, p: 0, k: 0, quantity: 20, unit: "kg" },
    { name: "Potash", n: 0, p: 0, k: 60, quantity: 15, unit: "kg" },
    { name: "Super Phosphate", n: 0, p: 20, k: 0, quantity: 30, unit: "kg" }
  ]);
  const [logs, setLogs] = useState<any[]>([]);
  const [newLog, setNewLog] = useState("");
  const [logType, setLogType] = useState<'observation' | 'action' | 'alert'>('observation');

  const [weather, setWeather] = useState({ temp: 24, condition: 'Sunny', humidity: 45 });

  // Settings State
  const [tempUnit, setTempUnit] = useState<'C' | 'F' | 'both'>('C');
  const [isCircleMode, setIsCircleMode] = useState(false);
  const [isEmergencyStop, setIsEmergencyStop] = useState(false);
  
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  const [selectedCrop, setSelectedCrop] = useState<CropProfile>(FALLBACK_PROFILE);
  const [customCrops, setCustomCrops] = useState<CropProfile[]>([]);
  const [isScouting, setIsScouting] = useState(false);
  const [showAddCropModal, setShowAddCropModal] = useState(false);
  const [showCropDropdown, setShowCropDropdown] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState<CropProfile | null>(null);
  const [newCropName, setNewCropName] = useState("");

  // Pro State
  const [zones, setZones] = useState<FarmZone[]>([
    { id: 'zone-a', name: 'West Orchard', health: 92, size: 450, currentStageIndex: 1, activeCropId: 'baseline' },
    { id: 'zone-b', name: 'High-Tech Greenhouse', health: 98, size: 200, currentStageIndex: 0, activeCropId: 'baseline' },
    { id: 'zone-c', name: 'Open Ridge', health: 78, size: 800, currentStageIndex: 2, activeCropId: 'baseline' },
  ]);
  const [activeZoneId, setActiveZoneId] = useState('zone-a');
  const [alerts, setAlerts] = useState<FieldAlert[]>([]);
  const [notifications, setNotifications] = useState<number>(0);
  const [theme, setTheme] = useState<'midnight' | 'forest' | 'brutal'>('midnight');
  const [isIrrigationManual, setIsIrrigationManual] = useState(false);
  const [pumpStatus, setPumpStatus] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    battery: 88,
    wifi: -62,
    uptime: '14d 6h 22m',
    lastPing: new Date().toISOString()
  });

  useEffect(() => {
    // Simulate weather fetch based on location
    const timer = setTimeout(() => {
      setWeather({
        temp: Math.floor(Math.random() * 10) + 20,
        condition: ['Sunny', 'Partly Cloudy', 'Overcast'][Math.floor(Math.random() * 3)],
        humidity: Math.floor(Math.random() * 20) + 40
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [data?.latitude]);

  useEffect(() => {
    // 1. Listen to custom crops
    const qCrops = query(collection(db, 'custom_crops'));
    const unsubscribe = onSnapshot(qCrops, (snapshot) => {
      const crops = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as CropProfile[];
      setCustomCrops(crops);
      
      // Auto-select first crop if current is fallback
      if (selectedCrop.id === 'baseline' && crops.length > 0) {
        setSelectedCrop(crops[0]);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'custom_crops');
    });
    return () => unsubscribe();
  }, []);

  const allCrops = [...CROP_PROFILES, ...customCrops];

  const handleAddCrop = async () => {
    if (!newCropName.trim() || !user) {
      if (!user) setStatusMessage({ text: "Please sign in to add custom crops", type: 'error' });
      return;
    }
    setIsScouting(true);
    try {
      const profile = await scoutCropProfile(newCropName);
      await addDoc(collection(db, 'custom_crops'), {
        ...profile,
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
      setShowAddCropModal(false);
      setNewCropName("");
      setStatusMessage({ text: `Expert intelligence retrieved for ${profile.name}!`, type: 'success' });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: "Intelligence scouting failed. Please try a different name.", type: 'error' });
    } finally {
      setIsScouting(false);
    }
  };

  const handleDeleteCrop = async (e: React.MouseEvent, cropId: string) => {
    e.stopPropagation();
    if (!user) return;
    
    try {
      await deleteDoc(doc(db, 'custom_crops', cropId));
      setStatusMessage({ text: "Crop profile removed from your database", type: 'info' });
      
      // If the deleted crop was selected, reset to fallback
      if (selectedCrop.id === cropId) {
        setSelectedCrop(FALLBACK_PROFILE);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `custom_crops/${cropId}`);
      setStatusMessage({ text: "Failed to delete crop profile", type: 'error' });
    }
  };

  const calculateHealthScore = (d: SoilData) => {
    if (!d) return 0;
    const n = validateValue(d.nitrogen);
    const p = validateValue(d.phosphorus);
    const k = validateValue(d.potassium);
    const t = validateValue(d.temperature);
    const h = validateValue(d.humidity);

    if (n === undefined || p === undefined || k === undefined) return 0;

    // Accuracy weights: 100 total
    // We compare against the selected crop's ideal NPK
    const calcVariance = (val: number, target: number) => {
      const diff = Math.abs(val - target);
      if (diff === 0) return 20;
      const pct = (diff / target) * 100;
      return Math.max(0, 20 - (pct / 5)); // Lose 1 point per 5% deviation
    };

    const nScore = calcVariance(n, selectedCrop.idealNPK.n);
    const pScore = calcVariance(p, selectedCrop.idealNPK.p);
    const kScore = calcVariance(k, selectedCrop.idealNPK.k);
    
    const tScore = t !== undefined && t >= selectedCrop.idealTemp.min && t <= selectedCrop.idealTemp.max ? 20 : 10;
    const hScore = h !== undefined && h >= selectedCrop.idealHumidity.min && h <= selectedCrop.idealHumidity.max ? 20 : 10;
    
    return Math.round(nScore + pScore + kScore + tScore + hScore);
  };

  const getFertilizerAdvice = () => {
    const d = data;
    if (!d) return [];
    
    const nVal = validateValue(d.nitrogen) || 0;
    const pVal = validateValue(d.phosphorus) || 0;
    const kVal = validateValue(d.potassium) || 0;

    const nGap = Math.max(0, selectedCrop.idealNPK.n - nVal);
    const pGap = Math.max(0, selectedCrop.idealNPK.p - pVal);
    const kGap = Math.max(0, selectedCrop.idealNPK.k - kVal);

    if (nGap + pGap + kGap === 0) return [];

    return inventory.map(f => {
      // Calculate how much of this fertilizer is needed to fill the LARGEST gap
      const nSteps = f.n > 0 ? nGap / (f.n / 100) : 0;
      const pSteps = f.p > 0 ? pGap / (f.p / 100) : 0;
      const kSteps = f.k > 0 ? kGap / (f.k / 100) : 0;
      
      const amountNeeded = Math.max(nSteps, pSteps, kSteps) / 1000; // Convert to kg/unit approx
      
      return {
        ...f,
        amountNeeded: parseFloat(amountNeeded.toFixed(2)),
        score: (f.n > 0 && nGap > 0 ? 1 : 0) + (f.p > 0 && pGap > 0 ? 1 : 0) + (f.k > 0 && kGap > 0 ? 1 : 0)
      };
    }).filter(f => f.amountNeeded > 0).sort((a, b) => b.score - a.score);
  };

  const runAnalysis = async () => {
    if (!data) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not defined in the environment.");
      }
      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const inventoryContext = inventory
        .map(f => `${f.name} (N:${f.n} P:${f.p} K:${f.k}, Stock: ${f.quantity}${f.unit})`)
        .join(", ");

      const prompt = `
        As an advanced agricultural AI, analyze this soil data and fertilizer inventory relative to the TARGET CROP.
        
        TARGET CROP: "${selectedCrop.name}" (${selectedCrop.category})
        Ideal NPK: N:${selectedCrop.idealNPK.n} P:${selectedCrop.idealNPK.p} K:${selectedCrop.idealNPK.k}
        Ideal Temp: ${selectedCrop.idealTemp.min}-${selectedCrop.idealTemp.max}°C
        Ideal Humidity: ${selectedCrop.idealHumidity.min}-${selectedCrop.idealHumidity.max}%
        
        CRITICAL SENSOR DIFFERENTIATION:
        - "SENSOR_NULL": The sensor is disconnected or returning an error. Mention this as a hardware issue.
        - "0": The sensor is connected and successfully measured a value of zero. This is a real data point.
        
        Soil Data:
        - Nitrogen: ${formatForAI(data.nitrogen)} mg/kg
        - Phosphorus: ${formatForAI(data.phosphorus)} mg/kg
        - Potassium: ${formatForAI(data.potassium)} mg/kg
        - Temp: ${formatForAI(data.temperature)}°C, Humidity: ${formatForAI(data.humidity)}%
        
        Inventory: [${inventoryContext}]
        
        Task:
        1. Provide 3 actionable recommendations.
        2. If a nutrient is low, suggest the BEST fertilizer from my inventory.
        3. Predict when stock might run out.
        
        CRITICAL: 
        - DO NOT USE ASTERISKS (*) IN YOUR OUTPUT FOR BOLDING OR LISTS.
        - Return ONLY a JSON object matching this schema:
        { "recommendations": [{ "action": string, "reason": string, "priority": "High"|"Medium"|"Low", "category": "Nutrients"|"Irrigation"|"Climate", "suggestedFertilizer": string, "stockPrediction": string }] }
      `;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      
      const cleanJson = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleanJson);
      
      setRecommendations(parsed.recommendations);
      setAiAnalysis("Analysis complete. See recommendations below.");
    } catch (err) {
      console.error("AI Analysis failed:", err);
      setError(err instanceof Error ? err.message : "AI Analysis temporarily unavailable.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportToCSV = () => {
    const headers = ["Timestamp", "Nitrogen", "Phosphorus", "Potassium", "Temperature", "Humidity", "Source"];
    const rows = history.map(r => [
      r.timestamp,
      r.nitrogen,
      r.phosphorus,
      r.potassium,
      r.temperature,
      r.humidity,
      r.source
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `soil_data_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
  };

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newLog.trim()) return;
    const path = 'logs';
    try {
      await addDoc(collection(db, path), {
        content: newLog,
        type: logType,
        timestamp: new Date().toISOString(),
        userId: user.uid
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, path));
      setNewLog("");
    } catch (err) {
      console.error("Error adding log:", err);
    }
  };

  const handleDeleteReading = async (id: string) => {
    if (!user) return;
    const path = `readings/${id}`;
    try {
      await deleteDoc(doc(db, 'readings', id)).catch(err => handleFirestoreError(err, OperationType.DELETE, path));
    } catch (err) {
      console.error("Error deleting reading:", err);
    }
  };

  const formatSyncTime = (timestamp: any) => {
    if (!timestamp) return '---';
    try {
      // Handle Firestore Timestamp or ISO string
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      if (isNaN(date.getTime())) return '---';
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) {
      return '---';
    }
  };

  const startEditing = () => {
    setOriginalLayout(JSON.parse(JSON.stringify(layout)));
    setOriginalTabs([...tabs]); // Fix: Shallow copy to preserve React components/icons
    setIsEditingLayout(true);
  };

  const cancelEditing = () => {
    setLayout(originalLayout);
    setTabs(originalTabs);
    setIsEditingLayout(false);
  };

  const PRESETS = [
    { name: 'Square', cols: 4, rows: 4 },
    { name: 'Wide', cols: 8, rows: 4 },
    { name: 'Tall', cols: 4, rows: 8 },
    { name: 'Big Square', cols: 8, rows: 8 },
    { name: 'Big Wide', cols: 12, rows: 6 },
  ];

  const cycleWidgetSize = (id: string) => {
    setLayout(prev => prev.map(w => {
      if (w.id === id) {
        const currentPresetIndex = PRESETS.findIndex(p => p.cols === w.colSpan && p.rows === w.rowSpan);
        const nextPresetIndex = (currentPresetIndex + 1) % PRESETS.length;
        const nextPreset = PRESETS[nextPresetIndex];
        return { ...w, colSpan: nextPreset.cols, rowSpan: nextPreset.rows };
      }
      return w;
    }));
  };

  const snapToSize = (id: string, deltaX: number, deltaY: number) => {
    setLayout(prev => prev.map(w => {
      if (w.id === id) {
        // Approximate pixel values for comparison
        const currentWidth = w.colSpan * 80;
        const currentHeight = w.rowSpan * 40;
        
        const targetWidth = currentWidth + deltaX;
        const targetHeight = currentHeight + deltaY;
        
        let bestPreset = PRESETS[0];
        let minDistance = Infinity;
        
        PRESETS.forEach(p => {
          const pw = p.cols * 80;
          const ph = p.rows * 40;
          const dist = Math.sqrt(Math.pow(targetWidth - pw, 2) + Math.pow(targetHeight - ph, 2));
          if (dist < minDistance) {
            minDistance = dist;
            bestPreset = p;
          }
        });
        
        return { ...w, colSpan: bestPreset.cols, rowSpan: bestPreset.rows };
      }
      return w;
    }));
  };

  const moveWidget = (id: string, direction: 'up' | 'down') => {
    const index = layout.findIndex(w => w.id === id);
    if (index === -1) return;
    const newLayout = [...layout];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layout.length) return;
    
    [newLayout[index], newLayout[targetIndex]] = [newLayout[targetIndex], newLayout[index]];
    // Re-assign orders
    newLayout.forEach((w, i) => w.order = i);
    setLayout(newLayout);
  };

  const moveTab = (id: string, direction: 'up' | 'down') => {
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;
    const newTabs = [...tabs];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tabs.length) return;
    [newTabs[index], newTabs[targetIndex]] = [newTabs[targetIndex], newTabs[index]];
    setTabs(newTabs);
  };

  const handleClearHistory = async () => {
    if (!user) {
      setStatusMessage({ text: "Authentication Required: Please sign in to clear history.", type: 'error' });
      return;
    }
    setShowClearConfirm(true);
  };

  const executeClearHistory = async () => {
    setShowClearConfirm(false);
    setClearingHistory(true);
    setStatusMessage({ text: "Initializing history purge...", type: 'info' });

    try {
      const path = 'readings';
      const q = query(collection(db, path), limit(500));
      const snapshot = await getDocs(q).catch(err => {
        handleFirestoreError(err, OperationType.LIST, path);
        return null;
      });
      
      if (!snapshot || snapshot.empty) {
        setStatusMessage({ text: "No readings found to clear.", type: 'info' });
        setClearingHistory(false);
        return;
      }
      
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit().catch(err => handleFirestoreError(err, OperationType.WRITE, path));
      
      if (snapshot.docs.length === 500) {
        setStatusMessage({ text: "Cleared 500 records. There are more remaining. Click 'Clear All' again to continue.", type: 'info' });
      } else {
        setStatusMessage({ text: `Successfully cleared ${snapshot.docs.length} records.`, type: 'success' });
      }
    } catch (err: any) {
      console.error("Error clearing history:", err);
      setStatusMessage({ text: "Failed to clear history. Check console for details.", type: 'error' });
    } finally {
      setClearingHistory(false);
      // Auto-clear success message after 5 seconds
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  useEffect(() => {
    const testConnection = async () => {
      try {
        // Try to get a simple doc. Using getDoc (not FromServer) allows it to succeed 
        // if we are truly offline but have a cached version (from previous successful loads).
        // However, the error we are chasing is initial connectivity.
        await getDoc(doc(db, 'test', 'connection'));
        setFirebaseConnected(true);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.toLowerCase().includes('offline')) {
          setFirebaseConnected(false);
          console.warn("Firebase reported offline status.");
        } else {
          // If it's a permission error or anything else, the client is technically "online"
          setFirebaseConnected(true);
        }
      }
    };
    testConnection();
  }, []);

  useEffect(() => {
    const checkRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          setStatusMessage({ text: "Login successful via redirect!", type: 'success' });
        }
      } catch (err: any) {
        console.error("Redirect Login Error:", err);
      }
    };
    checkRedirect();
    
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  // Persist layout and tabs to Firestore
  useEffect(() => {
    if (!user || !firebaseConnected) return;
    
    const saveLayout = async () => {
      const userRef = doc(db, 'users', user.uid);
      try {
        await setDoc(userRef, { 
          dashboardLayout: layout,
          tabOrder: tabs.map(t => ({ id: t.id, label: t.label })) 
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
      } catch (err) {
        console.error("Error saving layout:", err);
      }
    };

    const timeoutId = setTimeout(saveLayout, 2000);
    return () => clearTimeout(timeoutId);
  }, [layout, tabs, user, firebaseConnected]);

  // Load layout from Firestore
  useEffect(() => {
    if (!user || !firebaseConnected) return;

    const loadLayout = async () => {
      const userRef = doc(db, 'users', user.uid);
      try {
        const docSnap = await getDoc(userRef).catch(err => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));
        if (docSnap && docSnap.exists()) {
          const userData = docSnap.data();
          if (userData.dashboardLayout) {
            setLayout(userData.dashboardLayout);
          }
          if (userData.tabOrder) {
            const orderedTabs = userData.tabOrder.map((t: any) => {
              const originalTab = INITIAL_TABS.find(ot => ot.id === t.id);
              return originalTab || null;
            }).filter(Boolean);

            // Add any missing tabs from INITIAL_TABS
            const missingTabs = INITIAL_TABS.filter(ot => !orderedTabs.some(t => t.id === ot.id));
            const finalTabs = [...orderedTabs, ...missingTabs];

            if (finalTabs.length > 0) {
              setTabs(finalTabs as any);
            }
          }
        }
      } catch (err) {
        console.error("Error loading layout:", err);
      }
    };

    loadLayout();
  }, [user, firebaseConnected]);

  useEffect(() => {
    // 1. Listen to latest status
    const unsubLatest = onSnapshot(doc(db, 'latest', 'status'), (doc) => {
      if (doc.exists()) {
        const newData = doc.data() as SoilData;
        setPrevData(prev => prev || newData);
        setData(newData);

        // Simulation: Random System Notifications
        if (Math.random() > 0.95) {
          setNotifications(prev => prev + 1);
          setAlerts(prev => [{
            id: Date.now().toString(),
            type: 'info' as const,
            message: `Telemetry optimized from Node ${Math.floor(Math.random() * 5) + 1}`,
            timestamp: new Date().toISOString(),
            read: false
          }, ...prev].slice(0, 5));
        }

        // Simulating Growth Progresion
        setZones(prev => prev.map(z => {
          if (z.id === activeZoneId) {
             const growChance = Math.random() > 0.98;
             if (growChance && z.currentStageIndex < 3) {
               setNotifications(prev => prev + 1);
               setStatusMessage({ text: `${z.name} reached ${GROWTH_STAGES_TEMPLATE[z.currentStageIndex + 1].name} stage!`, type: 'info' });
               return { ...z, currentStageIndex: z.currentStageIndex + 1, health: Math.min(100, z.health + 5) };
             }
          }
          return z;
        }));

        setLoading(false);
      } else {
        fetchFallbackData();
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'latest/status');
      if (!data) {
        setError("Database connection error. Please sign in.");
        setLoading(false);
      }
    });

    // 2. Listen to historical trends
    const q = query(collection(db, 'readings'), orderBy('timestamp', 'desc'), limit(250));
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
      });
      setHistory(readings);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'readings');
    });

  // 3. Listen to logs
    const qLogs = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      const logEntries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLogs(logEntries);
      setFirebaseConnected(true); // Signal connection on successful snapshot
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'logs');
      if (err.message.toLowerCase().includes('offline')) {
        setFirebaseConnected(false);
      }
    });

    return () => {
      unsubLatest();
      unsubHistory();
      unsubLogs();
    };
  }, []);

  const fetchFallbackData = async () => {
    setLoading(true);
    try {
      const docRef = doc(db, 'latest', 'status');
      const docSnap = await getDoc(docRef);
      if (docSnap && docSnap.exists()) {
        setData(docSnap.data() as SoilData);
      }
    } catch (err) {
      console.error("Manual sync failed:", err);
      handleFirestoreError(err, OperationType.GET, 'latest/status');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (useRedirect = false) => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      
      if (useRedirect) {
        await signInWithRedirect(auth, provider);
      } else {
        await signInWithPopup(auth, provider);
        setStatusMessage({ text: "Signed in successfully!", type: 'info' });
      }
    } catch (err: any) {
      console.error("Login Error Deep Detail:", err);
      
      let errorMsg = "Login failed: " + err.message;
      
      if (err.code === 'auth/popup-blocked') {
        errorMsg = "Popup was blocked! Please click the troubleshoot button.";
        setShowLoginTroubleshooter(true);
      } else if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        errorMsg = "Login window closed. If this keeps happening, click the troubleshoot button.";
        setShowLoginTroubleshooter(true);
      } else if (err.code === 'auth/unauthorized-domain') {
        errorMsg = `DOMAIN ERROR: Add '${window.location.hostname}' to Firebase Authorized Domains.`;
      } else if (err.message?.includes('third-party cookies')) {
        errorMsg = "COOKIES BLOCKED: This usually happens in iframes. Click troubleshoot.";
        setShowLoginTroubleshooter(true);
      }

      setStatusMessage({ text: errorMsg, type: 'error' });
      setError(`Auth Conflict: ${errorMsg}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const cropInfo = `Targeting: ${selectedCrop.name} (N:${selectedCrop.idealNPK.n} P:${selectedCrop.idealNPK.p} K:${selectedCrop.idealNPK.k})`;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { role: 'user', parts: [{ text: `You are the SoilGuard Pro AI Assistant. Context: ${cropInfo}. Current soil telemetry: ${JSON.stringify(data)}. User: ${userMessage}` }] }
        ],
        config: {
          systemInstruction: "You are a professional agronomist and AI assistant for SoilGuard Pro. ALWAYS orient your advice around the current target crop. Be concise, technical, and helpful. Use markdown but NO ASTERISKS (*) at all."
        }
      });

      const aiText = response.text || "I'm sorry, I couldn't process that request.";
      setChatMessages(prev => [...prev, { role: 'model', text: aiText }]);
    } catch (err) {
      console.error("Chat Error:", err);
      setChatMessages(prev => [...prev, { role: 'model', text: "Error: Uplink interrupted. Please check your API key and connection." }]);
    } finally {
      setChatLoading(false);
    }
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
    { name: 'N', value: validateValue(data.nitrogen), color: '#10b981', full: 'Nitrogen' },
    { name: 'P', value: validateValue(data.phosphorus), color: '#3b82f6', full: 'Phosphorus' },
    { name: 'K', value: validateValue(data.potassium), color: '#f59e0b', full: 'Potassium' },
  ] : [];

  const calculateTrend = (current: number, previous: number) => {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  };

  return (
    <div className="min-h-screen flex bg-surface-dark text-neutral-400 font-sans selection:bg-emerald-500/30">
      {/* Sidebar */}
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>
      
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-surface-card border-r border-border-muted transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full p-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
              <Sprout className="text-emerald-500" size={24} />
            </div>
            <div>
              <h1 className="text-lg font-display font-medium text-white tracking-tight">SoilGuard</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="flex h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-bold text-neutral-500 uppercase tracking-[0.2em] font-display">Uplink: Active</span>
              </div>
            </div>
          </div>

          <div className="mb-8 p-5 rounded-[1.5rem] bg-neutral-900/30 border border-white/5 backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
              <span className="tech-label">System Health</span>
              <div className="px-2 py-0.5 bg-emerald-500/10 rounded-full text-[8px] font-bold text-emerald-500 uppercase tracking-wider">Stable</div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Zap size={10} />
                  <span className="text-[10px] font-medium font-sans">Power</span>
                </div>
                <span className="text-[10px] font-mono text-white font-medium">{systemStatus.battery}%</span>
              </div>
              <div className="w-full h-1 bg-neutral-800/50 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${systemStatus.battery}%` }}
                  className="h-full bg-emerald-500" 
                />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between px-2 mb-3">
              <span className="text-[8px] font-black text-neutral-500 uppercase tracking-[0.2em]">Farm Zones</span>
              <button 
                onClick={() => setStatusMessage({ text: "Add Zone feature coming in V3", type: 'info' })}
                className="p-1 hover:bg-white/5 rounded-md text-neutral-500 hover:text-emerald-500 transition-colors"
                title="Add New Zone"
              >
                <PlusCircle size={12} />
              </button>
            </div>
            <div className="space-y-1">
              {zones.map(z => (
                <button
                  key={z.id}
                  onClick={() => setActiveZoneId(z.id)}
                  className={`w-full group px-3 py-2.5 rounded-xl transition-all flex items-center justify-between ${activeZoneId === z.id ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-white/5 text-neutral-400 hover:text-neutral-200'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg ${activeZoneId === z.id ? 'bg-emerald-500/20 text-emerald-500' : 'bg-neutral-800 text-neutral-500 group-hover:text-neutral-300'}`}>
                      <MapPin size={12} />
                    </div>
                    <div className="text-left">
                      <div className="text-[10px] font-bold truncate max-w-[100px]">{z.name}</div>
                      <div className="text-[8px] text-neutral-500 font-medium">{z.health}% health</div>
                    </div>
                  </div>
                  {activeZoneId === z.id && (
                    <motion.div layoutId="zone-active" className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <nav className="flex-grow space-y-1">
            <AnimatePresence mode="popLayout">
              {tabs.map((tab) => (
                <motion.div 
                  key={tab.id} 
                  layout 
                  animate={{ 
                    rotate: isEditingLayout ? [0, -0.5, 0.5, 0] : 0
                  }}
                  transition={{
                    rotate: {
                      repeat: Infinity,
                      duration: 0.3,
                      ease: "easeInOut"
                    }
                  }}
                  className="relative group"
                >
                  <button 
                    onClick={() => {
                      setActiveTab(tab.id as any);
                      setSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                      activeTab === tab.id 
                        ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                        : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
                    }`}
                  >
                    <tab.icon size={18} />
                    {tab.label}
                  </button>
                  {isEditingLayout && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => moveTab(tab.id, 'up')} className="p-1 hover:text-emerald-500"><TrendingUp size={10} /></button>
                      <button onClick={() => moveTab(tab.id, 'down')} className="p-1 hover:text-emerald-500"><TrendingDown size={10} /></button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </nav>

          <div className="mt-auto pt-6 border-t border-border-muted space-y-4">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${firebaseConnected === true ? 'bg-emerald-500' : firebaseConnected === false ? 'bg-rose-500' : 'bg-neutral-600'} animate-pulse`} />
                <span className="tech-label text-[9px] text-neutral-500">
                  {firebaseConnected === true ? 'FIREBASE SYNCED' : firebaseConnected === false ? 'FIREBASE OFFLINE' : 'SYNCING...'}
                </span>
              </div>
              <Database size={12} className={firebaseConnected === true ? 'text-emerald-500' : 'text-neutral-600'} />
            </div>

            {user ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-neutral-800 border border-border-muted flex items-center justify-center overflow-hidden">
                    {user.photoURL ? <img src={user.photoURL} alt="" className="w-full h-full object-cover" /> : <div className="text-[10px] font-bold">{user.email?.[0].toUpperCase()}</div>}
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-[10px] font-bold text-neutral-200 truncate">{user.displayName || 'User'}</p>
                    <p className="text-[8px] text-neutral-500 truncate">{user.email}</p>
                  </div>
                </div>
                <button onClick={handleLogout} className="p-2 text-neutral-500 hover:text-rose-500 transition-colors">
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button 
                  onClick={() => handleLogin(false)}
                  disabled={isLoggingIn}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-white rounded-lg text-xs font-bold transition-colors ${isLoggingIn ? 'bg-neutral-700 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-400'}`}
                >
                  {isLoggingIn ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <LogIn size={14} />
                  )}
                  {isLoggingIn ? 'SIGNING IN...' : 'SIGN IN'}
                </button>
                <button 
                  onClick={() => handleLogin(true)}
                  disabled={isLoggingIn}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-neutral-400 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-bold transition-colors ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-700 hover:text-white'}`}
                >
                  {isLoggingIn ? null : <RefreshCw size={14} />}
                  SIGN IN (REDIRECT FALLBACK)
                </button>
                <button 
                  onClick={() => setShowLoginTroubleshooter(true)}
                  className="w-full text-[9px] text-neutral-600 hover:text-neutral-400 font-bold tracking-widest uppercase transition-colors"
                >
                  Need Help? Click to Troubleshoot
                </button>
              </div>
            )}

            {!user && !isLoggingIn && (
              <p className="text-[8px] text-neutral-600 text-center px-4 leading-normal">
                If login fails, try opening the app in a 
                <a 
                  href={window.location.href} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-emerald-500 hover:underline mx-1"
                >
                  new tab
                </a> 
                or disable "Prevent Cross-Site Tracking" in Safari settings.
              </p>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-grow flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="h-20 border-b border-white/5 flex items-center justify-between px-6 md:px-12 lg:px-16 bg-neutral-950/60 backdrop-blur-2xl sticky top-0 z-40">
          <div className="flex items-center gap-8">
            <button 
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 text-neutral-500 hover:text-emerald-500 transition-colors"
            >
              <Layers size={20} />
            </button>
            <div className="flex items-center gap-3">
              <div className="hidden md:block">
                <p className="tech-label mb-1">Active Sector</p>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-display font-medium text-white tracking-tight">
                    {zones.find(z => z.id === activeZoneId)?.name}
                  </h2>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                </div>
              </div>
            </div>
            
            <div className="h-8 w-px bg-neutral-800 hidden md:block" />
            
            {activeTab === 'overview' && (
              <div className="relative group z-[60]">
                <button 
                  onClick={() => setShowCropDropdown(!showCropDropdown)}
                  className="flex items-center gap-3 px-4 py-2 bg-neutral-900 border border-neutral-800 hover:border-emerald-500/50 rounded-xl transition-all group shadow-sm active:scale-95"
                >
                  <Sprout size={16} className="text-emerald-500" />
                  <div className="flex flex-col items-start leading-none">
                    <span className="text-[7px] text-neutral-500 uppercase tracking-widest font-black">Target Profile</span>
                    <span className="text-[10px] font-bold text-neutral-100 uppercase tracking-tight">{selectedCrop.name}</span>
                  </div>
                  <ChevronDown size={14} className={`text-neutral-500 transition-transform duration-300 ${showCropDropdown ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {showCropDropdown && (
                    <>
                      <div className="fixed inset-0 z-[60] bg-black/5" onClick={() => setShowCropDropdown(false)} />
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full left-0 mt-2 w-64 bg-neutral-950/95 border border-neutral-800 p-2 z-[70] shadow-2xl backdrop-blur-2xl rounded-2xl"
                      >
                        <div className="max-h-80 overflow-y-auto custom-scrollbar">
                          {customCrops.length === 0 ? (
                            <div className="p-8 text-center">
                              <div className="w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center mx-auto mb-3 border border-neutral-800">
                                <Activity size={20} className="text-neutral-700" />
                              </div>
                              <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest leading-relaxed">
                                No plant profiles found.<br />Scout a crop to begin.
                              </p>
                            </div>
                          ) : (
                            ['Vegetable', 'Fruit', 'Grain', 'Other'].map(cat => {
                              const cropsInCat = customCrops.filter(c => c.category === cat);
                              if (cropsInCat.length === 0) return null;
                              return (
                                <div key={cat} className="mb-4 last:mb-0">
                                  <div className="px-3 py-1.5 flex items-center gap-2">
                                    <div className="text-[8px] font-black text-amber-500 uppercase tracking-[0.2em]">{cat}s</div>
                                    <div className="h-px flex-grow bg-amber-500/10" />
                                  </div>
                                  {cropsInCat.map(p => (
                                      <div key={p.id} className="relative group/crop-item">
                                        <button
                                          onClick={() => {
                                            setSelectedCrop(p);
                                            setShowCropDropdown(false);
                                          }}
                                          className={`w-full text-left px-3 py-2 rounded-lg transition-all flex items-center justify-between group/item pr-16 ${selectedCrop.id === p.id ? 'bg-amber-500/10 text-amber-400' : 'hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}
                                        >
                                          <div className="flex items-center gap-2">
                                            <div className={`w-1.5 h-1.5 rounded-full ${selectedCrop.id === p.id ? 'bg-amber-500 animate-pulse' : 'bg-neutral-800'}`} />
                                            <span className="text-xs font-bold truncate max-w-[120px]">{p.name}</span>
                                          </div>
                                          {selectedCrop.id === p.id && (
                                            <ShieldCheck size={12} className="text-amber-500" />
                                          )}
                                        </button>
                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10 text-[10px]">
                                          <button
                                            onClick={(e) => handleDeleteCrop(e, p.id)}
                                            className="p-1 px-1.5 rounded-lg text-neutral-600 hover:text-rose-500 hover:bg-rose-500/10 opacity-0 group-hover/crop-item:opacity-100 transition-all"
                                            title="Delete Discovery"
                                          >
                                            <Trash2 size={10} />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setShowInfoModal(p);
                                              setShowCropDropdown(false);
                                            }}
                                            className="p-1 px-1.5 rounded-lg text-neutral-600 hover:text-blue-500 hover:bg-blue-500/10 opacity-0 group-hover/crop-item:opacity-100 transition-all border border-transparent"
                                            title="Plant Intel"
                                          >
                                            <MoreVertical size={10} />
                                          </button>
                                        </div>
                                      </div>
                                  ))}
                                </div>
                              );
                            })
                          )}
                        </div>
                        <div className="border-t border-neutral-800 mt-2 pt-2 px-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowCropDropdown(false);
                              setShowAddCropModal(true);
                            }}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-[10px] font-black text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all border border-emerald-500/20 uppercase tracking-widest"
                          >
                            <PlusCircle size={14} />
                            Add New Plant
                          </button>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="relative mr-2">
              <button 
                onClick={() => setNotifications(0)}
                className="p-2 text-neutral-500 hover:text-white rounded-xl hover:bg-white/5 transition-all relative"
              >
                <Zap size={20} className={notifications > 0 ? 'text-amber-500 animate-pulse' : ''} />
                {notifications > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center border-2 border-surface-card">
                    {notifications}
                  </span>
                )}
              </button>
            </div>
            {isEditingLayout && (
              <button 
                onClick={cancelEditing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-500 tech-label text-[9px] hover:bg-rose-500/20 transition-all"
              >
                <Trash2 size={12} />
                CANCEL
              </button>
            )}
            <button 
              onClick={() => isEditingLayout ? setIsEditingLayout(false) : startEditing()}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border tech-label text-[9px] transition-all ${
                isEditingLayout 
                  ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]' 
                  : 'bg-neutral-900 text-neutral-400 border-border-muted hover:text-neutral-200'
              }`}
            >
              <Cpu size={12} className={isEditingLayout ? 'animate-pulse' : ''} />
              {isEditingLayout ? 'SAVE LAYOUT' : 'EDIT DASHBOARD'}
            </button>
            <div className="hidden sm:flex items-center gap-4">
              <button 
                onClick={() => setIsEmergencyStop(!isEmergencyStop)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border tech-label text-[9px] transition-all ${
                  isEmergencyStop 
                    ? 'bg-rose-600 text-white border-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.3)]' 
                    : 'bg-neutral-900 text-neutral-400 border-border-muted hover:text-rose-500 hover:border-rose-500/30'
                }`}
              >
                <AlertTriangle size={12} className={isEmergencyStop ? 'animate-pulse' : ''} />
                {isEmergencyStop ? 'SYSTEM HALTED' : 'EMERGENCY STOP'}
              </button>
              <div className="w-px h-4 bg-neutral-800" />
              <div className="flex flex-col items-end">
                <span className="tech-label text-[8px]">Data Source</span>
                <span className={`font-mono text-[10px] font-bold ${data?.source?.includes('Live') ? 'text-emerald-500' : 'text-amber-500'}`}>
                  {data?.source || 'Simulated'}
                </span>
              </div>
              <div className="w-px h-4 bg-neutral-800" />
              <div className="flex flex-col items-end">
                <span className="tech-label text-[8px]">Last Sync</span>
                <span className="font-mono text-[10px] font-bold text-blue-500">
                  {formatSyncTime(data?.timestamp)}
                </span>
              </div>
            </div>
            <button 
              onClick={fetchFallbackData}
              className="p-2 text-neutral-500 hover:text-emerald-500 transition-colors"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {/* Scrollable Area */}
        <div className="flex-grow overflow-y-auto p-4 md:p-10 lg:p-14 xl:p-20 scroll-smooth scrollbar-hide">
          <div className="max-w-7xl mx-auto space-y-8 md:space-y-12">
            {isEmergencyStop && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-600 p-4 rounded-2xl flex items-center justify-between gap-4 shadow-[0_0_30px_rgba(225,29,72,0.4)] border border-rose-400/30"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-white/20 rounded-lg animate-pulse">
                    <AlertTriangle className="text-white" size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-white uppercase tracking-widest">Emergency Stop Active</p>
                    <p className="text-[10px] text-rose-100 font-medium">All automated field systems have been force-halted. Manual override required.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsEmergencyStop(false)}
                  className="px-6 py-2 bg-white text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 transition-colors"
                >
                  Resume Systems
                </button>
              </motion.div>
            )}

      <AnimatePresence mode="wait">
        {activeTab === 'overview' ? (
          <motion.div 
            key="overview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 md:grid-cols-12 gap-10"
          >
            <AnimatePresence mode="popLayout">
              {layout
                .filter(w => w.visible)
                .sort((a, b) => a.order - b.order)
                .map((widget) => (
                  <motion.div
                    key={widget.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ 
                      opacity: 1, 
                      scale: 1,
                      rotate: isEditingLayout ? [0, -0.5, 0.5, 0] : 0
                    }}
                    transition={{
                      rotate: {
                        repeat: Infinity,
                        duration: 0.3,
                        ease: "easeInOut"
                      }
                    }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`relative group ${
                      widget.colSpan === 12 ? 'md:col-span-12' :
                      widget.colSpan >= 8 ? 'md:col-span-8' :
                      widget.colSpan >= 6 ? 'md:col-span-6' :
                      widget.colSpan >= 4 ? 'md:col-span-4' :
                      'md:col-span-3'
                    } ${isEditingLayout ? 'z-10' : ''} ${isCircleMode ? 'rounded-full overflow-hidden' : ''}`}
                    style={{ 
                      gridRowEnd: `span ${widget.rowSpan || 4}`,
                    }}
                  >
                    {isEditingLayout && (
                      <div className="absolute -top-3 -right-3 z-50 flex items-center gap-1 bg-neutral-900 border border-emerald-500/50 rounded-lg p-1 shadow-xl">
                        <button 
                          onClick={() => moveWidget(widget.id, 'up')}
                          className="p-1.5 hover:bg-neutral-800 text-neutral-400 hover:text-emerald-500 transition-colors"
                          title="Move Up"
                        >
                          <TrendingUp size={12} />
                        </button>
                        <button 
                          onClick={() => moveWidget(widget.id, 'down')}
                          className="p-1.5 hover:bg-neutral-800 text-neutral-400 hover:text-emerald-500 transition-colors"
                          title="Move Down"
                        >
                          <TrendingDown size={12} />
                        </button>
                        <div className="w-px h-3 bg-neutral-800 mx-1" />
                        <button 
                          onClick={() => cycleWidgetSize(widget.id)}
                          className="flex items-center gap-1 px-2 py-1 hover:bg-neutral-800 text-neutral-400 hover:text-emerald-500 transition-colors tech-label text-[8px]"
                          title="Change Shape"
                        >
                          <Layers size={10} />
                          SHAPE
                        </button>
                      </div>
                    )}

                    {isEditingLayout && (
                      <motion.div
                        drag
                        dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
                        dragElastic={0.1}
                        onDragEnd={(_, info) => snapToSize(widget.id, info.offset.x, info.offset.y)}
                        className="absolute bottom-1 right-1 w-8 h-8 cursor-nwse-resize flex items-center justify-center text-neutral-600 hover:text-emerald-500 transition-colors z-50 bg-neutral-900/50 rounded-full border border-emerald-500/20"
                        title="Drag to Resize"
                      >
                        <TargetIcon size={14} />
                      </motion.div>
                    )}

                    {/* Widget Content Mapping */}
                    {widget.id === 'field_map' && <FieldMap history={history} />}
                    {widget.id === 'nutrient_composition' && (
                      <div className="glass-card p-10 relative group h-full">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500/80" />
                        <div className="flex items-center justify-between mb-12">
                          <div className="flex items-center gap-3">
                            <Layers className="text-neutral-500 group-hover:text-emerald-500 transition-colors" size={20} />
                            <h2 className="text-sm font-display font-medium text-white tracking-tight uppercase">Nutrient Composition</h2>
                          </div>
                        </div>
                        <div className="h-[300px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                              <CartesianGrid strokeDasharray="4 4" stroke="#262626" vertical={false} opacity={0.3} />
                              <XAxis dataKey="name" stroke="#525252" fontSize={9} tickLine={false} axisLine={false} />
                              <YAxis stroke="#525252" fontSize={9} tickLine={false} axisLine={false} />
                              <Tooltip 
                                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                                content={({ active, payload }) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="glass-card p-6 border-white/5 shadow-2xl backdrop-blur-3xl min-w-[160px]">
                                        <p className="tech-label mb-2 text-emerald-500">{data.full}</p>
                                        <p className="text-3xl font-display font-medium text-neutral-100 italic">{(data.value ?? 0).toFixed(2)}</p>
                                        <p className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest mt-1">mg/kg concentration</p>
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />
                              <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={48}>
                                {chartData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.8} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {widget.id === 'sensor_gauges' && (
                      <div className="glass-card p-8 h-full flex flex-col justify-center space-y-8">
                        <Gauge label="Nitrogen (N)" value={validateValue(data?.nitrogen)} color="text-emerald-500" icon={Wind} delay={0.1} />
                        <Gauge label="Phosphorus (P)" value={validateValue(data?.phosphorus)} color="text-blue-500" icon={Droplets} delay={0.2} />
                        <Gauge label="Potassium (K)" value={validateValue(data?.potassium)} color="text-amber-500" icon={Activity} delay={0.3} />
                      </div>
                    )}

                    {widget.id === 'environmental_grid' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-full">
                        <SensorCard 
                          title="Ambient Temp" 
                          value={formatTemperature(validateValue(data?.temperature), tempUnit)} 
                          unit={tempUnit === 'both' ? '' : (tempUnit === 'C' ? '°C' : '°F')} 
                          icon={Thermometer} 
                          color="text-rose-500"
                          trend={data && prevData ? calculateTrend(validateValue(data.temperature) || 0, validateValue(prevData.temperature) || 0) : undefined}
                          isCircleMode={isCircleMode}
                        />
                        <SensorCard 
                          title="Soil Saturation" 
                          value={validateValue(data?.humidity)} 
                          unit="%" 
                          icon={Droplets} 
                          color="text-blue-500"
                          trend={data && prevData ? calculateTrend(validateValue(data.humidity) || 0, validateValue(prevData.humidity) || 0) : undefined}
                          isCircleMode={isCircleMode}
                        />
                      </div>
                    )}

                    {widget.id === 'weather_yield' && (
                      <div className="grid grid-cols-2 gap-4 h-full">
                        <div className={`glass-card p-6 flex flex-col items-center justify-center text-center gap-2 ${isCircleMode ? 'rounded-full aspect-square' : ''}`}>
                          <div className="p-3 rounded-full bg-neutral-800 text-neutral-400">
                            <Wind size={20} />
                          </div>
                          <div className={`${isCircleMode ? 'text-lg' : 'text-2xl'} font-black font-mono text-neutral-100`}>
                            {formatTemperature(validateValue(data?.temperature) || weather.temp, tempUnit)}
                          </div>
                          <span className="tech-label text-[8px] uppercase tracking-widest">
                            {data?.source?.includes('Live') ? 'Local Sensor' : weather.condition}
                          </span>
                        </div>
                        <div className={`glass-card p-6 flex flex-col items-center justify-center text-center gap-2 ${isCircleMode ? 'rounded-full aspect-square' : ''}`}>
                          <div className="p-3 rounded-full bg-neutral-800 text-emerald-500">
                            <TrendingUp size={20} />
                          </div>
                          <div className={`${isCircleMode ? 'text-lg' : 'text-2xl'} font-black font-mono text-neutral-100`}>
                            {validateValue(data?.humidity) || 84}%
                          </div>
                          <span className="tech-label text-[8px] uppercase tracking-widest">
                            {data?.source?.includes('Live') ? 'Local Humidity' : 'Yield Forecast'}
                          </span>
                        </div>
                      </div>
                    )}

                    {widget.id === 'growth_timeline' && (
                      <div className="glass-card p-10 h-full">
                        <div className="flex items-center justify-between mb-10">
                          <div className="flex items-center gap-3">
                            <Sprout className="text-emerald-500" size={20} />
                            <h2 className="text-sm font-display font-medium text-white tracking-tight uppercase">Growth Cycle</h2>
                          </div>
                          <span className="tech-label text-emerald-500">STAGE 3: VEGETATIVE</span>
                        </div>
                        <div className="relative pt-6 pb-10">
                          <div className="absolute top-1/2 left-0 w-full h-px bg-neutral-800 -translate-y-1/2" />
                          <div className="flex justify-between relative z-10 px-2 lg:px-4">
                            {['Germination', 'Seedling', 'Vegetative', 'Flowering', 'Harvest'].map((label, i) => (
                              <div key={i} className="flex flex-col items-center gap-4">
                                <div className={`w-3 h-3 rounded-full border-2 transition-all duration-500 ${i <= 2 ? 'bg-emerald-500 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-neutral-950 border-neutral-800'}`} />
                                <span className="tech-label text-neutral-500">{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {widget.id === 'health_score' && (
                      <div className="glass-card p-10 relative overflow-hidden h-full flex flex-col items-center justify-center">
                        <div className="flex items-center justify-between w-full mb-10">
                          <div className="flex items-center gap-3">
                            <TargetIcon className="text-emerald-500" size={20} />
                            <h2 className="text-sm font-display font-medium text-white tracking-tight uppercase">Health Score</h2>
                          </div>
                        </div>
                        <div className="flex flex-col items-center justify-center flex-grow">
                          <div className="relative">
                            <svg className="w-36 h-36 transform -rotate-90">
                              <circle cx="72" cy="72" r="64" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-neutral-900" />
                              <motion.circle 
                                initial={{ strokeDashoffset: 402 }}
                                animate={{ strokeDashoffset: 402 - (402 * calculateHealthScore(data!)) / 100 }}
                                cx="72" cy="72" r="64" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={402} className="text-emerald-500" strokeLinecap="round" 
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-4xl font-display font-medium text-neutral-100">{calculateHealthScore(data!)}</span>
                              <span className="tech-label text-emerald-500 mt-1">Optimum</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {widget.id === 'nutrient_balance' && (
                      <div className="glass-card p-8 h-full">
                        <div className="flex items-center gap-3 mb-6">
                          <TargetIcon className="text-emerald-500" size={16} />
                          <h2 className="text-[10px] font-bold text-neutral-100 uppercase tracking-widest">Nutrient Balance</h2>
                        </div>
                        <div className="h-[150px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={[
                              { subject: 'N', A: validateValue(data?.nitrogen) || 0 },
                              { subject: 'P', A: validateValue(data?.phosphorus) || 0 },
                              { subject: 'K', A: validateValue(data?.potassium) || 0 },
                              { subject: 'T', A: (validateValue(data?.temperature) || 0) * 2 },
                              { subject: 'H', A: validateValue(data?.humidity) || 0 },
                            ]}>
                              <PolarGrid stroke="#262626" />
                              <PolarAngleAxis dataKey="subject" tick={{ fill: '#525252', fontSize: 8, fontWeight: 'bold' }} />
                              <Radar name="Soil Data" dataKey="A" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                            </RadarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {widget.id === 'diagnostics' && (
                      <div className="glass-card p-10 h-full flex flex-col justify-between group overflow-hidden relative">
                         <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-[60px] -mr-16 -mt-16" />
                        <div className="flex items-center justify-between mb-8">
                          <div className="flex items-center gap-3">
                            <Sparkles className="text-emerald-500 active:scale-110 transition-transform" size={20} />
                            <h2 className="text-sm font-display font-medium text-white tracking-tight uppercase">AI Diagnostic</h2>
                          </div>
                          <div className="px-2 py-0.5 bg-emerald-500/10 rounded-full text-[8px] font-bold text-emerald-500 uppercase tracking-wider">Active</div>
                        </div>
                        
                        <div className="flex-grow flex flex-col items-center justify-center text-center p-4 bg-neutral-900/20 rounded-[1.5rem] border border-white/5 space-y-4">
                          <PulseIcon className="text-emerald-500/50" size={32} />
                          <div>
                            <p className="text-xs font-medium text-neutral-300 leading-relaxed max-w-[200px]">
                              Intelligence uplink operational. Gemini is processing field telemetry.
                            </p>
                          </div>
                        </div>

                        <button 
                          onClick={() => setActiveTab('intelligence')}
                          className="mt-8 w-full py-4 bg-neutral-100 text-neutral-900 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-white hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-white/5"
                        >
                          Access Intel Core
                        </button>
                      </div>
                    )}

                    {widget.id === 'active_alerts' && (
                      <div className="glass-card p-8 h-full">
                        <div className="flex items-center gap-3 mb-6">
                          <AlertTriangle className="text-amber-500" size={16} />
                          <h2 className="text-[10px] font-bold text-neutral-100 uppercase tracking-widest">Active Alerts</h2>
                        </div>
                        <div className="space-y-4">
                          {data && (data.nitrogen < 10 || data.phosphorus < 10 || data.potassium < 10) ? (
                            <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-lg flex items-start gap-3">
                              <AlertTriangle className="text-rose-500 shrink-0" size={14} />
                              <div>
                                <p className="text-[10px] font-bold text-rose-500 uppercase mb-1">Nutrient Deficiency</p>
                                <p className="text-[9px] text-neutral-500 leading-relaxed">Primary nutrients are below critical thresholds.</p>
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-lg flex items-start gap-3">
                              <ShieldCheck className="text-emerald-500 shrink-0" size={14} />
                              <div>
                                <p className="text-[10px] font-bold text-emerald-500 uppercase mb-1">Systems Nominal</p>
                                <p className="text-[9px] text-neutral-500 leading-relaxed">All parameters within optimal ranges.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {widget.id === 'predictive_alerts' && (
                      <div className="glass-card p-8 h-full">
                        <div className="flex items-center gap-3 mb-6">
                          <AlertTriangle className="text-rose-500" size={16} />
                          <h2 className="text-[10px] font-bold text-neutral-100 uppercase tracking-widest">Predictive Alerts</h2>
                        </div>
                        <div className="space-y-4">
                          {data && validateValue(data.nitrogen) !== undefined && (validateValue(data.nitrogen) || 0) < 15 ? (
                            <div className="p-4 bg-rose-500/5 rounded-xl border border-rose-500/10 flex items-start gap-3">
                              <div className="mt-1 p-1 bg-rose-500 rounded-full" />
                              <div>
                                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">Low Nitrogen Warning</p>
                                <p className="text-[9px] text-neutral-500 mt-1 leading-relaxed">Levels are approaching critical thresholds.</p>
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/10 flex items-start gap-3">
                              <div className="mt-1 p-1 bg-emerald-500 rounded-full" />
                              <div>
                                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Stability Assured</p>
                                <p className="text-[9px] text-neutral-500 mt-1 leading-relaxed">Current trend shows stable nutrient retention for the next 48 hours.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {widget.id === 'crop_profile_card' && (
                      <div className="glass-card p-8 h-full relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                          <Sprout size={120} />
                        </div>
                        <div className="flex items-center justify-between mb-8">
                          <div className="flex items-center gap-3">
                            <Sprout className="text-emerald-500" size={20} />
                            <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">Selected Crop</h2>
                          </div>
                          <span className="tech-label text-[9px] px-2 py-1 bg-emerald-500/10 text-emerald-500 rounded border border-emerald-500/20 uppercase">
                            {selectedCrop.category}
                          </span>
                        </div>
                        
                        <div className="space-y-6 relative z-10">
                          <div>
                            <h3 className="text-2xl font-black text-neutral-100 mb-2">{selectedCrop.name}</h3>
                            <p className="text-[10px] text-neutral-500 leading-relaxed max-w-xs">{selectedCrop.description}</p>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-4">
                            {[
                              { label: 'Target N', val: selectedCrop.idealNPK.n, color: 'text-emerald-500' },
                              { label: 'Target P', val: selectedCrop.idealNPK.p, color: 'text-blue-500' },
                              { label: 'Target K', val: selectedCrop.idealNPK.k, color: 'text-amber-500' }
                            ].map((item, i) => (
                              <div key={i} className="flex flex-col gap-1 p-3 bg-neutral-900 rounded-xl border border-border-muted/50">
                                <span className="tech-label text-[8px] text-neutral-600 uppercase italic">{item.label}</span>
                                <span className={`font-mono text-sm font-bold ${item.color}`}>{item.val}</span>
                              </div>
                            ))}
                          </div>

                          <div className="p-4 bg-neutral-950 rounded-xl border border-border-muted border-dashed">
                             <div className="flex justify-between items-center mb-2">
                               <span className="tech-label text-[8px] text-neutral-500 uppercase">Ideal Range</span>
                               <span className="tech-label text-[8px] text-neutral-500 uppercase">Temp & RH</span>
                             </div>
                             <div className="flex items-center gap-4">
                               <div className="flex items-center gap-2">
                                 <Thermometer size={12} className="text-rose-500" />
                                 <span className="text-[10px] font-bold text-neutral-300">
                                   {selectedCrop.idealTemp.min}-{selectedCrop.idealTemp.max}°C
                                 </span>
                               </div>
                               <div className="flex items-center gap-2">
                                 <Droplets size={12} className="text-blue-500" />
                                 <span className="text-[10px] font-bold text-neutral-300">
                                   {selectedCrop.idealHumidity.min}-{selectedCrop.idealHumidity.max}%
                                 </span>
                               </div>
                             </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {widget.id === 'controls' && (
                      <div className="glass-card p-8 h-full">
                        <div className="flex items-center gap-3 mb-6">
                          <Settings className="text-emerald-500" size={16} />
                          <h2 className="text-[10px] font-bold text-neutral-100 uppercase tracking-widest">Control Center</h2>
                        </div>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3">
                            <button 
                              onClick={() => setIsIrrigationManual(!isIrrigationManual)}
                              className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-2 ${isIrrigationManual ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-neutral-900 border-neutral-800 text-neutral-500 hover:text-neutral-300'}`}
                            >
                              <Hand size={16} />
                              <span className="text-[8px] font-black uppercase">Manual</span>
                            </button>
                            <button 
                              onClick={() => isIrrigationManual && setPumpStatus(!pumpStatus)}
                              disabled={!isIrrigationManual}
                              className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-2 ${pumpStatus ? 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)] border-blue-400 text-white' : 'bg-neutral-900 border-neutral-800 text-neutral-500 disabled:opacity-30'}`}
                            >
                              <Droplets size={16} className={pumpStatus ? 'animate-pulse' : ''} />
                              <span className="text-[8px] font-black uppercase">{pumpStatus ? 'Pump ON' : 'Pump OFF'}</span>
                            </button>
                          </div>
                          <div className="p-3 bg-neutral-900 rounded-xl border border-neutral-800">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[8px] font-black text-neutral-500 uppercase tracking-tighter">Field Subsytems</span>
                              <div className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span className="text-[7px] font-bold text-emerald-500">LIVE</span>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-medium text-neutral-400">Nutrient Injector</span>
                                <span className="text-[8px] font-black text-emerald-500 uppercase">Online</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-medium text-neutral-400">UV Matrix</span>
                                <span className="text-[8px] font-black text-neutral-500 italic uppercase">Syncing</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {widget.id === 'fertilizer_calculator' && (
                      <div className="glass-card p-8 h-full">
                        <div className="flex items-center justify-between mb-8">
                          <div className="flex items-center gap-3">
                            <BrainCircuit className="text-emerald-500" size={20} />
                            <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">Nutrient Optimizer</h2>
                          </div>
                        </div>

                        <div className="space-y-4 h-full flex flex-col">
                           <div className="flex items-center justify-between tech-label text-[8px] text-neutral-600 uppercase italic">
                              <span>Recommended Prescription</span>
                              <span>To Hit {selectedCrop.name} Target</span>
                           </div>
                           
                           <div className="space-y-2">
                             {getFertilizerAdvice().length > 0 ? (
                               getFertilizerAdvice().slice(0, 3).map((f: any, i) => (
                                 <div key={i} className="p-4 bg-neutral-900 border border-border-muted rounded-xl flex items-center justify-between group hover:border-emerald-500/30 transition-colors">
                                   <div className="flex items-center gap-3">
                                     <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                     <div>
                                       <p className="text-[10px] font-bold text-neutral-200">{f.name}</p>
                                       <p className="text-[8px] text-neutral-500 uppercase tracking-tighter">
                                          N:{f.n} P:{f.p} K:{f.k}
                                       </p>
                                     </div>
                                   </div>
                                   <div className="text-right">
                                     <p className="text-xs font-black font-mono text-emerald-500">{f.amountNeeded}kg</p>
                                     <p className={`text-[8px] uppercase font-bold ${f.quantity >= f.amountNeeded ? 'text-neutral-600' : 'text-rose-500'}`}>
                                       {f.quantity >= f.amountNeeded ? 'IN STOCK' : 'LOW STOCK'}
                                     </p>
                                   </div>
                                 </div>
                               ))
                             ) : (
                               <div className="p-12 text-center flex flex-col items-center justify-center gap-3 bg-neutral-900/50 rounded-2xl border border-dashed border-border-muted h-32">
                                 <ShieldCheck size={24} className="text-emerald-500/20" />
                                 <p className="tech-label text-[9px] text-neutral-600 uppercase">Soil is perfectly balanced</p>
                               </div>
                             )}
                           </div>
                           
                           <button className="w-full mt-auto py-3 bg-neutral-950 border border-border-muted rounded-xl tech-label text-[9px] text-neutral-500 hover:text-emerald-500 hover:border-emerald-500/30 transition-all flex items-center justify-center gap-2 group">
                              <Download size={12} className="group-hover:translate-y-0.5 transition-transform" />
                              DOWNLOAD FEEDING SCHEDULE
                           </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
            </AnimatePresence>
          </motion.div>
        ) : activeTab === 'history' ? (
          <motion.div 
            key="history"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            <div className="glass-card p-6 md:p-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8">
                <div className="flex items-center gap-3">
                  <HistoryIcon className="text-neutral-500" size={20} />
                  <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">Historical Readings</h2>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button 
                    onClick={exportToCSV}
                    className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 text-neutral-300 rounded-lg border border-border-muted hover:bg-neutral-700 transition-colors tech-label text-[9px]"
                  >
                    <Download size={12} />
                    Export CSV
                  </button>
                  <button 
                    onClick={handleClearHistory}
                    className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 text-rose-500 rounded-lg border border-rose-500/20 hover:bg-rose-500/20 transition-colors tech-label text-[9px]"
                  >
                    <Trash2 size={12} />
                    Clear All
                  </button>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-950 rounded-lg border border-border-muted">
                    <Database size={12} className="text-neutral-600" />
                    <span className="tech-label text-[9px]">{history.length} Records</span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border-muted">
                      <th className="pb-4 px-6 tech-label">Timestamp</th>
                      <th className="pb-4 px-6 tech-label">Nitrogen</th>
                      <th className="pb-4 px-6 tech-label">Phosphorus</th>
                      <th className="pb-4 px-6 tech-label">Potassium</th>
                      <th className="pb-4 px-6 tech-label">Temp</th>
                      <th className="pb-4 px-6 tech-label">Humidity</th>
                      <th className="pb-4 px-6 tech-label text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-muted/30">
                    {history.length > 0 ? (
                      history.map((record, i) => (
                        <tr key={record.id || i} className="group hover:bg-neutral-800/30 transition-colors">
                          <td className="py-4 px-6">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-neutral-200">{record.time || 'N/A'}</span>
                              <span className="text-[9px] text-neutral-500 font-mono">{record.date || 'N/A'}</span>
                            </div>
                          </td>
                          <td className="py-4 px-6 font-mono text-xs text-emerald-500 font-bold">
                            {record.nitrogen !== undefined && record.nitrogen !== null ? record.nitrogen.toFixed(1) : '---'}
                          </td>
                          <td className="py-4 px-6 font-mono text-xs text-blue-500 font-bold">
                            {record.phosphorus !== undefined && record.phosphorus !== null ? record.phosphorus.toFixed(1) : '---'}
                          </td>
                          <td className="py-4 px-6 font-mono text-xs text-amber-500 font-bold">
                            {record.potassium !== undefined && record.potassium !== null ? record.potassium.toFixed(1) : '---'}
                          </td>
                          <td className="py-4 px-6 font-mono text-xs text-rose-500 font-bold">
                            {formatTemperature(record.temperature, tempUnit)}
                          </td>
                          <td className="py-4 px-6 font-mono text-xs text-blue-400 font-bold">
                            {record.humidity !== undefined && record.humidity !== null ? `${record.humidity.toFixed(1)}%` : '---'}
                          </td>
                          <td className="py-4 px-6 text-right">
                            <button 
                              onClick={() => handleDeleteReading(record.id)}
                              className="p-2 text-neutral-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                    <XAxis dataKey="time" stroke="#525252" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#525252" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #262626', borderRadius: '12px' }}
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
        ) : activeTab === 'intelligence' ? (
          <motion.div 
            key="intelligence"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            <div className="glass-card p-8">
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <Sparkles className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">AI Insights & Actions</h2>
                    <p className="tech-label text-[8px] mt-1">Autonomous Decision Engine</p>
                  </div>
                </div>
                
                <button 
                  onClick={runAnalysis}
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-400 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
                  {isAnalyzing ? "Analyzing..." : "Run AI Diagnostics"}
                </button>
              </div>

              {/* Recommendations Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <AnimatePresence mode="popLayout">
                  {recommendations.length > 0 ? (
                    recommendations.map((rec, idx) => (
                      <motion.div
                        key={rec.action}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.1 }}
                        className="p-5 rounded-xl bg-neutral-900/50 border border-border-muted hover:border-emerald-500/30 transition-all group flex flex-col"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest ${
                            rec.priority === "High" ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" :
                            rec.priority === "Medium" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                            "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                          }`}>
                            {rec.priority} Priority
                          </span>
                          <div className="p-1.5 rounded-lg bg-neutral-800 text-neutral-500">
                            {rec.category === "Nutrients" ? <Database className="w-3.5 h-3.5" /> :
                             rec.category === "Irrigation" ? <Droplets className="w-3.5 h-3.5" /> :
                             <Wind className="w-3.5 h-3.5" />}
                          </div>
                        </div>

                        <h3 className="text-xs font-bold text-neutral-100 mb-2 flex items-center gap-2">
                          <ArrowRight className="w-3 h-3 text-emerald-500" />
                          {rec.action}
                        </h3>
                        <p className="text-[10px] text-neutral-500 leading-relaxed mb-4 flex-grow">
                          {rec.reason}
                        </p>

                        {rec.suggestedFertilizer && (
                          <div className="mt-auto pt-4 border-t border-border-muted space-y-2">
                            <div className="flex items-center gap-2">
                              <Database className="w-3 h-3 text-emerald-500" />
                              <p className="text-[9px] font-bold text-emerald-500/80 uppercase tracking-tighter">Use: {rec.suggestedFertilizer}</p>
                            </div>
                            {rec.stockPrediction && (
                              <div className="flex items-center gap-2">
                                <Info className="w-3 h-3 text-amber-500" />
                                <p className="text-[9px] font-bold text-amber-500/80 uppercase tracking-tighter">{rec.stockPrediction}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    ))
                  ) : (
                    <div className="col-span-full py-12 flex flex-col items-center justify-center text-neutral-700 border border-dashed border-border-muted rounded-xl bg-neutral-900/20">
                      <BrainCircuit className="w-10 h-10 mb-4 opacity-20" />
                      <p className="tech-label text-[10px]">Awaiting Telemetry Analysis...</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer Info */}
              <div className="mt-8 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 flex items-start gap-4">
                <Info className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Optimization Strategy: The AI prioritizes nutrient mobility and osmotic pressure. Recommendations are cross-referenced with your current inventory to ensure immediate feasibility.
                </p>
              </div>
            </div>

            {/* AI Assistant Integration */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 space-y-6">
                <div className="glass-card p-6 md:p-8 h-full flex flex-col gap-6">
                  <div className="flex items-center gap-3">
                    <BrainCircuit className="text-neutral-500" size={20} />
                    <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">AI Core</h2>
                  </div>
                  <div className="space-y-4 flex-grow">
                    <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                      <p className="text-[10px] font-bold text-emerald-500 uppercase mb-2">Capabilities</p>
                      <ul className="space-y-2">
                        {['Soil Analysis', 'Crop Recommendations', 'Pest Prediction', 'Irrigation Optimization'].map((cap, i) => (
                          <li key={i} className="flex items-center gap-2 text-[10px] text-neutral-400">
                            <div className="w-1 h-1 rounded-full bg-emerald-500" />
                            {cap}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-4 bg-neutral-900 rounded-xl border border-border-muted">
                      <p className="text-[10px] font-bold text-neutral-400 uppercase mb-2">Telemetry Context</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="text-[9px] text-neutral-500 font-mono">N: {data?.nitrogen}</div>
                        <div className="text-[9px] text-neutral-500 font-mono">P: {data?.phosphorus}</div>
                        <div className="text-[9px] text-neutral-500 font-mono">K: {data?.potassium}</div>
                        <div className="text-[9px] text-neutral-500 font-mono">T: {formatTemperature(data?.temperature, tempUnit)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 bg-neutral-950 rounded-xl border border-border-muted text-center">
                    <p className="tech-label text-[9px] text-neutral-600 italic">Neural Engine: Gemini 3 Flash</p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-8 flex flex-col glass-card overflow-hidden min-h-[500px]">
                <div className="p-4 border-b border-border-muted bg-neutral-950/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="tech-label text-[10px] text-neutral-400">Uplink Active</span>
                  </div>
                  <button 
                    onClick={() => setChatMessages([{ role: 'model', text: "Chat history cleared. How can I help you?" }])}
                    className="tech-label text-[9px] text-neutral-600 hover:text-emerald-500 transition-colors uppercase tracking-widest"
                  >
                    Clear History
                  </button>
                </div>
                
                <div className="flex-grow overflow-y-auto p-8 space-y-6 scrollbar-hide">
                  {chatMessages.map((msg, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}>
                        <div className="markdown-body text-xs leading-relaxed">
                          {msg.text}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="chat-bubble-ai flex gap-1.5 items-center justify-center">
                        <motion.div 
                          animate={{ scale: [1, 1.2, 1] }} 
                          transition={{ repeat: Infinity, duration: 0.6 }}
                          className="w-1 h-1 bg-emerald-500/50 rounded-full" 
                        />
                        <motion.div 
                          animate={{ scale: [1, 1.2, 1] }} 
                          transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }}
                          className="w-1 h-1 bg-emerald-500/50 rounded-full" 
                        />
                        <motion.div 
                          animate={{ scale: [1, 1.2, 1] }} 
                          transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }}
                          className="w-1 h-1 bg-emerald-500/50 rounded-full" 
                        />
                      </div>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSendMessage} className="p-6 bg-neutral-950/20 backdrop-blur-xl border-t border-white/5 flex gap-3">
                  <input 
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Message SoilGuard AI..."
                    className="flex-grow bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/30 transition-all"
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim() || chatLoading}
                    className="bg-emerald-500 text-white w-12 h-12 flex items-center justify-center rounded-2xl hover:bg-emerald-400 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 shadow-lg shadow-emerald-500/20"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </div>
          </motion.div>
        ) : activeTab === 'logbook' ? (
          <motion.div 
            key="logbook"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8"
          >
            <div className="lg:col-span-4">
              <div className="glass-card p-8 sticky top-8">
                <div className="flex items-center gap-3 mb-8">
                  <Plus className="text-neutral-500" size={20} />
                  <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">New Entry</h2>
                </div>
                <form onSubmit={handleAddLog} className="space-y-6">
                  <div>
                    <label className="tech-label text-[10px] mb-2 block">Entry Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['observation', 'action', 'alert'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setLogType(t as any)}
                          className={`py-2 rounded-lg text-[9px] font-bold uppercase transition-all border ${logType === t ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-neutral-900 border-border-muted text-neutral-500'}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="tech-label text-[10px] mb-2 block">Notes</label>
                    <textarea 
                      value={newLog}
                      onChange={(e) => setNewLog(e.target.value)}
                      placeholder="Record field observations..."
                      className="w-full h-32 bg-neutral-950 border border-border-muted rounded-lg p-4 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 transition-colors resize-none"
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={!user || !newLog.trim()}
                    className="w-full py-3 bg-emerald-500 text-white rounded-lg font-bold text-xs hover:bg-emerald-400 transition-colors disabled:opacity-50"
                  >
                    SAVE TO LOGBOOK
                  </button>
                </form>
              </div>
            </div>

            <div className="lg:col-span-8 space-y-6">
              {logs.length > 0 ? (
                logs.map((log, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    key={log.id} 
                    className="glass-card p-6 relative group"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${log.type === 'alert' ? 'bg-rose-500/10 text-rose-500' : log.type === 'action' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                          <MessageSquare size={14} />
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-100">{log.type}</p>
                          <p className="text-[9px] text-neutral-500 font-mono">{new Date(log.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">{log.content}</p>
                  </motion.div>
                ))
              ) : (
                <div className="glass-card p-20 text-center opacity-20 flex flex-col items-center gap-4">
                  <FileText size={48} className="text-neutral-500" />
                  <p className="tech-label">Logbook is empty. Start recording your field notes.</p>
                </div>
              )}
            </div>
          </motion.div>
        ) : activeTab === 'settings' ? (
          <motion.div 
            key="settings"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-8"
          >
            <div className="glass-card p-8">
              <div className="flex items-center gap-3 mb-8">
                <Cpu className="text-neutral-500" size={20} />
                <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">Field Thresholds</h2>
              </div>
              <div className="space-y-8">
                {Object.entries(thresholds).map(([key, range]) => (
                  <div key={key} className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="tech-label text-[10px] capitalize">{key} Range</span>
                      <span className="font-mono text-[10px] text-emerald-500 font-bold">{range.min} - {range.max}</span>
                    </div>
                    <div className="flex gap-4">
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={range.min}
                        onChange={(e) => setThresholds(prev => ({ ...prev, [key]: { ...prev[key as keyof typeof thresholds], min: parseInt(e.target.value) } }))}
                        className="flex-1 accent-emerald-500 h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                      />
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={range.max}
                        onChange={(e) => setThresholds(prev => ({ ...prev, [key]: { ...prev[key as keyof typeof thresholds], max: parseInt(e.target.value) } }))}
                        className="flex-1 accent-emerald-500 h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card p-8 space-y-8">
              <div className="flex items-center gap-3 mb-2">
                <Sparkles className="text-neutral-500" size={20} />
                <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">Display Preferences</h2>
              </div>
              
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="tech-label text-[10px] block">Temperature Unit</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['C', 'F', 'both'] as const).map((unit) => (
                      <button
                        key={unit}
                        onClick={() => setTempUnit(unit)}
                        className={`py-2 rounded-lg text-[9px] font-bold uppercase transition-all border ${tempUnit === unit ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-neutral-900 border-border-muted text-neutral-500'}`}
                      >
                        {unit === 'both' ? 'Both' : (unit === 'C' ? 'Celsius' : 'Fahrenheit')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-neutral-900 rounded-xl border border-border-muted">
                  <div>
                    <p className="text-[10px] font-bold text-neutral-100 uppercase">Circle Mode</p>
                    <p className="text-[8px] text-neutral-500">Enable rounded tactile interface</p>
                  </div>
                  <button 
                    onClick={() => setIsCircleMode(!isCircleMode)}
                    className={`w-10 h-5 rounded-full transition-all relative ${isCircleMode ? 'bg-emerald-500' : 'bg-neutral-800'}`}
                  >
                    <motion.div 
                      animate={{ x: isCircleMode ? 20 : 2 }}
                      className="absolute top-1 left-0 w-3 h-3 bg-white rounded-full shadow-sm"
                    />
                  </button>
                </div>
              </div>

              <div className="p-4 bg-neutral-950 rounded-xl border border-border-muted text-center">
                <p className="tech-label text-[9px] text-neutral-600 italic">System Version: 2.4.0-PRO</p>
              </div>
            </div>

            <div className="glass-card p-8 space-y-8 border-rose-500/20">
              <div className="flex items-center gap-3 mb-2">
                <ShieldCheck className="text-rose-500" size={20} />
                <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-widest">Safety Controls</h2>
              </div>
              
              <div className="space-y-6">
                <div className="p-6 bg-rose-500/5 rounded-2xl border border-rose-500/20 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-rose-500/10 text-rose-500">
                      <AlertTriangle size={24} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-neutral-100 uppercase tracking-tight">Emergency Stop</p>
                      <p className="text-[10px] text-neutral-500 leading-relaxed">
                        Immediately halts all automated irrigation and nutrient delivery systems. 
                        Use only in critical hardware failure or safety breach scenarios.
                      </p>
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => setIsEmergencyStop(!isEmergencyStop)}
                    className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center gap-3 ${
                      isEmergencyStop 
                        ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)]' 
                        : 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_20px_rgba(225,29,72,0.3)]'
                    }`}
                  >
                    {isEmergencyStop ? (
                      <>
                        <RefreshCw size={16} />
                        Resume Systems
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={16} />
                        Activate Emergency Stop
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="glass-card p-8 flex flex-col justify-center items-center text-center gap-6">
              <div className="p-6 rounded-full bg-neutral-900 border border-border-muted">
                <ShieldCheck size={48} className="text-neutral-700" />
              </div>
              <h3 className="text-lg font-bold text-neutral-100 uppercase tracking-widest">System Calibration</h3>
              <p className="text-xs text-neutral-500 max-w-xs leading-relaxed">
                Adjust these thresholds to calibrate the "Health Score" and "AI Analysis" for your specific crop type and soil environment.
              </p>
              <button 
                onClick={() => setThresholds({
                  nitrogen: { min: 20, max: 80 },
                  phosphorus: { min: 20, max: 80 },
                  potassium: { min: 20, max: 80 },
                  temp: { min: 15, max: 35 },
                  humidity: { min: 30, max: 80 }
                })}
                className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg tech-label text-[9px] transition-colors border border-border-muted"
              >
                Reset to Factory Defaults
              </button>
            </div>
          </motion.div>
        ) : (
          <div />
        )}
          </AnimatePresence>
          </div>
        </div>
        
        </main>

      {/* Status Messages */}
      <AnimatePresence>
        {showLoginTroubleshooter && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-neutral-950/80 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-md bg-neutral-900 border border-emerald-500/30 rounded-2xl p-8 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
              
              <div className="flex flex-col items-center text-center gap-6">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                  <ShieldCheck size={32} />
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-white">Login Trouble?</h3>
                  <p className="text-sm text-neutral-400">
                    Your browser might be blocking the login window because this app is running inside a preview iframe.
                  </p>
                </div>

                <div className="bg-neutral-800/50 rounded-xl p-4 w-full text-left space-y-4">
                  <div className="flex gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 text-[10px] font-bold">1</div>
                    <p className="text-xs text-neutral-300 italic">Open the app in a dedicated tab to bypass security restrictions.</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 text-[10px] font-bold">2</div>
                    <p className="text-xs text-neutral-300 italic">Ensure you have added the current URL to your Firebase Authorized Domains.</p>
                  </div>
                </div>

                <div className="flex flex-col w-full gap-3">
                  <a 
                    href={window.location.href} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                    onClick={() => setShowLoginTroubleshooter(false)}
                  >
                    <ArrowRight size={16} />
                    OPEN IN NEW TAB & LOG IN
                  </a>
                  
                  <button 
                    onClick={() => handleLogin(true)}
                    className="w-full py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-sm font-bold transition-all"
                  >
                    TRY REDIRECT METHOD (IFRAME)
                  </button>
                  
                  <button 
                    onClick={() => setShowLoginTroubleshooter(false)}
                    className="text-xs text-neutral-500 hover:text-neutral-400 py-1"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className={`fixed bottom-8 left-1/2 z-[100] px-6 py-3 rounded-xl border shadow-2xl flex items-center gap-3 backdrop-blur-md ${
              statusMessage.type === 'error' ? 'bg-rose-500/90 border-rose-400 text-white' :
              statusMessage.type === 'success' ? 'bg-emerald-500/90 border-emerald-400 text-white' :
              'bg-blue-600/90 border-blue-400 text-white'
            }`}
          >
            {statusMessage.type === 'error' ? <AlertTriangle size={18} /> : 
             statusMessage.type === 'success' ? <ShieldCheck size={18} /> : <Info size={18} />}
            <span className="text-xs font-bold uppercase tracking-wider">{statusMessage.text}</span>
            <button onClick={() => setStatusMessage(null)} className="ml-2 hover:opacity-70 transition-opacity">
              <LogOut size={14} className="rotate-45" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card max-w-md w-full p-8 border-rose-500/30 text-center space-y-6"
            >
              <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500 mb-2">
                <Trash2 size={32} />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-black text-neutral-100 uppercase tracking-tighter">Clear History?</h2>
                <p className="text-xs text-neutral-500 leading-relaxed uppercase tracking-widest">
                  This will permanently delete all sensor readings from the database. This action cannot be undone.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="py-3 rounded-xl tech-label text-[10px] bg-neutral-900 text-neutral-400 border border-border-muted hover:border-neutral-700 transition-all font-bold"
                >
                  CANCEL
                </button>
                <button 
                  onClick={executeClearHistory}
                  className="py-3 rounded-xl tech-label text-[10px] bg-rose-600 text-white border border-rose-400 hover:bg-rose-500 transition-all font-bold shadow-[0_0_20px_rgba(225,29,72,0.3)]"
                >
                  YES, PURGE DATA
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Crop Modal */}
      <AnimatePresence>
        {showAddCropModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddCropModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-neutral-900 border border-neutral-800 w-full max-w-md p-8 shadow-2xl rounded-3xl"
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30">
                  <BrainCircuit className="text-emerald-500" size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-neutral-100 italic uppercase tracking-tighter">Plant Intelligence Scout</h3>
                  <p className="text-[10px] text-neutral-500 mt-1 uppercase tracking-widest font-black leading-none">AI-Powered Global Scouting</p>
                </div>
                
                <p className="text-xs text-neutral-400 font-medium leading-relaxed">
                  Enter any plant or crop. Our AI will scout global agricultural databases to determine optimal NPK levels, environment requirements, and growth strategies.
                </p>

                <div className="w-full space-y-4 mt-4">
                  <div className="relative">
                    <input 
                      type="text"
                      placeholder="e.g. Lavender, Mango, Cannabis..."
                      value={newCropName}
                      onChange={(e) => setNewCropName(e.target.value)}
                      disabled={isScouting}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCrop()}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-4 text-sm text-neutral-200 placeholder:text-neutral-700 focus:outline-none focus:border-emerald-500/50 transition-all font-bold tracking-tight"
                    />
                    {isScouting && (
                      <motion.div 
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                        className="absolute right-4 top-1/2 -translate-y-1/2"
                      >
                        <RefreshCw size={18} className="text-emerald-500" />
                      </motion.div>
                    )}
                  </div>
                  
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setShowAddCropModal(false)}
                      disabled={isScouting}
                      className="flex-1 py-4 bg-neutral-900 text-neutral-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-all border border-neutral-800"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleAddCrop}
                      disabled={isScouting || !newCropName.trim()}
                      className="flex-[2] py-4 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2"
                    >
                      {isScouting ? 'Scouting Global Data...' : 'Initiate Scouting'}
                      {!isScouting && <ArrowRight size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Progress Overlay */}
      <AnimatePresence>
        {clearingHistory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex flex-col items-center justify-center p-4"
          >
            <div className="relative w-24 h-24 mb-6">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 rounded-full border-2 border-t-emerald-500 border-r-transparent border-b-transparent border-l-transparent"
              />
              <div className="absolute inset-0 flex items-center justify-center text-emerald-500">
                <Database size={32} className="animate-pulse" />
              </div>
            </div>
            <p className="tech-label text-xs text-emerald-500 animate-pulse tracking-[0.2em] font-black">PURGING DATABASE</p>
            <p className="text-[10px] text-neutral-500 mt-2 uppercase">Please do not close this window</p>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showInfoModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowInfoModal(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-neutral-900 border border-neutral-800 w-full max-w-lg p-8 shadow-2xl rounded-3xl overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4">
                <button 
                  onClick={() => setShowInfoModal(null)}
                  className="p-2 text-neutral-500 hover:text-neutral-200 hover:bg-white/5 rounded-full transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-[8px] font-black text-amber-500 uppercase tracking-widest">
                    Plant Intel
                  </div>
                  <div className="px-3 py-1 bg-neutral-800 rounded-full text-[8px] font-black text-neutral-500 uppercase tracking-widest">
                    {showInfoModal.category}
                  </div>
                </div>
                <h3 className="text-3xl font-black text-white uppercase tracking-tight mb-2">
                  {showInfoModal.name}
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed font-medium">
                  {showInfoModal.description}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-neutral-950/50 p-4 rounded-2xl border border-neutral-800/50">
                  <div className="flex items-center gap-2 mb-2 text-amber-500">
                    <LucideGauge size={14} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Difficulty</span>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <div 
                        key={s} 
                        className={`h-1.5 flex-grow rounded-full transition-all ${
                          s <= (showInfoModal.difficulty || 3) 
                            ? 'bg-amber-500 glow-amber' 
                            : 'bg-neutral-800'
                        }`} 
                      />
                    ))}
                  </div>
                  <p className="text-[9px] mt-2 font-bold text-neutral-500 uppercase">
                    Level {(showInfoModal.difficulty || 3)} / 5
                  </p>
                </div>

                <div className="bg-neutral-950/50 p-4 rounded-2xl border border-neutral-800/50">
                  <div className="flex items-center gap-2 mb-2 text-blue-500">
                    <Droplets size={14} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Water Needs</span>
                  </div>
                  <p className="text-xl font-black text-white uppercase italic tracking-tight">
                    {showInfoModal.waterNeeds || 'Medium'}
                  </p>
                  <p className="text-[9px] mt-1 font-bold text-neutral-500 uppercase">
                    Frequency Rating
                  </p>
                </div>

                <div className="bg-neutral-950/50 p-4 rounded-2xl border border-neutral-800/50">
                  <div className="flex items-center gap-2 mb-2 text-emerald-500">
                    <Zap size={14} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Management</span>
                  </div>
                  <p className="text-xl font-black text-white uppercase italic tracking-tight">
                    {showInfoModal.managementLevel || 'Standard'}
                  </p>
                  <p className="text-[9px] mt-1 font-bold text-neutral-500 uppercase">
                    Attention Level
                  </p>
                </div>

                <div className="bg-neutral-950/50 p-4 rounded-2xl border border-neutral-800/50">
                  <div className="flex items-center gap-2 mb-2 text-purple-500">
                    <Calendar size={14} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Harvest Window</span>
                  </div>
                  <p className="text-xl font-black text-white uppercase italic tracking-tight">
                    {showInfoModal.daysToHarvest || '??'} Days
                  </p>
                  <p className="text-[9px] mt-1 font-bold text-neutral-500 uppercase">
                    From Seeds/Transplant
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-2 border-t border-neutral-800">
                <div className="flex-grow">
                  <div className="text-[8px] font-black text-neutral-500 uppercase tracking-widest mb-1">Target NPK Baseline</div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-neutral-300">N: {showInfoModal.idealNPK.n}</span>
                    <span className="text-xs font-bold text-neutral-300">P: {showInfoModal.idealNPK.p}</span>
                    <span className="text-xs font-bold text-neutral-300">K: {showInfoModal.idealNPK.k}</span>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setSelectedCrop(showInfoModal);
                    setShowInfoModal(null);
                  }}
                  className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95"
                >
                  Set as Target
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
