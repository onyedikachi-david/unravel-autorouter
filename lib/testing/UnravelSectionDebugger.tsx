import { useState, useEffect, useMemo } from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import { UnravelCandidate } from "lib/solvers/UnravelSolver/types"
import { combineVisualizations } from "lib/utils/combineVisualizations"

interface UnravelSectionDebuggerProps {
  createSolver: () => UnravelSectionSolver
  animationSpeed?: number
}

export const UnravelSectionDebugger = ({
  createSolver,
  animationSpeed = 10,
}: UnravelSectionDebuggerProps) => {
  const [solver, setSolver] = useState<UnravelSectionSolver>(() =>
    createSolver(),
  )
  const [forcedUpdates, setForceUpdate] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const [speedLevel, setSpeedLevel] = useState(0)
  const [selectedCandidate, setSelectedCandidate] =
    useState<UnravelCandidate | null>(null)

  const speedLevels = [1, 2, 5, 10, 100]
  const speedLabels = ["1x", "2x", "5x", "10x", "100x"]

  // Reset solver
  const resetSolver = () => {
    setSolver(createSolver())
  }

  // Animation effect
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined

    if (isAnimating && !solver.solved && !solver.failed) {
      intervalId = setInterval(() => {
        const stepsPerInterval = speedLevels[speedLevel]

        for (let i = 0; i < stepsPerInterval; i++) {
          if (solver.solved || solver.failed) {
            break
          }
          solver.step()
        }
        setForceUpdate((prev) => prev + 1)
      }, animationSpeed)
    }

    return () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId)
      }
    }
  }, [isAnimating, speedLevel, solver, animationSpeed])

  // Manual step function
  const handleStep = () => {
    if (!solver.solved && !solver.failed) {
      solver.step()
      setForceUpdate((prev) => prev + 1)
    }
  }

  // Solve completely
  const handleSolveCompletely = () => {
    if (!solver.solved && !solver.failed) {
      solver.solve()
      setForceUpdate((prev) => prev + 1)
    }
  }

  // Increase animation speed
  const increaseSpeed = () => {
    setSpeedLevel((prev) => Math.min(prev + 1, speedLevels.length - 1))
    if (!isAnimating) {
      setIsAnimating(true)
    }
  }

  // Decrease animation speed
  const decreaseSpeed = () => {
    setSpeedLevel((prev) => Math.max(prev - 1, 0))
  }

  // Safely get visualization
  const visualization = useMemo(() => {
    try {
      return solver?.visualize() || { points: [], lines: [] }
    } catch (error) {
      console.error("Visualization error:", error)
      return { points: [], lines: [] }
    }
  }, [forcedUpdates, solver])

  // Get sorted candidates
  const sortedCandidates = useMemo(() => {
    if (!solver.candidates || solver.candidates.length === 0) {
      return []
    }
    return [...solver.candidates].sort((a, b) => a.f - b.f)
  }, [forcedUpdates, solver, solver.candidates])

  // Auto-select first candidate when candidates change
  useEffect(() => {
    if (sortedCandidates.length > 0) {
      setSelectedCandidate(sortedCandidates[0])
    }
  }, [sortedCandidates])

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleStep}
          disabled={solver.solved || solver.failed}
        >
          Step
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={() => setIsAnimating(!isAnimating)}
          disabled={solver.solved || solver.failed}
        >
          {isAnimating ? "Stop" : "Animate"}
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={decreaseSpeed}
          disabled={speedLevel === 0 || solver.solved || solver.failed}
        >
          Slower
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100 min-w-[80px]"
          onClick={increaseSpeed}
          disabled={
            speedLevel === speedLevels.length - 1 ||
            solver.solved ||
            solver.failed
          }
        >
          {speedLabels[speedLevel + 1] ?? "(Max)"}
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={handleSolveCompletely}
          disabled={solver.solved || solver.failed}
        >
          Solve Completely
        </button>
        <button
          className="border rounded-md p-2 hover:bg-gray-100"
          onClick={resetSolver}
        >
          Reset
        </button>
      </div>

      <div className="flex gap-4 mb-4 tabular-nums">
        <div className="border p-2 rounded">
          Iterations: <span className="font-bold">{solver.iterations}</span>
        </div>
        <div className="border p-2 rounded">
          Status:{" "}
          <span
            className={`font-bold ${solver.solved ? "text-green-600" : solver.failed ? "text-red-600" : "text-blue-600"}`}
          >
            {solver.solved
              ? "Solved"
              : solver.failed
                ? "Failed"
                : "In Progress"}
          </span>
        </div>
        <div className="border p-2 rounded">
          Candidates:{" "}
          <span className="font-bold">{solver.candidates.length}</span>
        </div>
        {solver.error && (
          <div className="border p-2 rounded bg-red-100">
            Error: <span className="font-bold">{solver.error}</span>
          </div>
        )}
      </div>

      <div className="border rounded-md p-4 mb-4">
        <InteractiveGraphics graphics={visualization} />
      </div>

      <div className="mb-4">
        <h3 className="font-bold mb-2 text-sm">Candidates by F-Score</h3>
        <div className="flex gap-4">
          <div className="flex-1 max-h-[400px] overflow-y-auto border rounded">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Hash
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 uppercase tracking-wider">
                    G
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Issues
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Ops
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedCandidates.map((candidate, index) => {
                  const isCurrent =
                    solver.lastProcessedCandidate &&
                    solver.lastProcessedCandidate.candidateHash ===
                      candidate.candidateHash
                  const isBest =
                    solver.bestCandidate &&
                    solver.bestCandidate.candidateHash ===
                      candidate.candidateHash
                  const isSelected =
                    selectedCandidate?.candidateHash === candidate.candidateHash

                  return (
                    <tr
                      key={candidate.candidateHash}
                      className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="px-2 py-1 whitespace-nowrap">
                        <button
                          className={`w-full text-left text-gray-500 px-2 py-1 rounded ${
                            isCurrent
                              ? "bg-blue-100"
                              : isBest
                                ? "bg-green-100"
                                : isSelected
                                  ? "bg-yellow-100"
                                  : "hover:bg-gray-100"
                          }`}
                          onClick={() => setSelectedCandidate(candidate)}
                        >
                          {candidate.candidateHash}
                          {isCurrent && " (current)"}
                          {isBest && " (best)"}
                        </button>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-500">
                        {candidate.g.toFixed(3)}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-500">
                        {candidate.issues.length}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-500">
                        {
                          solver.getNeighborOperationsForCandidate(candidate)
                            .length
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="w-[400px] max-h-[400px] overflow-y-auto border rounded">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 uppercase tracking-wider">
                    #
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Issue
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Pf
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {selectedCandidate?.issues.map((issue, index) => (
                  <tr
                    key={index}
                    className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}
                  >
                    <td className="px-2 py-1 whitespace-nowrap text-gray-500">
                      {index + 1}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-gray-500">
                      {issue.type}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-gray-500">
                      {issue.probabilityOfFailure?.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {!selectedCandidate && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-2 py-4 text-center text-gray-500"
                    >
                      Select a candidate to view issues
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t pt-4">
        <h3 className="font-bold mb-2">Solver Information</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="border p-2 rounded">
            Type: <span className="font-bold">{solver?.constructor.name}</span>
          </div>
          <div className="border p-2 rounded">
            Max Iterations:{" "}
            <span className="font-bold">{solver?.MAX_ITERATIONS}</span>
          </div>
          <div className="border p-2 rounded">
            Mutable Hops:{" "}
            <span className="font-bold">{solver?.MUTABLE_HOPS}</span>
          </div>
          <div className="border p-2 rounded">
            Root Node: <span className="font-bold">{solver?.rootNodeId}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UnravelSectionDebugger
