import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { IntraNodeRouteSolver } from "../HighDensitySolver/IntraNodeSolver"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TwoCrossingRoutesHighDensitySolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"

export class HyperSingleIntraNodeSolver extends HyperParameterSupervisorSolver<
  IntraNodeRouteSolver | TwoCrossingRoutesHighDensitySolver
> {
  constructorParams: ConstructorParameters<typeof IntraNodeRouteSolver>[0]
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  nodeWithPortPoints: NodeWithPortPoints

  constructor(opts: ConstructorParameters<typeof IntraNodeRouteSolver>[0]) {
    super()
    this.nodeWithPortPoints = opts.nodeWithPortPoints
    this.constructorParams = opts
    this.MAX_ITERATIONS = 250_000
    this.GREEDY_MULTIPLIER = 5
    this.MIN_SUBSTEPS = 100
  }

  getCombinationDefs() {
    return [
      ["closedFormTwoTraceSameLayer"],
      ["majorCombinations", "orderings6", "cellSizeFactor"],
      ["noVias"],
      ["orderings50"],
      ["flipTraceAlignmentDirection", "orderings6"],
    ]
  }

  getHyperParameterDefs() {
    return [
      {
        name: "majorCombinations",
        possibleValues: [
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 2,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROXIMITY_VD: 10,
            MISALIGNED_DIST_PENALTY_FACTOR: 5,
          },
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 0.5,
            FUTURE_CONNECTION_PROXIMITY_VD: 5,
            MISALIGNED_DIST_PENALTY_FACTOR: 2,
          },
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 10,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROXIMITY_VD: 5,
            MISALIGNED_DIST_PENALTY_FACTOR: 10,
            VIA_PENALTY_FACTOR_2: 1,
          },
        ],
      },
      {
        name: "orderings6",
        possibleValues: [
          {
            SHUFFLE_SEED: 0,
          },
          {
            SHUFFLE_SEED: 1,
          },
          {
            SHUFFLE_SEED: 2,
          },
          {
            SHUFFLE_SEED: 3,
          },
          {
            SHUFFLE_SEED: 4,
          },
          {
            SHUFFLE_SEED: 5,
          },
        ],
      },
      {
        name: "cellSizeFactor",
        possibleValues: [
          {
            CELL_SIZE_FACTOR: 0.5,
          },
          {
            CELL_SIZE_FACTOR: 1,
          },
        ],
      },
      {
        name: "flipTraceAlignmentDirection",
        possibleValues: [
          {
            FLIP_TRACE_ALIGNMENT_DIRECTION: true,
          },
        ],
      },
      {
        name: "noVias",
        possibleValues: [
          {
            CELL_SIZE_FACTOR: 2,
            VIA_PENALTY_FACTOR_2: 10,
          },
        ],
      },
      {
        name: "orderings50",
        possibleValues: Array.from({ length: 50 }, (_, i) => ({
          SHUFFLE_SEED: 100 + i,
        })),
      },
      {
        name: "closedFormTwoTraceSameLayer",
        possibleValues: [
          {
            CLOSED_FORM_TWO_TRACE_SAME_LAYER: true,
          },
        ],
      },
    ]
  }

  computeG(solver: IntraNodeRouteSolver) {
    return (
      solver.iterations / 10_000 // + solver.hyperParameters.SHUFFLE_SEED! * 0.05
    )
  }

  computeH(solver: IntraNodeRouteSolver) {
    return 1 - (solver.progress || 0)
  }

  generateSolver(hyperParameters: any): IntraNodeRouteSolver {
    if (hyperParameters.CLOSED_FORM_TWO_TRACE_SAME_LAYER) {
      return new TwoCrossingRoutesHighDensitySolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
      }) as any
    }
    return new IntraNodeRouteSolver({
      ...this.constructorParams,
      hyperParameters,
    })
  }

  onSolve(solver: SupervisedSolver<IntraNodeRouteSolver>) {
    this.solvedRoutes = solver.solver.solvedRoutes
  }
}
