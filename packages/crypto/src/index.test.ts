import { describe, expect, it } from "vitest"
import { createCipher, generateEncryptionKey } from "./index.js"

describe("createCipher", () => {
	it("roundtrips plaintext through encrypt/decrypt", () => {
		const key = generateEncryptionKey()
		const cipher = createCipher(key)
		const plaintext = "gho_secret-oauth-token-abc123"
		const encrypted = cipher.encrypt(plaintext)
		expect(encrypted).not.toBe(plaintext)
		expect(cipher.decrypt(encrypted)).toBe(plaintext)
	})

	it("produces different ciphertext on each encrypt (random IV)", () => {
		const key = generateEncryptionKey()
		const cipher = createCipher(key)
		const a = cipher.encrypt("same text")
		const b = cipher.encrypt("same text")
		expect(a).not.toBe(b)
	})

	it("throws on tampered ciphertext", () => {
		const key = generateEncryptionKey()
		const cipher = createCipher(key)
		const encrypted = cipher.encrypt("secret")
		const tampered = `${encrypted.slice(0, -2)}AA`
		expect(() => cipher.decrypt(tampered)).toThrow()
	})

	it("throws on too-short ciphertext", () => {
		const key = generateEncryptionKey()
		const cipher = createCipher(key)
		expect(() => cipher.decrypt("AAAA")).toThrow(/Invalid ciphertext length/)
	})

	it("rejects keys that are not 64 hex characters", () => {
		// Regression: an earlier version fell back to scrypt(raw,
		// constant-salt) for non-hex keys — a constant salt shared across
		// deployments is a footgun.
		expect(() => createCipher("not-hex")).toThrow(/64 hex/)
		expect(() => createCipher("0".repeat(63))).toThrow(/64 hex/)
		expect(() => createCipher("g".repeat(64))).toThrow(/64 hex/)
	})
})
