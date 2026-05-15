import { type PlanGate, noopPlanGate } from "@devpinger/core"

// Server-side PlanGate handle. V1 ships `noopPlanGate` (everything allowed).
// The private V2 app wires its Stripe-aware gate in via createApp({planGate}),
// which assigns into this same singleton at startup.
let activeGate: PlanGate = noopPlanGate

export const setPlanGate = (gate: PlanGate): void => {
	activeGate = gate
}

export const planGate = (): PlanGate => activeGate
