import type { PlanId } from "./plans.js"

export interface PlanGateUser {
	id: string
	plan: PlanId
}

export interface PlanGateDecision {
	allowed: boolean
	reason?: string
}

export interface PlanGate {
	requireActions(user: PlanGateUser): Promise<PlanGateDecision>
	requireConnectionsLimit(user: PlanGateUser, currentCount: number): Promise<PlanGateDecision>
	requireMutesLimit(user: PlanGateUser, currentCount: number): Promise<PlanGateDecision>
}

const ALLOW: PlanGateDecision = { allowed: true }

export const noopPlanGate: PlanGate = {
	requireActions: async () => ALLOW,
	requireConnectionsLimit: async () => ALLOW,
	requireMutesLimit: async () => ALLOW,
}
