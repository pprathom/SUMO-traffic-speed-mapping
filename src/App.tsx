/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import {
  Upload,
  FileText,
  Settings,
  Play,
  Download,
  BarChart3,
  Table as TableIcon,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Info,
  BookOpen,
  Cpu,
  Layers,
  Zap,
  Map as MapIcon,
  Moon,
  Sun,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

import { SumoNetwork } from './lib/sumo-parser';
import { TrafficProcessor, ProcessingOptions } from './lib/processor';
import { ProbePoint, SpeedResult } from './lib/types';
import MapView from './components/MapView';

/** Utility for Tailwind class merging */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  // State
  const [probeFiles, setProbeFiles] = useState<File[]>([]);
  const [netFile, setNetFile] = useState<File | null>(null);
  const [network, setNetwork] = useState<SumoNetwork | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<SpeedResult[]>([]);
  const [probePoints, setProbePoints] = useState<ProbePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'table' | 'chart' | 'tti' | 'map'>('table');

  // Map state
  const [mapDate, setMapDate] = useState<string>('');
  const [mapTimeSlot, setMapTimeSlot] = useState<string>('');
  const [mapMetric, setMapMetric] = useState<'speed' | 'tti'>('tti');
  const [mapDirection, setMapDirection] = useState<'all' | 'l' | 's' | 'r'>('all');
  const [isMapDarkMode, setIsMapDarkMode] = useState<boolean>(true);
  const [showRawPoints, setShowRawPoints] = useState<boolean>(false);
  
  useEffect(() => {
    if (activeTab === 'map' && results.length > 0 && (!mapDate || !mapTimeSlot)) {
      setMapDate(results[0].date);
      setMapTimeSlot(results[0].timeSlot);
    }
  }, [activeTab, results, mapDate, mapTimeSlot]);

  // Configuration
  const [options, setOptions] = useState<ProcessingOptions>({
    onlyTaxisWithPassengers: true,
    minGpsValid: 1,
    radius: 50,
    filterStationary: true,
    stationaryThreshold: 1.0,
    timeBinSize: 15,
  });

  // Handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'probe' | 'net') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    if (type === 'probe') {
      setProbeFiles(Array.from(files));
    } else {
      setNetFile(files[0]);
    }
    setError(null);
  };

  const clearFiles = () => {
    setProbeFiles([]);
    setNetFile(null);
    setResults([]);
    setProbePoints([]);
    setMapDate('');
    setMapTimeSlot('');
    setError(null);
  };

  const runProcessing = async () => {
    if (probeFiles.length === 0 || !netFile) {
      setError('Please upload at least one Probe CSV and the SUMO .net.xml file.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // 1. Read SUMO Network
      const netText = await netFile.text();
      const loadedNetwork = new SumoNetwork(netText);
      setNetwork(loadedNetwork);

      // 2. Read all Probe Data files
      const allProbeData: ProbePoint[] = [];
      
      for (const file of probeFiles) {
        const probeData: ProbePoint[] = await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: false,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
              const data = results.data.map((row: any) => {
                let ts = row[4];
                if (typeof ts === 'string') {
                  ts = ts.replace(' ', 'T');
                }
                const timestamp = new Date(ts).getTime();

                return {
                  vehicleId: row[0]?.toString(),
                  gpsValid: Number(row[1] ?? 1),
                  lat: Number(row[2]),
                  lon: Number(row[3]),
                  timestamp: isNaN(timestamp) ? Date.now() : timestamp,
                  speed: Number(row[5]),
                  heading: Number(row[6]),
                  forHireLight: Number(row[7]),
                  engineAcc: Number(row[8]),
                };
              }).filter((p: any) => 
                !isNaN(p.lat) && !isNaN(p.lon) && 
                loadedNetwork.isWithinBounds(p.lat, p.lon)
              );
              resolve(data);
            },
            error: (err) => reject(err),
          });
        });
        for (const p of probeData) {
          allProbeData.push(p);
        }
      }

      // 3. Process
      const processor = new TrafficProcessor(loadedNetwork);
      const processedResults = processor.process(allProbeData, options);

      // Final sorting to ensure UI is consistent
      processedResults.sort((a, b) => a.date.localeCompare(b.date) || a.timeSlot.localeCompare(b.timeSlot));

      setResults(processedResults);
      setProbePoints(allProbeData);
      
      // Force pick the first date from NEW results
      if (processedResults.length > 0) {
        setMapDate(processedResults[0].date);
        setMapTimeSlot(processedResults[0].timeSlot);
      } else {
        setMapDate('');
        setMapTimeSlot('');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during processing.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadCSV = () => {
    if (results.length === 0) return;
    const csv = Papa.unparse(results);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `traffic_speeds_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Derived
  const transformer = useMemo(() => {
    if (!network) return null;
    return new TrafficProcessor(network).getTransformer();
  }, [network]);

  // Chart Data
  const chartData = useMemo(() => {
    // Group by date and time slot
    const groups: Record<string, { all: number[]; left: number[]; through: number[]; right: number[]; tti: number[] }> = {};
    const uniqueDates = new Set(results.map(r => r.date));
    const isMultiDay = uniqueDates.size > 1;

    results.forEach((r) => {
      const key = isMultiDay ? `${r.date} ${r.timeSlot}` : r.timeSlot;
      if (!groups[key]) {
        groups[key] = { all: [], left: [], through: [], right: [], tti: [] };
      }
      if (r.speedAll !== null) groups[key].all.push(r.speedAll);
      if (r.speedLeft !== null) groups[key].left.push(r.speedLeft);
      if (r.speedThrough !== null) groups[key].through.push(r.speedThrough);
      if (r.speedRight !== null) groups[key].right.push(r.speedRight);
      if (r.tti !== null) groups[key].tti.push(r.tti);
    });

    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, speeds]) => ({
        time: label,
        Overall: speeds.all.length > 0 ? speeds.all.reduce((a, b) => a + b, 0) / speeds.all.length : 0,
        Left: speeds.left.length > 0 ? speeds.left.reduce((a, b) => a + b, 0) / speeds.left.length : 0,
        Through:
          speeds.through.length > 0
            ? speeds.through.reduce((a, b) => a + b, 0) / speeds.through.length
            : 0,
        Right:
          speeds.right.length > 0 ? speeds.right.reduce((a, b) => a + b, 0) / speeds.right.length : 0,
        TTI: speeds.tti.length > 0 ? speeds.tti.reduce((a, b) => a + b, 0) / speeds.tti.length : 0,
      }));
  }, [results]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <BarChart3 className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">SUMO Traffic Speed Mapper</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Traffic Engineering Tool
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={clearFiles}
            className="text-slate-400 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50"
            title="Clear all data"
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            System Ready
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 bg-white border-r border-slate-200 overflow-y-auto p-6 flex flex-col gap-8">
          {/* File Upload Section */}
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <FileText className="w-4 h-4" /> Data Input
            </h2>

            <div className="space-y-4">
              {/* Probe CSV */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Probe Data (CSV)</label>
                <div
                  className={cn(
                    'relative border-2 border-dashed rounded-xl p-4 transition-all group',
                    probeFiles.length > 0
                      ? 'border-indigo-200 bg-indigo-50/30'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                  )}
                >
                  <input
                    type="file"
                    accept=".csv"
                    multiple
                    onChange={(e) => handleFileUpload(e, 'probe')}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center text-center gap-2">
                    {probeFiles.length > 0 ? (
                      <>
                        <CheckCircle2 className="w-6 h-6 text-indigo-500" />
                        <span className="text-xs font-medium text-indigo-700 truncate max-w-[200px]">
                          {probeFiles.length} files selected
                        </span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-slate-400 group-hover:text-indigo-400" />
                        <span className="text-xs text-slate-500">Upload CSV files (Multiple allowed)</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* SUMO Network */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">SUMO Network (.net.xml)</label>
                <div
                  className={cn(
                    'relative border-2 border-dashed rounded-xl p-4 transition-all group',
                    netFile
                      ? 'border-indigo-200 bg-indigo-50/30'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                  )}
                >
                  <input
                    type="file"
                    accept=".xml"
                    onChange={(e) => handleFileUpload(e, 'net')}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center text-center gap-2">
                    {netFile ? (
                      <>
                        <CheckCircle2 className="w-6 h-6 text-indigo-500" />
                        <span className="text-xs font-medium text-indigo-700 truncate max-w-[200px]">
                          {netFile.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-slate-400 group-hover:text-indigo-400" />
                        <span className="text-xs text-slate-500">Upload .net.xml file</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Configuration Section */}
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Settings className="w-4 h-4" /> Configuration
            </h2>

            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-700">Taxis w/ Passengers</span>
                  <span className="text-[10px] text-slate-400">Filter for_hire_light == 0</span>
                </div>
                <button
                  onClick={() => setOptions((prev) => ({ ...prev, onlyTaxisWithPassengers: !prev.onlyTaxisWithPassengers }))}
                  className={cn(
                    'w-10 h-5 rounded-full transition-colors relative',
                    options.onlyTaxisWithPassengers ? 'bg-indigo-600' : 'bg-slate-200'
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-1 w-3 h-3 bg-white rounded-full transition-all',
                      options.onlyTaxisWithPassengers ? 'left-6' : 'left-1'
                    )}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-700">Filter Stationary</span>
                  <span className="text-[10px] text-slate-400">Exclude speeds ≤ {options.stationaryThreshold} km/h</span>
                </div>
                <button
                  onClick={() => setOptions((prev) => ({ ...prev, filterStationary: !prev.filterStationary }))}
                  className={cn(
                    'w-10 h-5 rounded-full transition-colors relative',
                    options.filterStationary ? 'bg-indigo-600' : 'bg-slate-200'
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-1 w-3 h-3 bg-white rounded-full transition-all',
                      options.filterStationary ? 'left-6' : 'left-1'
                    )}
                  />
                </button>
              </div>

              {options.filterStationary && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Stationary Threshold</span>
                    <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                      {options.stationaryThreshold} km/h
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={options.stationaryThreshold}
                    onChange={(e) => setOptions((prev) => ({ ...prev, stationaryThreshold: Number(e.target.value) }))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Search Radius</span>
                  <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                    {options.radius}m
                  </span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="200"
                  step="10"
                  value={options.radius}
                  onChange={(e) => setOptions((prev) => ({ ...prev, radius: Number(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Min GPS Validity</span>
                  <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                    {options.minGpsValid}
                  </span>
                </div>
                <select
                  value={options.minGpsValid}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, minGpsValid: Number(e.target.value) }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                >
                  <option value={0}>Any (0+)</option>
                  <option value={1}>Valid Only (1)</option>
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Time Interval</span>
                  <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                    {options.timeBinSize} min
                  </span>
                </div>
                <select
                  value={options.timeBinSize}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, timeBinSize: Number(e.target.value) }))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                >
                  <option value={15}>15 Minutes</option>
                  <option value={30}>30 Minutes</option>
                  <option value={60}>1 Hour</option>
                </select>
              </div>
            </div>
          </section>

          <div className="mt-auto pt-6 border-t border-slate-100">
            <button
              onClick={runProcessing}
              disabled={isProcessing || probeFiles.length === 0 || !netFile}
              className={cn(
                'w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-200 active:scale-[0.98]',
                isProcessing || probeFiles.length === 0 || !netFile
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              )}
            >
              {isProcessing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  Run Analysis
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-700"
              >
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-bold">Processing Error</p>
                  <p>{error}</p>
                </div>
              </motion.div>
            )}

            {results.length > 0 ? (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-8"
              >
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Total Links
                    </p>
                    <p className="text-3xl font-black text-slate-900">
                      {new Set(results.map((r) => r.linkId)).size}
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Time Slots
                    </p>
                    <p className="text-3xl font-black text-slate-900">
                      {new Set(results.map((r) => r.timeSlot)).size}
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Avg. Speed
                    </p>
                    <p className="text-3xl font-black text-indigo-600">
                      {(
                        results.reduce((acc, r) => acc + (r.speedThrough || 0), 0) / results.length
                      ).toFixed(1)}
                      <span className="text-sm font-medium text-slate-400 ml-1">km/h</span>
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Avg. TTI
                    </p>
                    <p className="text-3xl font-black text-red-600">
                      {(
                        results.reduce((acc, r) => acc + (r.tti || 1), 0) / results.length
                      ).toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
                    <button
                      onClick={downloadCSV}
                      className="flex items-center justify-center gap-2 w-full py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors font-bold text-sm"
                    >
                      <Download className="w-4 h-4" /> Export Data
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="flex border-b border-slate-100 bg-slate-50/50">
                    <button
                      onClick={() => setActiveTab('table')}
                      className={cn(
                        'px-6 py-4 text-sm font-bold flex items-center gap-2 transition-all border-b-2',
                        activeTab === 'table'
                          ? 'text-indigo-600 border-indigo-600 bg-white'
                          : 'text-slate-400 border-transparent hover:text-slate-600'
                      )}
                    >
                      <TableIcon className="w-4 h-4" /> Data Table
                    </button>
                    <button
                      onClick={() => setActiveTab('chart')}
                      className={cn(
                        'px-6 py-4 text-sm font-bold flex items-center gap-2 transition-all border-b-2',
                        activeTab === 'chart'
                          ? 'text-indigo-600 border-indigo-600 bg-white'
                          : 'text-slate-400 border-transparent hover:text-slate-600'
                      )}
                    >
                      <BarChart3 className="w-4 h-4" /> Speed Trends
                    </button>
                    <button
                      onClick={() => setActiveTab('tti')}
                      className={cn(
                        'px-6 py-4 text-sm font-bold flex items-center gap-2 transition-all border-b-2',
                        activeTab === 'tti'
                          ? 'text-indigo-600 border-indigo-600 bg-white'
                          : 'text-slate-400 border-transparent hover:text-slate-600'
                      )}
                    >
                      <AlertCircle className="w-4 h-4" /> TTI Analysis
                    </button>
                    <button
                      onClick={() => setActiveTab('map')}
                      className={cn(
                        'px-6 py-4 text-sm font-bold flex items-center gap-2 transition-all border-b-2',
                        activeTab === 'map'
                          ? 'text-indigo-600 border-indigo-600 bg-white'
                          : 'text-slate-400 border-transparent hover:text-slate-600'
                      )}
                    >
                      <MapIcon className="w-4 h-4" /> Map View
                    </button>
                  </div>

                  <div className="p-6">
                    {activeTab === 'table' ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-slate-400 font-bold border-b border-slate-100">
                              <th className="pb-4 pr-4">Date</th>
                              <th className="pb-4 pr-4">Link (ID/Name)</th>
                              <th className="pb-4 pr-4">Time Slot</th>
                              <th className="pb-4 pr-4">Overall (km/h)</th>
                              <th className="pb-4 pr-4">Left (km/h)</th>
                              <th className="pb-4 pr-4">Through (km/h)</th>
                              <th className="pb-4 pr-4">Right (km/h)</th>
                              <th className="pb-4 pr-4">TTI</th>
                              <th className="pb-4 pr-4 text-right">Veh (N)</th>
                              <th className="pb-4 pr-4 text-right">Pts</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {results.slice(0, 100).map((r, i) => (
                              <tr key={i} className="hover:bg-slate-50 transition-colors group">
                                <td className="py-3 pr-4 font-mono text-xs text-slate-400">
                                  {r.date}
                                </td>
                                <td className="py-3 pr-4">
                                  <div className="flex flex-col">
                                    <span className="font-mono text-xs text-slate-500">{r.linkId}</span>
                                    {r.linkName && (
                                      <span className="text-[10px] text-slate-400 font-medium truncate max-w-[150px]">
                                        {r.linkName}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 pr-4 font-medium">{r.timeSlot}</td>
                                <td className="py-3 pr-4">
                                  {r.speedAll !== null ? (
                                    <span className="text-slate-900 font-bold">
                                      {r.speedAll.toFixed(1)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="py-3 pr-4">
                                  {r.speedLeft !== null ? (
                                    <span className="text-indigo-600 font-semibold">
                                      {r.speedLeft.toFixed(1)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="py-3 pr-4">
                                  {r.speedThrough !== null ? (
                                    <span className="text-emerald-600 font-semibold">
                                      {r.speedThrough.toFixed(1)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="py-3 pr-4">
                                  {r.speedRight !== null ? (
                                    <span className="text-amber-600 font-semibold">
                                      {r.speedRight.toFixed(1)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="py-3 pr-4">
                                  {r.tti !== null ? (
                                    <span className={cn(
                                      "px-2 py-0.5 rounded text-xs font-bold",
                                      r.tti > 2.0 ? "bg-red-100 text-red-700" :
                                      r.tti > 1.5 ? "bg-orange-100 text-orange-700" :
                                      r.tti > 1.2 ? "bg-yellow-100 text-yellow-700" :
                                      "bg-emerald-100 text-emerald-700"
                                    )}>
                                      {r.tti.toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="py-3 pr-4 text-right font-mono text-slate-400">
                                  {r.n}
                                </td>
                                <td className="py-3 pr-4 text-right font-mono text-slate-300">
                                  {r.totalPoints}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {results.length > 100 && (
                          <div className="mt-4 text-center text-xs text-slate-400 font-medium">
                            Showing first 100 of {results.length} records. Export to see full data.
                          </div>
                        )}
                      </div>
                    ) : activeTab === 'chart' ? (
                      <div className="h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis
                              dataKey="time"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#94a3b8', fontSize: 10 }}
                              dy={10}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#94a3b8', fontSize: 12 }}
                              label={{
                                value: 'Avg. Harmonic Speed (km/h)',
                                angle: -90,
                                position: 'insideLeft',
                                fill: '#94a3b8',
                                fontSize: 12,
                              }}
                            />
                            <Tooltip
                              contentStyle={{
                                borderRadius: '12px',
                                border: 'none',
                                boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                              }}
                            />
                            <Legend verticalAlign="top" align="right" height={36} />
                            <Bar dataKey="Overall" fill="#64748b" radius={[4, 4, 0, 0]} name="Overall Avg" />
                            <Bar dataKey="Left" fill="#6366f1" radius={[4, 4, 0, 0]} name="Left Turn" />
                            <Bar dataKey="Through" fill="#10b981" radius={[4, 4, 0, 0]} name="Through" />
                            <Bar dataKey="Right" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Right Turn" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : activeTab === 'tti' ? (
                      <div className="w-full">
                        <div className="h-[400px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis
                                dataKey="time"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 10 }}
                                dy={10}
                              />
                              <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 12 }}
                                label={{
                                  value: 'Travel Time Index (TTI)',
                                  angle: -90,
                                  position: 'insideLeft',
                                  fill: '#94a3b8',
                                  fontSize: 12,
                                }}
                              />
                              <Tooltip
                                contentStyle={{
                                  borderRadius: '12px',
                                  border: 'none',
                                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                }}
                              />
                              <Bar
                                dataKey="TTI"
                                fill="#ef4444"
                                radius={[4, 4, 0, 0]}
                                name="Avg. TTI"
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="mt-8 flex flex-wrap justify-center gap-6 text-xs border-t border-slate-100 pt-6">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-emerald-100 border border-emerald-200 rounded" />
                            <span className="text-slate-500">TTI ≤ 1.2 (ปกติ)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-yellow-100 border border-yellow-200 rounded" />
                            <span className="text-slate-500">TTI 1.2 - 1.5 (เริ่มหนาแน่น)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-orange-100 border border-orange-200 rounded" />
                            <span className="text-slate-500">TTI 1.5 - 2.0 (ติดขัด)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-red-100 border border-red-200 rounded" />
                            <span className="text-slate-500">TTI {'>'} 2.0 (ติดขัดมาก)</span>
                          </div>
                        </div>
                      </div>
                    ) : activeTab === 'map' ? (
                      <div className="space-y-6">
                        <div className="flex flex-wrap items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Analysis Date</label>
                            <select
                              value={mapDate}
                              onChange={(e) => setMapDate(e.target.value)}
                              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              {Array.from(new Set(results.map(r => r.date))).sort().map(d => (
                                <option key={d} value={d}>{d}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Time Slot</label>
                            <select
                              value={mapTimeSlot}
                              onChange={(e) => setMapTimeSlot(e.target.value)}
                              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              {Array.from(new Set(results.filter(r => r.date === mapDate).map(r => r.timeSlot))).sort().map(ts => (
                                <option key={ts} value={ts}>{ts}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Visualization Metric</label>
                            <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
                              <button
                                onClick={() => setMapMetric('speed')}
                                className={cn(
                                  "px-3 py-1 rounded-md text-xs font-bold transition-all",
                                  mapMetric === 'speed' ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                                )}
                              >
                                Speed
                              </button>
                              <button
                                onClick={() => setMapMetric('tti')}
                                className={cn(
                                  "px-3 py-1 rounded-md text-xs font-bold transition-all",
                                  mapMetric === 'tti' ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                                )}
                              >
                                TTI
                              </button>
                            </div>
                          </div>
                          
                          {mapMetric === 'speed' && (
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase">Direction</label>
                              <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
                                <button
                                  onClick={() => setMapDirection('all')}
                                  className={cn(
                                    "px-2 py-1 rounded-md text-[10px] font-bold transition-all",
                                    mapDirection === 'all' ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                                  )}
                                >
                                  All
                                </button>
                                <button
                                  onClick={() => setMapDirection('s')}
                                  className={cn(
                                    "px-2 py-1 rounded-md text-[10px] font-bold transition-all",
                                    mapDirection === 's' ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                                  )}
                                >
                                  Straight
                                </button>
                                <button
                                  onClick={() => setMapDirection('l')}
                                  className={cn(
                                    "px-2 py-1 rounded-md text-[10px] font-bold transition-all",
                                    mapDirection === 'l' ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                                  )}
                                >
                                  Left
                                </button>
                                <button
                                  onClick={() => setMapDirection('r')}
                                  className={cn(
                                    "px-2 py-1 rounded-md text-[10px] font-bold transition-all",
                                    mapDirection === 'r' ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                                  )}
                                >
                                  Right
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Map Style</label>
                            <button
                              onClick={() => setIsMapDarkMode(!isMapDarkMode)}
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                                isMapDarkMode 
                                  ? "bg-slate-800 text-slate-100 border-slate-700 hover:bg-slate-700" 
                                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                              )}
                            >
                              {isMapDarkMode ? (
                                <><Moon className="w-3 h-3" /> Dark</>
                              ) : (
                                <><Sun className="w-3 h-3" /> Light</>
                              )}
                            </button>
                          </div>

                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Verification</label>
                            <button
                              onClick={() => setShowRawPoints(!showRawPoints)}
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                                showRawPoints 
                                  ? "bg-amber-100 text-amber-700 border-amber-300" 
                                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                              )}
                            >
                              <Zap className={cn("w-3 h-3", showRawPoints ? "fill-amber-500 text-amber-500" : "text-slate-400")} />
                              GPS Points
                            </button>
                          </div>

                          <div className="ml-auto text-[10px] text-slate-400 italic">
                            Click on links for detailed info
                          </div>
                        </div>

                        {network && transformer && (
                          <MapView
                            network={network}
                            results={results}
                            probePoints={probePoints}
                            transformer={transformer}
                            selectedDate={mapDate}
                            selectedTimeSlot={mapTimeSlot}
                            timeBinSize={options.timeBinSize}
                            metric={mapMetric}
                            direction={mapDirection}
                            isDarkMode={isMapDarkMode}
                            showRawPoints={showRawPoints}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center p-20 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                        Select a tab to visualize results
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-4xl mx-auto space-y-12 py-8"
              >
                {/* Hero Section */}
                <div className="text-center space-y-4">
                  <div className="inline-flex p-4 bg-indigo-50 rounded-2xl mb-2">
                    <Play className="w-10 h-10 text-indigo-600 fill-current opacity-20" />
                  </div>
                  <h3 className="text-3xl font-black text-slate-900 tracking-tight">พร้อมสำหรับการวิเคราะห์</h3>
                  <p className="text-slate-500 max-w-lg mx-auto leading-relaxed">
                    อัปโหลดข้อมูล GPS Probe และไฟล์ SUMO Network เพื่อเริ่มการทำ Map Matching และวิเคราะห์ความเร็วการจราจร
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Principles Section */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 text-indigo-600">
                      <Cpu className="w-6 h-6" />
                      <h4 className="text-lg font-bold">หลักการทำงาน (Principles)</h4>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex gap-4">
                          <div className="bg-blue-50 p-2 rounded-lg h-fit">
                            <Layers className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 mb-1">1. Map Matching</p>
                            <p className="text-sm text-slate-500 leading-relaxed">
                              ใช้พิกัด Lat/Lon แปลงเป็น Cartesian และค้นหาถนน (Edge) ที่ใกล้ที่สุดในรัศมีที่กำหนด เพื่อระบุว่ารถคันนั้นอยู่บนถนนเส้นใด
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex gap-4">
                          <div className="bg-emerald-50 p-2 rounded-lg h-fit">
                            <Zap className="w-5 h-5 text-emerald-600" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 mb-1">2. Direction Detection</p>
                            <p className="text-sm text-slate-500 leading-relaxed">
                              วิเคราะห์เส้นทาง (Trajectory) เพื่อดูว่ารถเลี้ยวซ้าย (L), ตรงไป (T), หรือเลี้ยวขวา (R) โดยใช้ข้อมูลการเชื่อมต่อ (Connections) จาก SUMO Network
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex gap-4">
                          <div className="bg-amber-50 p-2 rounded-lg h-fit">
                            <BarChart3 className="w-5 h-5 text-amber-600" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 mb-1">3. Speed Calculation</p>
                            <p className="text-sm text-slate-500 leading-relaxed">
                              คำนวณความเร็วเฉลี่ยแบบ Harmonic Mean (Space Mean Speed) เพื่อความแม่นยำตามหลักวิศวกรรมจราจร
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex gap-4">
                          <div className="bg-red-50 p-2 rounded-lg h-fit">
                            <AlertCircle className="w-5 h-5 text-red-600" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 mb-1">4. Travel Time Index (TTI)</p>
                            <p className="text-sm text-slate-500 leading-relaxed">
                              คำนวณ TTI เพื่อระบุคอขวด โดยเทียบความเร็วปัจจุบันกับ Free-flow Speed (ใช้ค่า 85th Percentile Speed ในช่วงเวลา 02:00 - 04:00 น. ของแต่ละถนน)
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Manual Section */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 text-indigo-600">
                      <BookOpen className="w-6 h-6" />
                      <h4 className="text-lg font-bold">คู่มือการใช้งาน (User Manual)</h4>
                    </div>

                    <div className="bg-slate-900 text-slate-300 p-6 rounded-2xl shadow-xl space-y-4">
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">1</div>
                        <p className="text-sm">อัปโหลดไฟล์ <span className="text-white font-medium">Probe CSV</span> (เลือกได้หลายไฟล์) และไฟล์ <span className="text-white font-medium">.net.xml</span> ของ SUMO</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">2</div>
                        <p className="text-sm">ปรับแต่ง <span className="text-white font-medium">Configuration</span> เช่น รัศมีการค้นหา, การกรองรถแท็กซี่ว่าง, หรือช่วงเวลาที่ต้องการสรุปผล</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">3</div>
                        <p className="text-sm">กดปุ่ม <span className="text-white font-medium">Run Analysis</span> เพื่อเริ่มการประมวลผล</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">4</div>
                        <p className="text-sm">ตรวจสอบผลลัพธ์ในรูปแบบ <span className="text-white font-medium">Table</span> หรือ <span className="text-white font-medium">Chart</span> และส่งออกข้อมูลเป็น CSV</p>
                      </div>
                    </div>

                    <div className="bg-indigo-50 border border-indigo-100 p-5 rounded-2xl">
                      <div className="flex gap-3">
                        <Info className="w-5 h-5 text-indigo-600 shrink-0" />
                        <p className="text-xs text-indigo-700 leading-relaxed">
                          <strong>หมายเหตุ:</strong> ข้อมูล GPS ควรมีคอลัมน์ตามลำดับ: VehicleID, gpsvalid, lat, lon, timestamp, speed, heading, for_hire_light, engine_acc เพื่อการประมวลผลที่ถูกต้อง
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
