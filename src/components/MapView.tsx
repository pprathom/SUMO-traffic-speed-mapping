import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Popup, ZoomControl, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { SumoNetwork } from '../lib/sumo-parser';
import { SpeedResult, ProbePoint } from '../lib/types';
import { CoordinateTransformer } from '../lib/coords';
import { clsx, type ClassValue } from 'clsx';

/** Utility for Tailwind class merging */
function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

interface MapViewProps {
  network: SumoNetwork;
  results: SpeedResult[];
  probePoints?: ProbePoint[];
  transformer: CoordinateTransformer;
  selectedDate: string;
  selectedTimeSlot: string;
  timeBinSize: number;
  metric: 'speed' | 'tti';
  direction: 'all' | 'l' | 's' | 'r';
  isDarkMode?: boolean;
  showRawPoints?: boolean;
}

const MapView: React.FC<MapViewProps> = ({
  network,
  results,
  probePoints = [],
  transformer,
  selectedDate,
  selectedTimeSlot,
  timeBinSize,
  metric,
  direction = 'all',
  isDarkMode = false,
  showRawPoints = false,
}) => {
  // Key to force refresh when critical parameters change
  const mapKey = useMemo(() => `${selectedDate}-${selectedTimeSlot}-${metric}-${direction}-${isDarkMode}-${showRawPoints}-${timeBinSize}`, [selectedDate, selectedTimeSlot, metric, direction, isDarkMode, showRawPoints, timeBinSize]);

  // Handle empty selection
  if (!selectedDate || !selectedTimeSlot) {
    return (
      <div className="h-[600px] flex items-center justify-center bg-slate-50 border border-slate-200 rounded-2xl">
        <div className="text-center">
          <p className="text-slate-400 mb-2">No selection active</p>
          <p className="text-xs text-slate-300">Please select a date and time slot to visualize traffic data.</p>
        </div>
      </div>
    );
  }

  // Filter results for the selected date and time
  const currentResultsMap = useMemo(() => {
    const map = new Map<string, SpeedResult>();
    results
      .filter((r) => r.date === selectedDate && r.timeSlot === selectedTimeSlot)
      .forEach((r) => map.set(r.linkId, r));
    return map;
  }, [results, selectedDate, selectedTimeSlot]);

  // Filter probe points for metadata visualization verification
  const visibleProbePoints = useMemo(() => {
    if (!showRawPoints) return [];
    
    return probePoints.filter(p => {
      const d = new Date(p.timestamp);
      const dateStr = d.toISOString().split('T')[0];
      if (dateStr !== selectedDate) return false;
      
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const totalMinutes = hours * 60 + minutes;
      const slotIndex = Math.floor(totalMinutes / timeBinSize);
      const slotStartMinutes = slotIndex * timeBinSize;
      const h = Math.floor(slotStartMinutes / 60);
      const m = slotStartMinutes % 60;
      const pointSlot = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      
      return pointSlot === selectedTimeSlot;
    });
  }, [probePoints, selectedDate, selectedTimeSlot, showRawPoints, timeBinSize]);

  // Transform edge shapes to Lat/Lon
  const edgesToRender = useMemo(() => {
    const rendered = [];
    for (const [id, edge] of network.edges.entries()) {
      if (edge.shape.length < 2) continue;
      
      const latLngs = edge.shape.map((p) => transformer.toWGS84(p[0], p[1]));
      const result = currentResultsMap.get(id);
      
      rendered.push({
        id,
        name: edge.name || id,
        latLngs,
        result,
      });
    }
    return rendered;
  }, [network, transformer, currentResultsMap]);

  // Determine bounds
  const bounds = useMemo(() => {
    if (edgesToRender.length === 0) return null;
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    edgesToRender.forEach((e) => {
      e.latLngs.forEach((coord) => {
        if (coord[0] < minLat) minLat = coord[0];
        if (coord[0] > maxLat) maxLat = coord[0];
        if (coord[1] < minLng) minLng = coord[1];
        if (coord[1] > maxLng) maxLng = coord[1];
      });
    });
    
    if (minLat === Infinity) return null;
    return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
  }, [edgesToRender]);

  const getColor = (value: number | null) => {
    if (value === null) return '#94a3b8'; // Gray (No Data)
    
    if (metric === 'tti') {
      if (value <= 1.2) return '#10b981'; // Emerald (Normal)
      if (value <= 1.5) return '#facc15'; // Yellow (Moderate)
      if (value <= 2.0) return '#f97316'; // Orange (Congested)
      return '#ef4444'; // Red (Heavy)
    } else {
      // Speed coloring
      if (value >= 40) return '#10b981';
      if (value >= 25) return '#facc15';
      if (value >= 10) return '#f97316';
      return '#ef4444';
    }
  };

  const getMetricValue = (result: SpeedResult | undefined) => {
    if (!result) return null;
    
    if (metric === 'tti') {
      return result.tti;
    } else {
      // Return speed based on selected direction
      switch(direction) {
        case 'l': return result.speedLeft;
        case 's': return result.speedThrough;
        case 'r': return result.speedRight;
        default: return result.speedAll;
      }
    }
  };

  if (!bounds) {
    return (
      <div className="h-[600px] flex items-center justify-center bg-slate-50 border border-slate-200 rounded-2xl">
        <p className="text-slate-400">Loading map data...</p>
      </div>
    );
  }

  // Tile layer configuration
  const tileUrl = isDarkMode 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const tileAttr = isDarkMode
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  return (
    <div className="h-[600px] rounded-2xl overflow-hidden border border-slate-200 shadow-sm relative group">
      <MapContainer
        key={mapKey}
        bounds={bounds}
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution={tileAttr}
          url={tileUrl}
        />
        <ZoomControl position="bottomright" />
        
        {edgesToRender.map((edge) => {
          const value = getMetricValue(edge.result);
          const color = getColor(value);
          const hasDataForDirection = value !== null;
          
          return (
            <Polyline
              key={edge.id}
              positions={edge.latLngs}
              color={color}
              weight={edge.result ? 6 : 2}
              opacity={hasDataForDirection ? 0.9 : (isDarkMode ? 0.1 : 0.2)}
              lineCap="round"
              lineJoin="round"
            >
              <Popup>
                <div className="p-1 min-w-[200px]">
                  <p className="font-bold text-slate-800 text-sm mb-0.5">{edge.name}</p>
                  <p className="text-[10px] text-slate-400 mb-3 tracking-wide">ID: {edge.id}</p>
                  
                  {edge.result ? (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Current View</span>
                        <span className="font-black text-indigo-600">
                          {metric === 'tti' 
                            ? (edge.result.tti?.toFixed(2) || 'N/A')
                            : (value?.toFixed(1) || 'N/A') + ' km/h'
                          }
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100 pb-1">Directional Speeds</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Straight:</span>
                            <span className="font-medium">{edge.result.speedThrough?.toFixed(1) || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Left:</span>
                            <span className="font-medium">{edge.result.speedLeft?.toFixed(1) || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Right:</span>
                            <span className="font-medium">{edge.result.speedRight?.toFixed(1) || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Sample:</span>
                            <span className="font-medium text-indigo-500">{edge.result.n}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 py-2 italic font-medium">No probe data for this time slot</p>
                  )}
                </div>
              </Popup>
            </Polyline>
          );
        })}

        {visibleProbePoints.map((p, idx) => (
          <CircleMarker
            key={`probe-${idx}`}
            center={[p.lat, p.lon]}
            radius={4}
            fillColor="#f59e0b"
            color="#fff"
            weight={1.5}
            fillOpacity={0.8}
          >
            <Popup>
              <div className="p-1">
                <p className="text-xs font-bold text-amber-600 mb-2 border-b border-amber-100 pb-1 uppercase tracking-tight">Raw GPS Probe</p>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">Vehicle ID:</span>
                    <p className="font-semibold">{p.vehicleId}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Speed:</span>
                    <p className="font-semibold">{p.speed.toFixed(1)} km/h</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Timestamp:</span>
                    <p className="font-semibold">{new Date(p.timestamp).toLocaleTimeString()}</p>
                  </div>
                  {p.edgeId ? (
                    <div className="pt-1 border-t border-slate-100 mt-1">
                      <span className="text-slate-400">Mapped Link ID:</span>
                      <p className="font-mono text-[10px] text-indigo-600 font-bold">{p.edgeId}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5 italic">Point contributed to this link's speed calculation.</p>
                    </div>
                  ) : p.filterReason ? (
                    <div className="pt-1 border-t border-red-100 mt-1">
                      <span className="text-red-500 font-bold">Filtered Out</span>
                      <p className="text-[10px] text-slate-700 font-medium">{p.filterReason}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5 italic">
                        Adjust "Processing Options" to include these points.
                      </p>
                    </div>
                  ) : (
                    <div className="pt-1 border-t border-amber-100 mt-1">
                      <span className="text-amber-600 font-bold">No road found</span>
                      <p className="text-[9px] text-slate-500 mt-0.5 italic">
                        Point was too far from any SUMO road (&gt;{(network as any).options?.radius || 50}m). 
                        Try increasing the 'Mapping Radius'.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      
      {/* Legend Overlay */}
      <div className={cn(
        "absolute top-4 right-4 backdrop-blur-sm p-4 rounded-xl border shadow-lg z-[1000] min-w-[160px] transition-all",
        isDarkMode 
          ? "bg-slate-900/90 border-slate-700 text-slate-100" 
          : "bg-white/90 border-slate-200 text-slate-800"
      )}>
        <h4 className={cn("text-[10px] font-bold uppercase mb-3", isDarkMode ? "text-slate-400" : "text-slate-500")}>
          {metric === 'tti' ? 'TTI Intensity' : `Speed: ${direction === 'all' ? 'Overall' : direction === 'l' ? 'Left' : direction === 's' ? 'Straight' : 'Right'} (km/h)`}
        </h4>
        <div className="space-y-2">
          {metric === 'tti' ? (
            <>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-emerald-500 rounded-sm" />
                <span>&le; 1.2 (Normal)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-yellow-400 rounded-sm" />
                <span>1.2 - 1.5</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-orange-500 rounded-sm" />
                <span>1.5 - 2.0</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-red-500 rounded-sm" />
                <span>&gt; 2.0 (Congested)</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-emerald-500 rounded-sm" />
                <span>&ge; 40 km/h</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-yellow-400 rounded-sm" />
                <span>25 - 40 km/h</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-orange-500 rounded-sm" />
                <span>10 - 25 km/h</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-red-500 rounded-sm" />
                <span>&lt; 10 km/h</span>
              </div>
            </>
          )}
          <div className={cn("flex items-center gap-2 text-xs pt-1 border-t", isDarkMode ? "border-slate-800" : "border-slate-100")}>
            <div className="w-3 h-3 bg-slate-400 rounded-sm" />
            <span>No Data</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapView;
