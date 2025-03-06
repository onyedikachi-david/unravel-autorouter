import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { SegmentWithAssignedPoints } from "../CapacityMeshSolver/CapacitySegmentToPointSolver"
import {
  UnravelSection,
  UnravelCandidate,
  SegmentPoint,
  SegmentPointId,
  SegmentId,
  UnravelOperation,
  UnravelIssue,
} from "./types"
import { getNodesNearNode } from "./getNodesNearNode"
import { GraphicsObject } from "graphics-debug"
import {
  createFullPointModificationsHash,
  createPointModificationsHash,
} from "./createPointModificationsHash"
import { getIssuesInSection } from "./getIssuesInSection"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"
import { getLogProbability } from "./getLogProbability"
import { applyOperationToPointModifications } from "./applyOperationToPointModifications"

/**
 * The UntangleSectionSolver optimizes a section of connected capacity nodes
 * with their deduplicated segments.
 *
 * The section always has a "root" node. From the root node, MUTABLE_HOPS are
 * taken to reach other nodes that are mutable. One additional hop is taken to
 * have all the impacted nodes in section. So a section is composed of mutable
 * and immutable nodes.
 *
 * The goal of the solver is to perform operations on the mutable nodes of the
 * section to lower the overall cost of the section.
 *
 * The untangle phase will perform "operations" on segments based on "issues"
 *
 * An "issue" is anything that increases the cost of the node:
 * - Anything that causes a via (e.g. layer transition)
 * - Any time two traces cross on the same layer
 *
 * An operation is a change to a segment. There are two main operations:
 * - Change layer
 * - Change point order on segment
 *
 * This solver works by exploring different paths of operations. When an
 * operation is performed, new issues are created. Each path has a cost, and
 * a set of neighbors representing next operations to perform.
 *
 */
export class UnravelSectionSolver extends BaseSolver {
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  dedupedSegments: SegmentWithAssignedPoints[]

  MUTABLE_HOPS = 1

  unravelSection: UnravelSection

  candidates: UnravelCandidate[] = []

  lastProcessedCandidate: UnravelCandidate | null = null
  bestCandidate: UnravelCandidate | null = null
  originalCandidate: UnravelCandidate | null = null

  rootNodeId: CapacityMeshNodeId
  nodeIdToSegmentIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  segmentIdToNodeIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  colorMap: Record<string, string>
  tunedNodeCapacityMap: Map<CapacityMeshNodeId, number>

  selectedCandidateIndex: number | "best" | "original" | null = null

  queuedOrExploredCandidatePointModificationHashes: Set<string> = new Set()

  constructor(params: {
    rootNodeId: CapacityMeshNodeId
    colorMap?: Record<string, string>
    MUTABLE_HOPS?: number
    nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
    dedupedSegments: SegmentWithAssignedPoints[]
    nodeIdToSegmentIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
    segmentIdToNodeIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  }) {
    super()

    this.MUTABLE_HOPS = params.MUTABLE_HOPS ?? this.MUTABLE_HOPS

    this.nodeMap = params.nodeMap
    this.dedupedSegments = params.dedupedSegments
    this.nodeIdToSegmentIds = params.nodeIdToSegmentIds
    this.segmentIdToNodeIds = params.segmentIdToNodeIds
    this.rootNodeId = params.rootNodeId
    this.colorMap = params.colorMap ?? {}
    this.unravelSection = this.createUnravelSection()
    this.tunedNodeCapacityMap = new Map()
    for (const nodeId of this.unravelSection.allNodeIds) {
      this.tunedNodeCapacityMap.set(
        nodeId,
        getTunedTotalCapacity1(this.nodeMap.get(nodeId)!),
      )
    }
    this.originalCandidate = this.createInitialCandidate()
    this.candidates = [this.originalCandidate]
  }

  createUnravelSection(): UnravelSection {
    const mutableNodeIds = getNodesNearNode({
      nodeId: this.rootNodeId,
      nodeIdToSegmentIds: this.nodeIdToSegmentIds,
      segmentIdToNodeIds: this.segmentIdToNodeIds,
      hops: this.MUTABLE_HOPS,
    })
    const allNodeIds = getNodesNearNode({
      nodeId: this.rootNodeId,
      nodeIdToSegmentIds: this.nodeIdToSegmentIds,
      segmentIdToNodeIds: this.segmentIdToNodeIds,
      hops: this.MUTABLE_HOPS + 1,
    })
    const immutableNodeIds = Array.from(
      new Set(allNodeIds).difference(new Set(mutableNodeIds)),
    )

    const segmentPoints: SegmentPoint[] = []
    let highestSegmentPointId = 0
    for (const segment of this.dedupedSegments) {
      for (const point of segment.assignedPoints!) {
        segmentPoints.push({
          segmentPointId: `SP${highestSegmentPointId++}`,
          segmentId: segment.nodePortSegmentId!,
          capacityMeshNodeIds: this.segmentIdToNodeIds.get(
            segment.nodePortSegmentId!,
          )!,
          connectionName: point.connectionName,
          x: point.point.x,
          y: point.point.y,
          z: point.point.z,
          directlyConnectedSegmentPointIds: [],
        })
      }
    }

    const segmentPointMap = new Map<SegmentPointId, SegmentPoint>()
    for (const segmentPoint of segmentPoints) {
      segmentPointMap.set(segmentPoint.segmentPointId, segmentPoint)
    }

    const segmentPointsInNode = new Map<CapacityMeshNodeId, SegmentPointId[]>()
    for (const segmentPoint of segmentPoints) {
      for (const nodeId of segmentPoint.capacityMeshNodeIds) {
        segmentPointsInNode.set(nodeId, [
          ...(segmentPointsInNode.get(nodeId) ?? []),
          segmentPoint.segmentPointId,
        ])
      }
    }

    const segmentPointsInSegment = new Map<SegmentId, SegmentPointId[]>()
    for (const segmentPoint of segmentPoints) {
      segmentPointsInSegment.set(segmentPoint.segmentId, [
        ...(segmentPointsInSegment.get(segmentPoint.segmentId) ?? []),
        segmentPoint.segmentPointId,
      ])
    }

    // Second pass: set neighboring segment point ids
    for (let i = 0; i < segmentPoints.length; i++) {
      const A = segmentPoints[i]
      for (let j = i + 1; j < segmentPoints.length; j++) {
        const B = segmentPoints[j]
        if (B.segmentPointId === A.segmentPointId) continue
        if (B.segmentId === A.segmentId) continue
        if (B.connectionName !== A.connectionName) continue
        // If the points share the same capacity node, and share the same
        // connection name, then they're neighbors
        if (
          A.capacityMeshNodeIds.some((nId) =>
            B.capacityMeshNodeIds.includes(nId),
          )
        ) {
          A.directlyConnectedSegmentPointIds.push(B.segmentPointId)
          B.directlyConnectedSegmentPointIds.push(A.segmentPointId)
        }
      }
    }

    const segmentPairsInNode = new Map<
      CapacityMeshNodeId,
      Array<[SegmentPointId, SegmentPointId]>
    >()
    for (const nodeId of allNodeIds) {
      segmentPairsInNode.set(nodeId, [])
    }

    for (const A of segmentPoints) {
      for (const nodeId of A.capacityMeshNodeIds) {
        const otherSegmentPoints = segmentPointsInNode
          .get(nodeId)!
          .map((spId) => segmentPointMap.get(spId)!)
        const segmentPairs = segmentPairsInNode.get(nodeId)
        if (!segmentPairs) continue
        for (const BId of A.directlyConnectedSegmentPointIds) {
          const B = segmentPointMap.get(BId)!
          if (B.segmentPointId === A.segmentPointId) continue
          if (!B.capacityMeshNodeIds.some((nId) => nId === nodeId)) continue
          if (
            !segmentPairs.some(
              ([a, b]) =>
                (a === A.segmentPointId && b === B.segmentPointId) ||
                (a === B.segmentPointId && b === A.segmentPointId),
            )
          ) {
            segmentPairs.push([A.segmentPointId, B.segmentPointId])
          }
        }
      }
    }

    const mutableSegmentIds = new Set<string>()
    for (const nodeId of mutableNodeIds) {
      for (const segmentId of this.nodeIdToSegmentIds.get(nodeId)!) {
        mutableSegmentIds.add(segmentId)
      }
    }

    return {
      allNodeIds,
      mutableNodeIds,
      immutableNodeIds,
      mutableSegmentIds,
      segmentPairsInNode,
      segmentPointMap,
      segmentPointsInNode,
      segmentPointsInSegment,
    }
  }

  createInitialCandidate(): UnravelCandidate {
    const pointModifications = new Map<
      SegmentPointId,
      { x?: number; y?: number; z?: number }
    >()
    const issues = getIssuesInSection(
      this.unravelSection,
      this.nodeMap,
      pointModifications,
    )
    const g = this.computeG({
      issues,
      originalCandidate: {} as any,
      operationsPerformed: 0,
      operation: {} as any,
    })
    return {
      pointModifications,
      issues,
      g,
      h: 0,
      f: g,
      operationsPerformed: 0,
      candidateHash: createPointModificationsHash(pointModifications),
      candidateFullHash: createFullPointModificationsHash(
        this.unravelSection.segmentPointMap,
        pointModifications,
      ),
    }
  }

  get nextCandidate(): UnravelCandidate | null {
    return this.candidates[0] ?? null
  }

  getPointInCandidate(
    candidate: UnravelCandidate,
    segmentPointId: SegmentPointId,
  ): { x: number; y: number; z: number; segmentId: string } {
    const originalPoint =
      this.unravelSection.segmentPointMap.get(segmentPointId)!
    const modifications = candidate.pointModifications.get(segmentPointId)

    return {
      x: modifications?.x ?? originalPoint.x,
      y: modifications?.y ?? originalPoint.y,
      z: modifications?.z ?? originalPoint.z,
      segmentId: originalPoint.segmentId,
    }
  }

  getOperationsForIssue(
    candidate: UnravelCandidate,
    issue: UnravelIssue,
  ): UnravelOperation[] {
    const operations: UnravelOperation[] = []

    if (issue.type === "transition_via") {
      // When there's a transition via, we attempt to change the layer of either
      // end to match the other end
      const [APointId, BPointId] = issue.segmentPoints
      const pointA = this.getPointInCandidate(candidate, APointId)
      const pointB = this.getPointInCandidate(candidate, BPointId)

      if (this.unravelSection.mutableSegmentIds.has(pointA.segmentId)) {
        operations.push({
          type: "change_layer",
          newZ: pointB.z,
          segmentPointIds: [APointId],
        })
      }
      if (this.unravelSection.mutableSegmentIds.has(pointB.segmentId)) {
        operations.push({
          type: "change_layer",
          newZ: pointA.z,
          segmentPointIds: [BPointId],
        })
      }
    }

    if (issue.type === "same_layer_crossing") {
      // For a same-layer crossing, we should try all the following:
      // 1. Swap the points on each segment (for each shared segment, if any)
      // 2. Change the layer of each segment entirely to remove the crossing
      // 3. Change the layer of each point individually to make it a transition
      //   crossing

      // 1. SWAP POINTS
      const [APointId, BPointId] = issue.crossingLine1
      const [CPointId, DPointId] = issue.crossingLine2

      const sharedSegments: Array<[SegmentPointId, SegmentPointId]> = []
      const A = this.unravelSection.segmentPointMap.get(APointId)!
      const B = this.unravelSection.segmentPointMap.get(BPointId)!
      const C = this.unravelSection.segmentPointMap.get(CPointId)!
      const D = this.unravelSection.segmentPointMap.get(DPointId)!

      if (A.segmentId === C.segmentId) {
        sharedSegments.push([APointId, CPointId])
      }
      if (A.segmentId === D.segmentId) {
        sharedSegments.push([APointId, DPointId])
      }
      if (B.segmentId === C.segmentId) {
        sharedSegments.push([BPointId, CPointId])
      }
      if (B.segmentId === D.segmentId) {
        sharedSegments.push([BPointId, DPointId])
      }

      for (const [EPointId, FPointId] of sharedSegments) {
        operations.push({
          type: "swap_position_on_segment",
          segmentPointIds: [EPointId, FPointId],
        })
      }

      // 2. CHANGE LAYER OF EACH SEGMENT ENTIRELY TO REMOVE CROSSING
      operations.push({
        type: "change_layer",
        newZ: A.z === 0 ? 1 : 0,
        segmentPointIds: [APointId, BPointId],
      })
      operations.push({
        type: "change_layer",
        newZ: C.z === 0 ? 1 : 0,
        segmentPointIds: [CPointId, DPointId],
      })

      // 3. CHANGE LAYER OF EACH POINT INDIVIDUALLY TO MAKE TRANSITION CROSSING
      operations.push({
        type: "change_layer",
        newZ: A.z === 0 ? 1 : 0,
        segmentPointIds: [APointId],
      })
      operations.push({
        type: "change_layer",
        newZ: B.z === 0 ? 1 : 0,
        segmentPointIds: [BPointId],
      })
      operations.push({
        type: "change_layer",
        newZ: C.z === 0 ? 1 : 0,
        segmentPointIds: [CPointId],
      })
      operations.push({
        type: "change_layer",
        newZ: D.z === 0 ? 1 : 0,
        segmentPointIds: [DPointId],
      })
    }

    // TODO single_transition_crossing
    // TODO double_transition_crossing
    // TODO same_layer_trace_imbalance_with_low_capacity

    return operations
  }

  computeG(params: {
    issues: UnravelIssue[]
    originalCandidate: UnravelCandidate
    operationsPerformed: number
    operation: UnravelOperation
  }): number {
    const { issues, originalCandidate, operationsPerformed, operation } = params

    const nodeProblemCounts = new Map<
      CapacityMeshNodeId,
      {
        numTransitionCrossings: number
        numSameLayerCrossings: number
        numEntryExitLayerChanges: number
      }
    >()

    for (const issue of issues) {
      if (!nodeProblemCounts.has(issue.capacityMeshNodeId)) {
        nodeProblemCounts.set(issue.capacityMeshNodeId, {
          numTransitionCrossings: 0,
          numSameLayerCrossings: 0,
          numEntryExitLayerChanges: 0,
        })
      }

      const nodeProblemCount = nodeProblemCounts.get(issue.capacityMeshNodeId)!

      if (issue.type === "transition_via") {
        nodeProblemCount.numTransitionCrossings++
      } else if (issue.type === "same_layer_crossing") {
        nodeProblemCount.numSameLayerCrossings++
      } else if (
        issue.type === "double_transition_crossing" ||
        issue.type === "single_transition_crossing"
      ) {
        nodeProblemCount.numEntryExitLayerChanges++
      } else if (
        issue.type === "same_layer_trace_imbalance_with_low_capacity"
      ) {
        // TODO
      }
    }

    let cost = 0

    for (const [
      nodeId,
      {
        numEntryExitLayerChanges,
        numSameLayerCrossings,
        numTransitionCrossings,
      },
    ] of nodeProblemCounts) {
      const estNumVias =
        numSameLayerCrossings * 0.82 +
        numEntryExitLayerChanges * 0.41 +
        numTransitionCrossings * 0.2

      const estUsedCapacity = (estNumVias / 2) ** 1.1

      const totalCapacity = this.tunedNodeCapacityMap.get(nodeId)!

      const estPf = estUsedCapacity / totalCapacity

      cost += getLogProbability(estPf)
    }

    return cost
  }

  getNeighborByApplyingOperation(
    currentCandidate: UnravelCandidate,
    operation: UnravelOperation,
  ): UnravelCandidate {
    const pointModifications = new Map<
      SegmentPointId,
      { x?: number; y?: number; z?: number }
    >(currentCandidate.pointModifications)

    applyOperationToPointModifications(
      pointModifications,
      operation,
      (segmentPointId) =>
        this.getPointInCandidate(currentCandidate, segmentPointId),
    )

    const issues = getIssuesInSection(
      this.unravelSection,
      this.nodeMap,
      pointModifications,
    )

    const operationsPerformed = currentCandidate.operationsPerformed + 1

    const g = this.computeG({
      issues,
      originalCandidate: currentCandidate,
      operationsPerformed,
      operation,
    })

    return {
      issues,
      g,
      h: 0,
      f: g,
      pointModifications,
      candidateHash: createPointModificationsHash(pointModifications),

      // TODO PERFORMANCE allow disabling this
      candidateFullHash: createFullPointModificationsHash(
        this.unravelSection.segmentPointMap,
        pointModifications,
      ),

      operationsPerformed,
    }
  }

  getNeighborOperationsForCandidate(
    candidate: UnravelCandidate,
  ): UnravelOperation[] {
    return candidate.issues.flatMap((issue) =>
      this.getOperationsForIssue(candidate, issue),
    )
  }

  getNeighbors(candidate: UnravelCandidate): UnravelCandidate[] {
    const neighbors: UnravelCandidate[] = []

    const operations = this.getNeighborOperationsForCandidate(candidate)
    for (const operation of operations) {
      const neighbor = this.getNeighborByApplyingOperation(candidate, operation)
      neighbors.push(neighbor)
    }

    return neighbors
  }

  _step() {
    const candidate = this.candidates.shift()
    if (!candidate) {
      this.solved = true
      return
    }
    this.lastProcessedCandidate = candidate

    if (candidate.f < (this.bestCandidate?.f ?? Infinity)) {
      this.bestCandidate = candidate
      // TODO, only works if we start computing f
      // if (candidate.f <= 0.00001) {
      //   this.solved = true
      //   return
      // }
    }

    this.getNeighbors(candidate).forEach((neighbor) => {
      const isPartialHashExplored =
        this.queuedOrExploredCandidatePointModificationHashes.has(
          neighbor.candidateHash,
        )
      const isFullHashExplored =
        neighbor.candidateFullHash &&
        this.queuedOrExploredCandidatePointModificationHashes.has(
          neighbor.candidateFullHash,
        )

      if (isPartialHashExplored || isFullHashExplored) return
      this.queuedOrExploredCandidatePointModificationHashes.add(
        neighbor.candidateHash,
      )
      if (neighbor.candidateFullHash) {
        this.queuedOrExploredCandidatePointModificationHashes.add(
          neighbor.candidateFullHash,
        )
      }
      this.candidates.push(neighbor)
    })
  }

  visualize(): GraphicsObject {
    const graphics: Required<GraphicsObject> = {
      points: [],
      lines: [],
      rects: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: "Unravel Section Solver",
    }

    // Get the candidate to visualize
    let candidate: UnravelCandidate | null = null
    if (this.selectedCandidateIndex !== null) {
      if (this.selectedCandidateIndex === "best") {
        candidate = this.bestCandidate
      } else if (this.selectedCandidateIndex === "original") {
        candidate = this.originalCandidate
      } else {
        candidate = this.candidates[this.selectedCandidateIndex]
      }
    } else {
      candidate = this.lastProcessedCandidate || this.candidates[0]
    }
    if (!candidate) return graphics

    // Create a map of segment points with modifications applied
    const modifiedSegmentPoints = new Map<string, SegmentPoint>()
    for (const [segmentPointId, segmentPoint] of this.unravelSection
      .segmentPointMap) {
      // Create a copy of the original point
      const modifiedPoint = { ...segmentPoint }

      // Apply any modifications from the candidate
      const modification = candidate.pointModifications.get(segmentPointId)
      if (modification) {
        if (modification.x !== undefined) modifiedPoint.x = modification.x
        if (modification.y !== undefined) modifiedPoint.y = modification.y
        if (modification.z !== undefined) modifiedPoint.z = modification.z
      }

      modifiedSegmentPoints.set(segmentPointId, modifiedPoint)
    }

    // Visualize all segment points with modifications applied
    for (const [segmentPointId, segmentPoint] of modifiedSegmentPoints) {
      graphics.points.push({
        x: segmentPoint.x,
        y: segmentPoint.y,
        label: `${segmentPointId}\nSegment: ${segmentPoint.segmentId}\nLayer: ${segmentPoint.z}`,
        color: this.colorMap[segmentPoint.segmentId] || "#000",
      })
    }

    // Visualize nodes
    for (const nodeId of this.unravelSection.allNodeIds) {
      const node = this.nodeMap.get(nodeId)!
      const isMutable = this.unravelSection.mutableNodeIds.includes(nodeId)

      graphics.rects.push({
        center: node.center,
        label: `${nodeId}\n${node.width.toFixed(2)}x${node.height.toFixed(2)}\n${isMutable ? "MUTABLE" : "IMMUTABLE"}`,
        color: isMutable ? "green" : "red",
        width: node.width / 8,
        height: node.height / 8,
      })
    }

    // Connect segment points that belong to the same segment
    for (const [segmentId, segmentPointIds] of this.unravelSection
      .segmentPointsInSegment) {
      if (segmentPointIds.length <= 1) continue

      const points = segmentPointIds.map(
        (spId) => modifiedSegmentPoints.get(spId)!,
      )

      // Connect points in order
      for (let i = 0; i < points.length - 1; i++) {
        graphics.lines.push({
          points: [
            { x: points[i].x, y: points[i].y },
            { x: points[i + 1].x, y: points[i + 1].y },
          ],
          strokeColor: this.colorMap[segmentId] || "#000",
        })
      }
    }

    // Connect directly connected segment points (points with the same connection name)
    for (const [segmentPointId, segmentPoint] of modifiedSegmentPoints) {
      for (const connectedPointId of segmentPoint.directlyConnectedSegmentPointIds) {
        // Only process each connection once (when the current point's ID is less than the connected point's ID)
        if (segmentPointId < connectedPointId) {
          const connectedPoint = modifiedSegmentPoints.get(connectedPointId)!

          // Determine line style based on layer (z) values
          const sameLayer = segmentPoint.z === connectedPoint.z
          const commonLayer = segmentPoint.z

          let strokeDash: string | undefined
          if (sameLayer) {
            strokeDash = commonLayer === 0 ? undefined : "10 5" // top layer: solid, bottom layer: long dash
          } else {
            strokeDash = "3 3 10" // transition between layers: mixed dash pattern
          }

          graphics.lines.push({
            points: [
              { x: segmentPoint.x, y: segmentPoint.y },
              { x: connectedPoint.x, y: connectedPoint.y },
            ],
            strokeDash,
            strokeColor: this.colorMap[segmentPoint.connectionName] || "#000",
          })
        }
      }
    }

    // Visualize issues
    for (const issue of candidate.issues) {
      const node = this.nodeMap.get(issue.capacityMeshNodeId)!

      if (issue.type === "transition_via") {
        // Highlight via issues
        for (const segmentPointId of issue.segmentPoints) {
          const segmentPoint = modifiedSegmentPoints.get(segmentPointId)!
          graphics.circles.push({
            center: { x: segmentPoint.x, y: segmentPoint.y },
            radius: node.width / 16,
            stroke: "#ff0000",
            fill: "rgba(255, 0, 0, 0.2)",
            label: `Via Issue\n${segmentPointId}\nLayer: ${segmentPoint.z}`,
          })
        }
      } else if (issue.type === "same_layer_crossing") {
        // Highlight crossing issues
        for (const [sp1Id, sp2Id] of [
          issue.crossingLine1,
          issue.crossingLine2,
        ]) {
          const sp1 = modifiedSegmentPoints.get(sp1Id)!
          const sp2 = modifiedSegmentPoints.get(sp2Id)!

          graphics.lines.push({
            points: [
              { x: sp1.x, y: sp1.y },
              { x: sp2.x, y: sp2.y },
            ],
            strokeColor: "rgba(255,0,0,0.2)",
            strokeWidth: node.width / 32,
          })
        }
      }
    }

    // Highlight modified points
    for (const [segmentPointId, modification] of candidate.pointModifications) {
      const modifiedPoint = modifiedSegmentPoints.get(segmentPointId)!
      const originalPoint =
        this.unravelSection.segmentPointMap.get(segmentPointId)!

      graphics.circles.push({
        center: { x: modifiedPoint.x, y: modifiedPoint.y },
        radius: 0.05,
        stroke: "#0000ff",
        fill: "rgba(0, 0, 255, 0.2)",
        label: `Modified Point\nOriginal: (${originalPoint.x}, ${originalPoint.y}, ${originalPoint.z})\nNew: (${modifiedPoint.x}, ${modifiedPoint.y}, ${modifiedPoint.z})`,
      })
    }

    return graphics
  }
}
