export type PlanId = "free" | "personal" | "pro" | "team"

export interface PlanLimits {
	maxConnectedRepos: number
	hasActions: boolean
	historyDays: number
	hasDigest: boolean
	maxDigestEvents: number
	maxCustomRules: number
	hasMultiChatRouting: boolean
	hasBYOK: boolean
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
	free: {
		maxConnectedRepos: 1,
		hasActions: false,
		historyDays: 7,
		hasDigest: false,
		maxDigestEvents: 0,
		maxCustomRules: 0,
		hasMultiChatRouting: false,
		hasBYOK: false,
	},
	personal: {
		maxConnectedRepos: Number.POSITIVE_INFINITY,
		hasActions: true,
		historyDays: 90,
		hasDigest: true,
		maxDigestEvents: 100,
		maxCustomRules: 5,
		hasMultiChatRouting: false,
		hasBYOK: false,
	},
	pro: {
		maxConnectedRepos: Number.POSITIVE_INFINITY,
		hasActions: true,
		historyDays: 365,
		hasDigest: true,
		maxDigestEvents: 200,
		maxCustomRules: Number.POSITIVE_INFINITY,
		hasMultiChatRouting: true,
		hasBYOK: true,
	},
	team: {
		maxConnectedRepos: Number.POSITIVE_INFINITY,
		hasActions: true,
		historyDays: 365,
		hasDigest: true,
		maxDigestEvents: 200,
		maxCustomRules: Number.POSITIVE_INFINITY,
		hasMultiChatRouting: true,
		hasBYOK: true,
	},
}

export const PLAN_PRICE_USD: Record<PlanId, number> = {
	free: 0,
	personal: 7,
	pro: 15,
	team: 39,
}
