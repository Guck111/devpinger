import { createHmac } from "node:crypto"
import { createDatabase, preorders as preordersTable } from "@devpinger/db"
import { eq } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const integrationDbUrl = process.env.INTEGRATION_DB_URL
const skip = !integrationDbUrl

const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_integration_test_secret"

const sign = (timestamp: number, body: string, secret = SECRET): string =>
	createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")

const buildCheckoutEvent = (overrides: {
	eventId: string
	sessionId?: string
	email?: string | null
	amountCents?: number | null
	currency?: string | null
	telegramUsername?: string | null
	createdAt?: number
}) => ({
	id: overrides.eventId,
	object: "event" as const,
	api_version: "2024-04-10",
	created: overrides.createdAt ?? 1_700_000_000,
	type: "checkout.session.completed",
	data: {
		object: {
			id: overrides.sessionId ?? `cs_test_${overrides.eventId}`,
			object: "checkout.session",
			amount_total: overrides.amountCents ?? 900,
			currency: overrides.currency ?? "usd",
			payment_status: "paid",
			customer_details: {
				email: overrides.email === undefined ? "buyer@example.com" : overrides.email,
			},
			customer_email: null,
			custom_fields:
				overrides.telegramUsername !== undefined
					? [
							{
								key: "telegram_username",
								text: { value: overrides.telegramUsername },
							},
						]
					: [],
		},
	},
})

describe.skipIf(skip)("POST /v1/stripe/webhook + GET /v1/landing/seats", () => {
	let db: ReturnType<typeof createDatabase>
	let app: Awaited<ReturnType<typeof import("../../src/server.js").createApp>>
	let adminNotify: typeof import("../../src/services/admin-notify.js")
	const notifyAdminSpy = vi.fn().mockResolvedValue(undefined)

	beforeAll(async () => {
		db = createDatabase(integrationDbUrl as string)
		adminNotify = await import("../../src/services/admin-notify.js")
		vi.spyOn(adminNotify, "notifyAdmin").mockImplementation(notifyAdminSpy)
		const appModule = await import("../../src/server.js")
		app = await appModule.createApp()
	})

	afterEach(async () => {
		notifyAdminSpy.mockClear()
		await db.delete(preordersTable)
	})

	afterAll(async () => {
		await app.close()
		await db.$client.end({ timeout: 5 })
	})

	it("rejects requests with missing signature header", async () => {
		const event = buildCheckoutEvent({ eventId: "evt_no_sig" })
		const res = await app.inject({
			method: "POST",
			url: "/v1/stripe/webhook",
			headers: { "content-type": "application/json" },
			payload: JSON.stringify(event),
		})
		expect(res.statusCode).toBe(400)
	})

	it("rejects requests with an invalid signature", async () => {
		const event = buildCheckoutEvent({ eventId: "evt_bad_sig" })
		const body = JSON.stringify(event)
		const ts = Math.floor(Date.now() / 1000)
		const res = await app.inject({
			method: "POST",
			url: "/v1/stripe/webhook",
			headers: {
				"content-type": "application/json",
				"stripe-signature": `t=${ts},v1=${sign(ts, body, "wrong_secret")}`,
			},
			payload: body,
		})
		expect(res.statusCode).toBe(400)
	})

	it("persists a preorder on a verified checkout.session.completed and notifies admin", async () => {
		const event = buildCheckoutEvent({
			eventId: "evt_ok_1",
			sessionId: "cs_ok_1",
			email: "alice@example.com",
			telegramUsername: "@alice_tg",
		})
		const body = JSON.stringify(event)
		const ts = Math.floor(Date.now() / 1000)
		const res = await app.inject({
			method: "POST",
			url: "/v1/stripe/webhook",
			headers: {
				"content-type": "application/json",
				"stripe-signature": `t=${ts},v1=${sign(ts, body)}`,
			},
			payload: body,
		})
		expect(res.statusCode).toBe(200)

		const rows = await db
			.select()
			.from(preordersTable)
			.where(eq(preordersTable.stripeEventId, "evt_ok_1"))
		expect(rows).toHaveLength(1)
		expect(rows[0]?.email).toBe("alice@example.com")
		expect(rows[0]?.amountCents).toBe(900)
		expect(rows[0]?.currency).toBe("usd")
		expect(rows[0]?.telegramUsername).toBe("alice_tg")
		expect(rows[0]?.status).toBe("paid")
		expect(notifyAdminSpy).toHaveBeenCalledTimes(1)
	})

	it("is idempotent for a replayed event (same event id)", async () => {
		const event = buildCheckoutEvent({ eventId: "evt_dup", sessionId: "cs_dup" })
		const body = JSON.stringify(event)
		const ts = Math.floor(Date.now() / 1000)
		const headers = {
			"content-type": "application/json",
			"stripe-signature": `t=${ts},v1=${sign(ts, body)}`,
		}
		const first = await app.inject({ method: "POST", url: "/v1/stripe/webhook", headers, payload: body })
		const second = await app.inject({ method: "POST", url: "/v1/stripe/webhook", headers, payload: body })
		expect(first.statusCode).toBe(200)
		expect(second.statusCode).toBe(200)
		const rows = await db
			.select()
			.from(preordersTable)
			.where(eq(preordersTable.stripeEventId, "evt_dup"))
		expect(rows).toHaveLength(1)
		expect(notifyAdminSpy).toHaveBeenCalledTimes(1)
	})

	it("acknowledges unrelated event types without persisting anything", async () => {
		const body = JSON.stringify({
			id: "evt_other",
			type: "customer.created",
			data: { object: { id: "cus_123" } },
		})
		const ts = Math.floor(Date.now() / 1000)
		const res = await app.inject({
			method: "POST",
			url: "/v1/stripe/webhook",
			headers: {
				"content-type": "application/json",
				"stripe-signature": `t=${ts},v1=${sign(ts, body)}`,
			},
			payload: body,
		})
		expect(res.statusCode).toBe(200)
		const rows = await db.select().from(preordersTable)
		expect(rows).toHaveLength(0)
		expect(notifyAdminSpy).not.toHaveBeenCalled()
	})

	it("/v1/landing/seats reports sold count and configured total", async () => {
		const event = buildCheckoutEvent({ eventId: "evt_seats_1", sessionId: "cs_seats_1" })
		const body = JSON.stringify(event)
		const ts = Math.floor(Date.now() / 1000)
		await app.inject({
			method: "POST",
			url: "/v1/stripe/webhook",
			headers: {
				"content-type": "application/json",
				"stripe-signature": `t=${ts},v1=${sign(ts, body)}`,
			},
			payload: body,
		})

		const res = await app.inject({ method: "GET", url: "/v1/landing/seats" })
		expect(res.statusCode).toBe(200)
		const json = res.json() as { sold: number; total: number }
		expect(json.sold).toBe(1)
		expect(json.total).toBe(30)
	})
})
