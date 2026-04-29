/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ProbePoint {
  vehicleId: string;
  lat: number;
  lon: number;
  timestamp: number; // Unix timestamp or ISO string converted to ms
  speed: number; // km/h
  heading: number; // 0-359
  forHireLight?: number; // 0 or 1
  engineAcc?: number;
  gpsValid: number; // 0 or 1
  edgeId?: string; // Mapped link ID
  filterReason?: string; // Reason why point was excluded from calculation
}

export interface SumoEdge {
  id: string;
  name?: string; // Street name from SUMO
  speedLimit?: number; // Speed limit in km/h
  from: string;
  to: string;
  priority: number;
  type: string;
  shape: [number, number][]; // Array of [x, y] coordinates
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface SumoConnection {
  from: string;
  to: string;
  fromLane: number;
  toLane: number;
  dir: 'l' | 's' | 'r' | 'L' | 'R' | 't' | 'm' | 'o'; // l=left, s=straight, r=right, etc.
}

export interface SpeedResult {
  date: string; // "YYYY-MM-DD"
  linkId: string;
  linkName?: string; // Street name
  timeSlot: string; // "HH:MM"
  speedAll: number | null; // Overall link speed
  speedLeft: number | null;
  speedThrough: number | null;
  speedRight: number | null;
  tti: number | null; // Travel Time Index
  n: number; // Number of unique vehicles
  totalPoints: number;
}

export interface NetworkMetadata {
  location: {
    netOffset: [number, number];
    convBoundary: [number, number, number, number];
    origBoundary: [number, number, number, number];
    projParameter: string;
  };
}
