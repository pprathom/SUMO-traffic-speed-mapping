/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { XMLParser } from 'fast-xml-parser';
import RBush from 'rbush';
import { SumoEdge, SumoConnection, NetworkMetadata } from './types';

export interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  edgeId: string;
}

export class SumoNetwork {
  public edges: Map<string, SumoEdge> = new Map();
  public connections: SumoConnection[] = [];
  public metadata: NetworkMetadata | null = null;
  private rtree: RBush<SpatialItem> = new RBush();

  constructor(xmlContent: string) {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const jsonObj = parser.parse(xmlContent);

    if (jsonObj.net) {
      // Parse location
      if (jsonObj.net.location) {
        const loc = jsonObj.net.location;
        this.metadata = {
          location: {
            netOffset: (loc.netOffset || '0,0').split(',').map(Number),
            convBoundary: (loc.convBoundary || '0,0,0,0').split(',').map(Number),
            origBoundary: (loc.origBoundary || '0,0,0,0').split(',').map(Number),
            projParameter: loc.projParameter || '!',
          },
        };
      }

      // Parse edges
      const edges = Array.isArray(jsonObj.net.edge) ? jsonObj.net.edge : [jsonObj.net.edge];
      for (const edge of edges) {
        if (!edge.id || edge.function === 'internal') continue;

        // Lanes contain the shape
        const lanes = Array.isArray(edge.lane) ? edge.lane : [edge.lane];
        // For simplicity, we use the shape of the first lane as the edge shape
        const shapeStr = lanes[0].shape;
        const shape: [number, number][] = shapeStr
          .split(' ')
          .map((p: string) => p.split(',').map(Number) as [number, number]);

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of shape) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        const bbox = { minX, minY, maxX, maxY };

        const sumoEdge: SumoEdge = {
          id: edge.id,
          name: edge.name, // Extract street name
          speedLimit: Number(lanes[0].speed) * 3.6, // Convert m/s to km/h
          from: edge.from,
          to: edge.to,
          priority: Number(edge.priority),
          type: edge.type,
          shape,
          bbox,
        };

        this.edges.set(edge.id, sumoEdge);
        this.rtree.insert({
          ...bbox,
          edgeId: edge.id,
        });
      }

      // Parse connections
      if (jsonObj.net.connection) {
        const connections = Array.isArray(jsonObj.net.connection)
          ? jsonObj.net.connection
          : [jsonObj.net.connection];
        for (const conn of connections) {
          this.connections.push({
            from: conn.from,
            to: conn.to,
            fromLane: Number(conn.fromLane),
            toLane: Number(conn.toLane),
            dir: conn.dir,
          });
        }
      }
    }
  }

  /**
   * Finds the nearest edge to a given Cartesian (x, y) point
   */
  findNearestEdge(x: number, y: number, radius: number = 50): string | null {
    const candidates = this.rtree.search({
      minX: x - radius,
      minY: y - radius,
      maxX: x + radius,
      maxY: y + radius,
    });

    let nearestEdgeId: string | null = null;
    let minDistance = Infinity;

    for (const cand of candidates) {
      const edge = this.edges.get(cand.edgeId);
      if (!edge) continue;

      // Calculate point-to-polyline distance
      const dist = this.pointToPolylineDistance(x, y, edge.shape);
      if (dist < minDistance) {
        minDistance = dist;
        nearestEdgeId = cand.edgeId;
      }
    }

    return nearestEdgeId;
  }

  private pointToPolylineDistance(px: number, py: number, polyline: [number, number][]): number {
    let minDist = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
      const dist = this.pointToSegmentDistance(px, py, polyline[i], polyline[i + 1]);
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  }

  private pointToSegmentDistance(
    px: number,
    py: number,
    s1: [number, number],
    s2: [number, number]
  ): number {
    const dx = s2[0] - s1[0];
    const dy = s2[1] - s1[1];
    if (dx === 0 && dy === 0) {
      return Math.sqrt((px - s1[0]) ** 2 + (py - s1[1]) ** 2);
    }
    const t = ((px - s1[0]) * dx + (py - s1[1]) * dy) / (dx * dx + dy * dy);
    if (t < 0) {
      return Math.sqrt((px - s1[0]) ** 2 + (py - s1[1]) ** 2);
    }
    if (t > 1) {
      return Math.sqrt((px - s2[0]) ** 2 + (py - s2[1]) ** 2);
    }
    const closestX = s1[0] + t * dx;
    const closestY = s1[1] + t * dy;
    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
  }
}
