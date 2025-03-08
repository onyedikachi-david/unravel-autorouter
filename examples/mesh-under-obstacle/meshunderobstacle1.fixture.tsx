import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"
import { SimpleRouteJson } from "lib/types/srj-types"

const simpleSrj = {
  // const meshSolver = new CapacityMeshNodeSolver({
  bounds: {
    minX: 0,
    maxX: 100,
    minY: 0,
    maxY: 100,
  },
  layerCount: 2,
  minTraceWidth: 1,
  obstacles: [
    {
      center: {
        x: 50,
        y: 50,
      },
      width: 20,
      height: 30,
      type: "rect",
      layers: ["top", "bottom"],
      connectedTo: [],
    },
    {
      center: {
        x: 80,
        y: 50,
      },
      width: 20,
      height: 30,
      type: "rect",
      layers: ["top"],
      connectedTo: [],
    },
    {
      center: {
        x: 80,
        y: 20,
      },
      width: 20,
      height: 34,
      type: "rect",
      layers: ["bottom"],
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "trace1",
      pointsToConnect: [
        {
          x: 10,
          y: 10,
          layer: "top",
        },
        {
          x: 50,
          y: 90,
          layer: "top",
        },
      ],
    },
    {
      name: "trace2",
      pointsToConnect: [
        {
          x: 10,
          y: 50,
          layer: "top",
        },
        {
          x: 97,
          y: 29,
          layer: "top",
        },
      ],
    },
  ],
} as SimpleRouteJson

export default () => {
  const meshSolver = new CapacityMeshNodeSolver2_NodeUnderObstacle(simpleSrj)
  meshSolver.solve()
  return <InteractiveGraphics graphics={meshSolver.visualize()} />
}
