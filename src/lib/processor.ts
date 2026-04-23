/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProbePoint, SpeedResult } from './types';
import { SumoNetwork } from './sumo-parser';
import { CoordinateTransformer } from './coords';

export interface ProcessingOptions {
  onlyTaxisWithPassengers: boolean;
  minGpsValid: number;
  radius: number;
  filterStationary: boolean;
  stationaryThreshold: number; // km/h
  timeBinSize: number; // minutes: 15, 30, 60
}

export class TrafficProcessor {
  private network: SumoNetwork;
  private transformer: CoordinateTransformer;

  constructor(network: SumoNetwork) {
    this.network = network;
    
    // Fallback to identity transformation if metadata is missing
    if (!network.metadata) {
      console.warn('Network metadata missing projection information. Using identity transformation (Cartesian). GPS mapping might be inaccurate.');
    }
    const projParameter = network.metadata?.location.projParameter || '!';
    const netOffset = network.metadata?.location.netOffset || [0, 0];
    
    this.transformer = new CoordinateTransformer(projParameter, netOffset);
  }

  /**
   * Processes probe data and maps it to the SUMO network
   */
  process(probeData: ProbePoint[], options: ProcessingOptions): SpeedResult[] {
    // 1. Filter and clean data
    const cleanedData = probeData.filter((p) => {
      if (p.gpsValid < options.minGpsValid) return false;
      // If onlyTaxisWithPassengers is true, we only keep points where forHireLight is 0
      if (options.onlyTaxisWithPassengers && p.forHireLight !== 0) return false;
      if (options.filterStationary && p.speed <= options.stationaryThreshold) return false;
      return true;
    });

    // 2. Map matching
    const vehicleTrajectories: Map<string, { edgeId: string; speed: number; timestamp: number }[]> =
      new Map();

    for (const p of cleanedData) {
      const [x, y] = this.transformer.toCartesian(p.lat, p.lon);
      const edgeId = this.network.findNearestEdge(x, y, options.radius);

      if (edgeId) {
        if (!vehicleTrajectories.has(p.vehicleId)) {
          vehicleTrajectories.set(p.vehicleId, []);
        }
        vehicleTrajectories.get(p.vehicleId)!.push({
          edgeId,
          speed: p.speed,
          timestamp: p.timestamp,
        });
      }
    }

    // 3. Aggregate data into Date-Link-TimeSlot bins with trajectory-aware classification
    // Key: "date|edgeId|timeSlot"
    const bins: Map<
      string,
      {
        allSpeeds: number[];
        leftSpeeds: number[];
        throughSpeeds: number[];
        rightSpeeds: number[];
        vehicleIds: Set<string>;
        totalPoints: number;
      }
    > = new Map();

    // Track raw speeds for each link during off-peak hours (02:00 - 04:00) for Free-flow calculation
    const offPeakSpeedsPerLink: Map<string, number[]> = new Map();
    const allSpeedsPerLink: Map<string, number[]> = new Map();

    for (const [vehicleId, trajectory] of vehicleTrajectories.entries()) {
      trajectory.sort((a, b) => a.timestamp - b.timestamp);

      for (let i = 0; i < trajectory.length; i++) {
        const point = trajectory[i];
        const date = new Date(point.timestamp);
        const dateStr = date.toISOString().split('T')[0];
        const hours = date.getHours();
        const timeSlot = this.getTimeSlot(point.timestamp, options.timeBinSize);
        const binKey = `${dateStr}|${point.edgeId}|${timeSlot}`;

        if (!bins.has(binKey)) {
          bins.set(binKey, {
            allSpeeds: [],
            leftSpeeds: [],
            throughSpeeds: [],
            rightSpeeds: [],
            vehicleIds: new Set(),
            totalPoints: 0,
          });
        }

        const bin = bins.get(binKey)!;
        bin.vehicleIds.add(vehicleId);
        bin.totalPoints++;
        bin.allSpeeds.push(point.speed);

        // Collect speeds for Free-flow calculation
        if (!allSpeedsPerLink.has(point.edgeId)) {
          allSpeedsPerLink.set(point.edgeId, []);
        }
        allSpeedsPerLink.get(point.edgeId)!.push(point.speed);

        // Off-peak: 02:00 - 04:00
        if (hours >= 2 && hours < 4) {
          if (!offPeakSpeedsPerLink.has(point.edgeId)) {
            offPeakSpeedsPerLink.set(point.edgeId, []);
          }
          offPeakSpeedsPerLink.get(point.edgeId)!.push(point.speed);
        }

        // Determine direction by looking ahead in trajectory for the next edge
        let direction: 'l' | 's' | 'r' | null = null;
        for (let j = i + 1; j < trajectory.length; j++) {
          if (trajectory[j].edgeId !== point.edgeId) {
            // Use a deeper search for direction if not directly connected
            direction = this.getDirectionTowards(point.edgeId, trajectory[j].edgeId);
            break;
          }
        }

        // Classification logic
        if (direction === 'l') {
          bin.leftSpeeds.push(point.speed);
        } else if (direction === 'r') {
          bin.rightSpeeds.push(point.speed);
        } else if (direction === 's') {
          bin.throughSpeeds.push(point.speed);
        } else {
          // Fallback: If no next edge found, avoid assigning to all directions
          const possibleDirs = this.getDirectionsForEdge(point.edgeId);
          
          if (possibleDirs.size === 1) {
            // Only one possible direction, assign to it
            const onlyDir = Array.from(possibleDirs)[0].toLowerCase();
            if (onlyDir === 'l') bin.leftSpeeds.push(point.speed);
            else if (onlyDir === 'r') bin.rightSpeeds.push(point.speed);
            else bin.throughSpeeds.push(point.speed);
          } else {
            // Ambiguous or multiple directions: Default to "Through" as a general speed
            // instead of duplicating across all columns.
            bin.throughSpeeds.push(point.speed);
          }
        }
      }
    }

    // 4. Calculate Space Mean Speed and TTI
    const results: SpeedResult[] = [];
    
    // First pass: Calculate speeds for all bins
    const tempResults: { binKey: string; bin: any; speedAll: number | null }[] = [];
    for (const [binKey, bin] of bins.entries()) {
      const speedAll = this.calculateHarmonicMean(bin.allSpeeds);
      tempResults.push({ binKey, bin, speedAll });
    }

    // Pre-calculate Free-flow Speed (85th percentile) for each link
    const freeFlowSpeeds: Map<string, number> = new Map();
    const allEdgeIds = new Set([...offPeakSpeedsPerLink.keys(), ...allSpeedsPerLink.keys()]);

    for (const edgeId of allEdgeIds) {
      const offPeakSpeeds = offPeakSpeedsPerLink.get(edgeId) || [];
      const allSpeeds = allSpeedsPerLink.get(edgeId) || [];
      
      // Use 85th percentile of off-peak data if available, otherwise fallback to 85th of all data
      const sourceSpeeds = offPeakSpeeds.length > 0 ? offPeakSpeeds : allSpeeds;
      
      if (sourceSpeeds.length > 0) {
        const sorted = [...sourceSpeeds].sort((a, b) => a - b);
        const index = Math.ceil(0.85 * sorted.length) - 1;
        freeFlowSpeeds.set(edgeId, sorted[index]);
      }
    }

    // Second pass: Calculate TTI using the pre-calculated Free-flow speed
    for (const { binKey, bin, speedAll } of tempResults) {
      const [date, edgeId, timeSlot] = binKey.split('|');
      const edge = this.network.edges.get(edgeId);
      
      // Free-flow speed is the 85th percentile speed during off-peak hours (02:00-04:00)
      const freeFlowSpeed = freeFlowSpeeds.get(edgeId) || 0;
      let tti: number | null = null;
      
      if (speedAll !== null && speedAll > 0 && freeFlowSpeed > 0) {
        tti = freeFlowSpeed / speedAll;
      }

      results.push({
        date,
        linkId: edgeId,
        linkName: edge?.name,
        timeSlot,
        speedAll,
        speedLeft: this.calculateHarmonicMean(bin.leftSpeeds),
        speedThrough: this.calculateHarmonicMean(bin.throughSpeeds),
        speedRight: this.calculateHarmonicMean(bin.rightSpeeds),
        tti,
        n: bin.vehicleIds.size,
        totalPoints: bin.totalPoints,
      });
    }

    // 5. Sort by date and time slot
    results.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateA - dateB;
      return a.timeSlot.localeCompare(b.timeSlot);
    });

    return results;
  }

  private getDirectionTowards(fromEdge: string, targetEdge: string, depth: number = 3): 'l' | 's' | 'r' | null {
    // Direct connection
    const direct = this.getDirectionBetweenEdges(fromEdge, targetEdge);
    if (direct) return direct;

    if (depth <= 0) return null;

    // Search one level deeper
    const conns = this.network.connections.filter(c => c.from === fromEdge);
    for (const conn of conns) {
      // If we can reach targetEdge from conn.to, then the direction of this connection is likely the one
      if (this.canReach(conn.to, targetEdge, depth - 1)) {
        if (conn.dir === 'l' || conn.dir === 'L') return 'l';
        if (conn.dir === 'r' || conn.dir === 'R') return 'r';
        return 's';
      }
    }
    return null;
  }

  private canReach(startEdge: string, targetEdge: string, depth: number): boolean {
    if (startEdge === targetEdge) return true;
    if (depth <= 0) return false;
    const conns = this.network.connections.filter(c => c.from === startEdge);
    return conns.some(c => this.canReach(c.to, targetEdge, depth - 1));
  }

  private getDirectionBetweenEdges(fromEdge: string, toEdge: string): 'l' | 's' | 'r' | null {
    const conn = this.network.connections.find((c) => c.from === fromEdge && c.to === toEdge);
    if (!conn) return null;
    if (conn.dir === 'l' || conn.dir === 'L') return 'l';
    if (conn.dir === 'r' || conn.dir === 'R') return 'r';
    if (conn.dir === 's') return 's';
    return 's'; // Default to straight for other types like 't' (turn)
  }

  private getTimeSlot(timestamp: number, binSize: number): string {
    const date = new Date(timestamp);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const slotStart = Math.floor(minutes / binSize) * binSize;
    return `${hours.toString().padStart(2, '0')}:${slotStart.toString().padStart(2, '0')}`;
  }

  private calculateHarmonicMean(speeds: number[]): number | null {
    if (speeds.length === 0) return null;
    const validSpeeds = speeds.filter((s) => s > 0.1);
    if (validSpeeds.length === 0) return 0;

    const sumInverse = validSpeeds.reduce((acc, s) => acc + 1 / s, 0);
    return validSpeeds.length / sumInverse;
  }

  private getDirectionsForEdge(edgeId: string): Set<string> {
    const dirs = new Set<string>();
    const conns = this.network.connections.filter((c) => c.from === edgeId);
    for (const c of conns) {
      dirs.add(c.dir);
    }
    return dirs;
  }
}
