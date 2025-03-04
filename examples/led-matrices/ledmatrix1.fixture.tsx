import { InteractiveGraphics } from "graphics-debug/react"
import ledMatrix1 from "examples/assets/ledmatrix1.json"
import { CapacityMeshSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshSolver"
import type { SimpleRouteJson } from "lib/types"
import { useState } from "react"
import { combineVisualizations } from "lib/utils/combineVisualizations"

export default () => {
  const [solver] = useState(
    () =>
      new CapacityMeshSolver(ledMatrix1 as unknown as SimpleRouteJson, {
        capacityDepth: 8,
      }),
  )
  const [, forceUpdate] = useState({})
  const failedHdSolvers = solver.highDensityRouteSolver?.failedSolvers

  const animateToNextSolver = () => {
    const currentSolver = solver.activeSolver
    const interval = setInterval(() => {
      solver.step()
      forceUpdate({})
      if (!solver.activeSolver || solver.activeSolver !== currentSolver) {
        clearInterval(interval)
      }
    }, 10)
  }

  const animateUntilSolved = () => {
    let stepsOfSameSolver = 0
    let lastSolver = solver.activeSolver
    const interval = setInterval(() => {
      for (let i = 0; i < 10 + stepsOfSameSolver / 100; i++) {
        if (solver.activeSolver === lastSolver) {
          stepsOfSameSolver++
        } else {
          stepsOfSameSolver = 0
          lastSolver = solver.activeSolver
        }
        solver.step()
      }
      forceUpdate({})
      if (solver.solved || solver.failed) {
        clearInterval(interval)
      }
    }, 10)
  }

  return (
    <>
      <div className="border p-1 m-1">Iterations {solver.iterations}</div>
      <button
        className="border m-2 p-2"
        onClick={() => {
          solver.step()
          forceUpdate({})
        }}
      >
        Step
      </button>
      <button
        className="border m-2 p-2"
        onClick={() => {
          const ogSolver = solver.activeSolver
          while (
            solver.activeSolver === ogSolver &&
            !solver.activeSolver?.failed &&
            !solver.activeSolver?.solved
          ) {
            solver.step()
          }
          forceUpdate({})
        }}
      >
        Solve One
      </button>
      <button className="border m-2 p-2" onClick={animateToNextSolver}>
        Animate to next solver
      </button>
      <button className="border m-2 p-2" onClick={animateUntilSolved}>
        Animate until solved
      </button>
      <InteractiveGraphics
        graphics={
          solver.solved || solver.failed
            ? solver.visualize()
            : // Fixes dumb animation bug
              combineVisualizations({}, solver.visualize())
        }
      />
      {failedHdSolvers?.map((s) => (
        <button
          className="border m-2 p-2"
          key={s.nodeWithPortPoints.capacityMeshNodeId}
          onClick={() => {
            const json = JSON.stringify({
              nodeWithPortPoints: s.nodeWithPortPoints,
            })
            navigator.clipboard.writeText(json)
            alert("Copied to clipboard")
          }}
        >
          {s.nodeWithPortPoints.capacityMeshNodeId}
        </button>
      ))}
    </>
  )
}
